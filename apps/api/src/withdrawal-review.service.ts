import { HttpStatus, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  AdminCapability,
  AdminRole,
} from "../../../src/contexts/identity-access/domain/admin-auth.repository";
import { PrismaService } from "../../../src/platform/persistence/prisma.service";
import { IdempotencyService } from "../../../src/platform/idempotency/idempotency.service";
import { WithdrawalService } from "../../../src/contexts/payments/application/withdrawal.service";
import { WithdrawalError } from "../../../src/contexts/payments/domain/withdrawal";
import { PayoutDestinationError } from "../../../src/contexts/payments/domain/payout-destination";
import {
  toWithdrawalView,
  type WithdrawalRecord,
} from "../../../src/contexts/payments/domain/withdrawal.repository";

const IDEMPOTENCY_CONTRACT_EXPIRY = new Date("9999-12-31T23:59:59.999Z");

export interface WithdrawalReviewActor {
  adminId: string;
  sessionId: string;
  role: AdminRole;
  capabilities: readonly AdminCapability[];
}

export interface WithdrawalCommandResult {
  statusCode: number;
  body: Prisma.JsonValue;
}

interface CommandInput {
  withdrawalId: string;
  actor: WithdrawalReviewActor;
  action: string;
  operation: string;
  reason: string;
  correlationId: string;
  idempotencyKey: string | undefined;
  run: () => Promise<WithdrawalRecord>;
}

/**
 * Governed Admin withdrawal commands. Every command is idempotent by a scoped
 * `Idempotency-Key` and leaves an immutable Audit Record for both the allowed
 * and the denied outcome, so the review/approval surface is traceable and no
 * governed transition can bypass the workflow guards.
 */
