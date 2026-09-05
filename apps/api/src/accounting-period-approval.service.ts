import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type {
  AdminReauthEvidenceRecord,
  AdminRole,
} from "../../../src/contexts/identity-access/domain/admin-auth.repository";
import {
  ACCOUNTING_TIME_ZONE,
  AccountingPeriodRuleError,
  type AccountingPeriodReplacementPreview,
} from "../../../src/contexts/wallet-ledger/domain/accounting-period";
import type { AccountingPeriodRecord } from "../../../src/contexts/wallet-ledger/domain/accounting-period.repository";
import { lockAccountingCalendar } from "../../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import {
  applyCustomAccountingPeriodApprovalSchedule,
  getAccountingPeriodApprovalAuditSubject,
  getCustomAccountingPeriodApprovalCandidate,
  type CustomAccountingPeriodApprovalCandidate,
} from "../../../src/contexts/wallet-ledger/infrastructure/prisma-accounting-period.repository";
import { PrismaService } from "../../../src/platform/persistence/prisma.service";

export const ACCOUNTING_PERIOD_APPROVAL_ACTION_CLASS = "accounting-period.approve" as const;
const APPROVAL_ACTION = "ACCOUNTING_PERIOD_CUSTOM_ACTIVATION";
const APPROVAL_POLICY_VERSION = "accounting-period-custom-activation-v1";
const APPROVAL_SAVEPOINT = "accounting_period_custom_approval";

interface ApprovalActor {
  adminId: string;
  sessionId: string;
  role: AdminRole;
}

export interface AccountingPeriodApprovalExecutionResult {
  statusCode: number;
  body: Prisma.JsonValue;
}