@Injectable()
export class WithdrawalReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly withdrawals: WithdrawalService,
  ) {}

  approve(input: Omit<CommandInput, "action" | "operation" | "run">) {
    return this.execute({
      ...input,
      action: "WITHDRAWAL_REVIEW_APPROVE",
      operation: "approve",
      run: () =>
        this.withdrawals.approveWithdrawal(
          input.withdrawalId,
          { adminId: input.actor.adminId, reason: input.reason },
          input.correlationId,
        ),
    });
  }

  reject(input: Omit<CommandInput, "action" | "operation" | "run">) {
    return this.execute({
      ...input,
      action: "WITHDRAWAL_REVIEW_REJECT",
      operation: "reject",
      run: () =>
        this.withdrawals.rejectWithdrawal(
          input.withdrawalId,
          { adminId: input.actor.adminId, reason: input.reason },
          input.correlationId,
        ),
    });
  }

  requestPayout(input: Omit<CommandInput, "action" | "operation" | "run">) {
    return this.execute({
      ...input,
      action: "WITHDRAWAL_PAYOUT_REQUEST",
      operation: "payout",
      run: () =>
        this.withdrawals.requestPayout(
          input.withdrawalId,
          { adminId: input.actor.adminId },
          input.correlationId,
        ),
    });
  }

  reconcile(input: Omit<CommandInput, "action" | "operation" | "run">) {
    return this.execute({
      ...input,
      action: "WITHDRAWAL_PAYOUT_RECONCILE",
      operation: "reconcile",
      run: () =>
        this.withdrawals.reconcileWithdrawal(
          input.withdrawalId,
          { adminId: input.actor.adminId },
          input.correlationId,
        ),
    });
  }

  finalize(input: Omit<CommandInput, "action" | "operation" | "run">) {
    return this.execute({
      ...input,
      action: "WITHDRAWAL_FINALIZE",
      operation: "finalize",
      run: () =>
        this.withdrawals.finalizeWithdrawal(
          input.withdrawalId,
          { adminId: input.actor.adminId },
          input.correlationId,
        ),
    });
  }

  private async execute(input: CommandInput): Promise<WithdrawalCommandResult> {
    const key = input.idempotencyKey?.trim();
    if (!key) {
      return this.fail(
        input,
        HttpStatus.BAD_REQUEST,
        "VALIDATION_ERROR",
        "Idempotency-Key header is required",
        { header: "Idempotency-Key" },
      );
    }

    const fingerprint = fingerprintOf({
      withdrawalId: input.withdrawalId,
      operation: input.operation,
      reason: input.reason,
    });
    const scope = `admin:${input.actor.adminId}:withdrawal:${input.withdrawalId}:${input.operation}`;
    const claim = await this.idempotency.claim({
      scope,
      key,
      fingerprint,
      expiresAt: IDEMPOTENCY_CONTRACT_EXPIRY,
    });

    if (claim.kind === "existing") {
      if (claim.fingerprint !== fingerprint) {
        return this.fail(
          input,
          HttpStatus.CONFLICT,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different payload",
          {},
        );
      }
      if (
        claim.status === "COMPLETED" &&
        claim.responseCode !== null &&
        claim.responseBody !== null
      ) {
        return { statusCode: claim.responseCode, body: claim.responseBody };
      }
      return this.fail(
        input,
        HttpStatus.CONFLICT,
        "IDEMPOTENCY_IN_PROGRESS",
        "The idempotent command has not completed",
        { status: claim.status },
      );
    }

    try {
      const updated = await input.run();
      const body = serializeJson(toWithdrawalView(updated));
      await this.writeAudit(input, fingerprint, "ALLOWED");
      await this.idempotency.complete(claim.recordId, HttpStatus.OK, body as Prisma.InputJsonValue);
      return { statusCode: HttpStatus.OK, body };
    } catch (error) {
      const mapped = mapWithdrawalError(error);
      await this.writeAudit(input, fingerprint, mapped.code);
      const body = serializeJson({
        code: mapped.code,
        message: mapped.message,
        details: mapped.details,
        correlationId: input.correlationId,
      });
      await this.idempotency.complete(
        claim.recordId,
        mapped.statusCode,
        body as Prisma.InputJsonValue,
      );
      return { statusCode: mapped.statusCode, body };
    }
  }

  private async fail(
    input: CommandInput,
    statusCode: number,
    code: string,
    message: string,
    details: Readonly<Record<string, unknown>>,
  ): Promise<WithdrawalCommandResult> {
    return {
      statusCode,
      body: serializeJson({ code, message, details, correlationId: input.correlationId }),
    };
  }

  private async writeAudit(
    input: CommandInput,
    payloadHash: string,
    outcome: string,
  ): Promise<void> {
    await this.prisma.auditRecord.create({
      data: {
        actorAdminId: input.actor.adminId,
        actorRole: input.actor.role,
        sessionId: input.actor.sessionId,
        action: input.action,
        resourceType: "WITHDRAWAL",
        resourceId: input.withdrawalId,
        payloadHash,
        reason: input.reason,
        correlationId: input.correlationId,
        outcome,
      },
    });
  }
}

export function fingerprintOf(payload: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

interface MappedWithdrawalError {
  statusCode: number;
  code: string;
  message: string;
  details: Readonly<Record<string, unknown>>;
}

function mapWithdrawalError(error: unknown): MappedWithdrawalError {
  if (error instanceof WithdrawalError) {
    return {
      statusCode: statusForWithdrawalCode(error.code),
      code: error.code,
      message: error.message,
      details: {},
    };
  }
  if (error instanceof PayoutDestinationError) {
    return {
      statusCode:
        error.code === "NOT_FOUND" ? HttpStatus.NOT_FOUND : HttpStatus.CONFLICT,
      code: error.code,
      message: error.message,
      details: {},
    };
  }
  throw error;
}

export function statusForWithdrawalCode(code: string): number {
  switch (code) {
    case "INVALID":
      return HttpStatus.BAD_REQUEST;
    case "NOT_FOUND":
      return HttpStatus.NOT_FOUND;
    case "INSUFFICIENT_FUNDS":
    case "WITHDRAWAL_BLOCKED":
    case "PAYOUT_DESTINATION_NOT_ELIGIBLE":
    case "PAYOUT_PROVIDER_REJECTED":
      return HttpStatus.UNPROCESSABLE_ENTITY;
    default:
      return HttpStatus.CONFLICT;
  }
}

export function serializeJson(value: unknown): Prisma.JsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
}