@Injectable()
export class AccountingPeriodApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  async approveCustom(input: {
    id: string;
    expectedVersion: number;
    actor: ApprovalActor;
    reauthEvidence: AdminReauthEvidenceRecord;
    correlationId: string;
    idempotencyRecordId: string;
    fingerprint: string;
  }): Promise<AccountingPeriodApprovalExecutionResult> {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      return this.completeValidationError(input);
    }

    return this.prisma.$transaction(async (tx) => {
      const replay = await lockIdempotencyRecord(
        tx,
        input.idempotencyRecordId,
        input.fingerprint,
      );
      if (replay) return replay;

      const instant = await transactionNow(tx);
      await lockAccountingCalendar(tx);
      await tx.$executeRawUnsafe(`SAVEPOINT ${APPROVAL_SAVEPOINT}`);

      let candidate: CustomAccountingPeriodApprovalCandidate | undefined;
      try {
        candidate = await getCustomAccountingPeriodApprovalCandidate(
          tx,
          input.id,
          input.expectedVersion,
        );
        if (input.actor.role === "ADMIN" && candidate.createdByAdminId === input.actor.adminId) {
          throw new AccountingPeriodRuleError(
            "ACCOUNTING_PERIOD_SELF_APPROVAL_FORBIDDEN",
            "ADMIN requester cannot approve their own Custom Accounting Period",
            { requesterAdminId: candidate.createdByAdminId },
          );
        }

        const payloadHash = approvalPayloadHash(candidate);
        const schedule = await applyCustomAccountingPeriodApprovalSchedule(tx, candidate, instant);
        if (schedule.kind === "elapsed") {
          const body = apiErrorBody(
            "ACCOUNTING_PERIOD_START_ELAPSED",
            "Custom Accounting Period start boundary elapsed before approval completed",
            { state: "CANCELLED", currentVersion: schedule.period.version },
            input.correlationId,
          );
          await createAuditRecord(tx, {
            actor: input.actor,
            resourceId: candidate.id,
            payloadHash,
            reason: candidate.reason,
            reauthEvidenceId: input.reauthEvidence.id,
            correlationId: input.correlationId,
            outcome: "ELAPSED_START",
          });
          await completeIdempotencyRecord(
            tx,
            input.idempotencyRecordId,
            HttpStatus.CONFLICT,
            body,
          );
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${APPROVAL_SAVEPOINT}`);
          return { statusCode: HttpStatus.CONFLICT, body };
        }

        const approval = await tx.adminApprovalEvidence.create({
          data: {
            action: APPROVAL_ACTION,
            resourceType: "ACCOUNTING_PERIOD",
            resourceId: candidate.id,
            requesterAdminId: candidate.createdByAdminId,
            approverAdminId: input.actor.adminId,
            requestedVersion: input.expectedVersion,
            payloadHash,
            reason: candidate.reason,
            policyVersion: APPROVAL_POLICY_VERSION,
            reauthEvidenceId: input.reauthEvidence.id,
            correlationId: input.correlationId,
            approvedAt: instant,
          },
        });
        await createAuditRecord(tx, {
          actor: input.actor,
          resourceId: candidate.id,
          payloadHash,
          reason: candidate.reason,
          reauthEvidenceId: input.reauthEvidence.id,
          approvalId: approval.id,
          correlationId: input.correlationId,
          outcome: "APPROVED",
        });

        const body = serializeJson(
          accountingPeriodCommandResponse(schedule.period, schedule.replacementPreview),
        );
        await completeIdempotencyRecord(
          tx,
          input.idempotencyRecordId,
          HttpStatus.OK,
          body,
        );
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${APPROVAL_SAVEPOINT}`);
        return { statusCode: HttpStatus.OK, body };
      } catch (error) {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${APPROVAL_SAVEPOINT}`);
        if (!(error instanceof AccountingPeriodRuleError)) throw error;

        const subject =
          candidate ?? (await getAccountingPeriodApprovalAuditSubject(tx, input.id));
        if (subject?.reason) {
          await createAuditRecord(tx, {
            actor: input.actor,
            resourceId: subject.id,
            payloadHash: approvalPayloadHash(subject),
            reason: subject.reason,
            reauthEvidenceId: input.reauthEvidence.id,
            correlationId: input.correlationId,
            outcome: error.code,
          });
        }
        const statusCode = statusForRuleError(error);
        const body = apiErrorBody(
          error.code,
          error.message,
          error.details,
          input.correlationId,
        );
        await completeIdempotencyRecord(
          tx,
          input.idempotencyRecordId,
          statusCode,
          body,
        );
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${APPROVAL_SAVEPOINT}`);
        return { statusCode, body };
      }
    });
  }

  async denyMissingReauth(input: {
    id: string;
    expectedVersion: number;
    actor: ApprovalActor;
    correlationId: string;
    idempotencyRecordId: string;
    fingerprint: string;
  }): Promise<AccountingPeriodApprovalExecutionResult> {
    return this.prisma.$transaction(async (tx) => {
      const replay = await lockIdempotencyRecord(
        tx,
        input.idempotencyRecordId,
        input.fingerprint,
      );
      if (replay) return replay;

      await lockAccountingCalendar(tx);
      const subject = await getAccountingPeriodApprovalAuditSubject(tx, input.id);
      if (subject?.reason) {
        await createAuditRecord(tx, {
          actor: input.actor,
          resourceId: subject.id,
          payloadHash: approvalPayloadHash(subject),
          reason: subject.reason,
          reauthEvidenceId: null,
          correlationId: input.correlationId,
          outcome: "REAUTH_REQUIRED",
        });
      }
      const body = apiErrorBody(
        "REAUTH_REQUIRED",
        "Fresh MFA verification is required for Accounting Period approval",
        { actionClass: ACCOUNTING_PERIOD_APPROVAL_ACTION_CLASS },
        input.correlationId,
      );
      await completeIdempotencyRecord(
        tx,
        input.idempotencyRecordId,
        HttpStatus.FORBIDDEN,
        body,
      );
      return { statusCode: HttpStatus.FORBIDDEN, body };
    });
  }

  private async completeValidationError(input: {
    correlationId: string;
    idempotencyRecordId: string;
    fingerprint: string;
  }): Promise<AccountingPeriodApprovalExecutionResult> {
    const body = apiErrorBody(
      "VALIDATION_ERROR",
      "expectedVersion must be a positive integer",
      { field: "expectedVersion" },
      input.correlationId,
    );
    return this.prisma.$transaction(async (tx) => {
      const replay = await lockIdempotencyRecord(
        tx,
        input.idempotencyRecordId,
        input.fingerprint,
      );
      if (replay) return replay;
      await completeIdempotencyRecord(
        tx,
        input.idempotencyRecordId,
        HttpStatus.BAD_REQUEST,
        body,
      );
      return { statusCode: HttpStatus.BAD_REQUEST, body };
    });
  }
}

async function transactionNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT transaction_timestamp() AS "now"`,
  );
  const now = rows[0]?.now;
  if (!now) throw new Error("Authoritative approval time is unavailable");
  return now;
}

async function lockIdempotencyRecord(
  tx: Prisma.TransactionClient,
  recordId: string,
  fingerprint: string,
): Promise<AccountingPeriodApprovalExecutionResult | null> {
  await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "idempotency_records" WHERE "id" = ${recordId}::uuid FOR UPDATE`,
  );
  const record = await tx.idempotencyRecord.findUniqueOrThrow({ where: { id: recordId } });
  if (record.fingerprint !== fingerprint) {
    throw new Error("Idempotency fingerprint changed after claim");
  }
  if (
    record.status === "COMPLETED" &&
    record.responseCode !== null &&
    record.responseBody !== null
  ) {
    return { statusCode: record.responseCode, body: record.responseBody };
  }
  if (record.status !== "IN_PROGRESS") {
    throw new Error(`Idempotency record is not resumable from status ${record.status}`);
  }
  return null;
}

async function completeIdempotencyRecord(
  tx: Prisma.TransactionClient,
  recordId: string,
  responseCode: number,
  responseBody: Prisma.JsonValue,
): Promise<void> {
  await tx.idempotencyRecord.update({
    where: { id: recordId },
    data: {
      status: "COMPLETED",
      responseCode,
      responseBody: responseBody as Prisma.InputJsonValue,
    },
  });
}

async function createAuditRecord(
  tx: Prisma.TransactionClient,
  input: {
    actor: ApprovalActor;
    resourceId: string;
    payloadHash: string;
    reason: string;
    reauthEvidenceId: string | null;
    approvalId?: string;
    correlationId: string;
    outcome: string;
  },
): Promise<void> {
  await tx.auditRecord.create({
    data: {
      actorAdminId: input.actor.adminId,
      actorRole: input.actor.role,
      sessionId: input.actor.sessionId,
      action: APPROVAL_ACTION,
      resourceType: "ACCOUNTING_PERIOD",
      resourceId: input.resourceId,
      payloadHash: input.payloadHash,
      reason: input.reason,
      reauthEvidenceId: input.reauthEvidenceId,
      approvalId: input.approvalId,
      correlationId: input.correlationId,
      outcome: input.outcome,
    },
  });
}

function statusForRuleError(error: AccountingPeriodRuleError): number {
  if (error.code === "VALIDATION_ERROR") return HttpStatus.BAD_REQUEST;
  if (error.code === "ACCOUNTING_PERIOD_NOT_FOUND") return HttpStatus.NOT_FOUND;
  if (error.code === "ACCOUNTING_PERIOD_SELF_APPROVAL_FORBIDDEN") {
    return HttpStatus.FORBIDDEN;
  }
  return HttpStatus.CONFLICT;
}

function accountingPeriodCommandResponse(
  period: AccountingPeriodRecord,
  replacementPreview: AccountingPeriodReplacementPreview,
) {
  return {
    period: {
      ...period,
      accountingTimezone: ACCOUNTING_TIME_ZONE,
      allowedActions: [],
    },
    replacementPreview,
  };
}

function apiErrorBody(
  code: string,
  message: string,
  details: Readonly<Record<string, unknown>>,
  correlationId: string,
): Prisma.JsonValue {
  return serializeJson({ code, message, details, correlationId });
}

function serializeJson(value: unknown): Prisma.JsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
}

function approvalPayloadHash(period: {
  id: string;
  effectiveStart: Date;
  effectiveEnd: Date;
  reason: string | null;
  createdByAdminId: string | null;
  version: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: period.id,
        effectiveStart: period.effectiveStart.toISOString(),
        effectiveEnd: period.effectiveEnd.toISOString(),
        reason: period.reason,
        requesterAdminId: period.createdByAdminId,
        version: period.version,
      }),
      "utf8",
    )
    .digest("hex");
}
