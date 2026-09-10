import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../platform/persistence/prisma.service";
import { AuditRuleError } from "./audit-rule-error";

export const AUDIT_INSPECTION_DEFAULT_LIMIT = 25;
export const AUDIT_INSPECTION_MAX_LIMIT = 100;

export interface AuditLinkedReauthReference {
  id: string;
  actionClass: string;
  verifiedAt: Date;
  expiresAt: Date;
}

export interface AuditLinkedApprovalReference {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requesterAdminId: string;
  approverAdminId: string;
  approvedAt: Date;
}

export interface AuditActorReference {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface AuditRecordInspection {
  id: string;
  actorAdminId: string;
  actorRole: string;
  sessionId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  payloadHash: string;
  reason: string;
  reauthEvidenceId: string | null;
  approvalId: string | null;
  correlationId: string;
  outcome: string;
  createdAt: Date;
  actor: AuditActorReference;
  reauthEvidence: AuditLinkedReauthReference | null;
  approval: AuditLinkedApprovalReference | null;
}

export interface AuditRecordListQuery {
  actor?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  outcome?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
}

export interface AuditRecordPage {
  items: readonly AuditRecordInspection[];
  nextCursor: string | null;
  dataAsOf: Date;
}

const AUDIT_SELECT = {
  id: true,
  actorAdminId: true,
  actorRole: true,
  sessionId: true,
  action: true,
  resourceType: true,
  resourceId: true,
  payloadHash: true,
  reason: true,
  reauthEvidenceId: true,
  approvalId: true,
  correlationId: true,
  outcome: true,
  createdAt: true,
  actor: { select: { id: true, email: true, name: true, role: true } },
  reauthEvidence: { select: { id: true, actionClass: true, verifiedAt: true, expiresAt: true } },
  approval: {
    select: {
      id: true,
      action: true,
      resourceType: true,
      resourceId: true,
      requesterAdminId: true,
      approverAdminId: true,
      approvedAt: true,
    },
  },
} as const;

type AuditRow = Prisma.AuditRecordGetPayload<{ select: typeof AUDIT_SELECT }>;

/**
 * Read model over the immutable AuditRecord durable model (Ticket 14 / Ticket 08
 * round 3). It exposes the actor/session/action/resource/reason/outcome/evidence
 * facts operators inspect, with allowlisted filters and deterministic cursor
 * pagination, and never mutates the immutable log.
 */
@Injectable()
export class AuditInspectionService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async listAuditRecords(query: AuditRecordListQuery): Promise<AuditRecordPage> {
    const limit = boundedLimit(query.limit);
    const created = optionalRange(query.from, query.to, "createdAt");
    const where: Prisma.AuditRecordWhereInput = {
      ...(query.actor ? { actorAdminId: query.actor } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(created ? { createdAt: created } : {}),
    };

    const { clock, rows } = await this.prisma.$transaction(
      async (tx) => {
        const dataAsOf = await readDataAsOf(tx);
        const records = await tx.auditRecord.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
          select: AUDIT_SELECT,
        });
        return { clock: dataAsOf, rows: records };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const page = rows.slice(0, limit);
    return {
      items: page.map(toAuditInspection),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
      dataAsOf: clock,
    };
  }

  async getAuditRecord(id: string): Promise<AuditRecordInspection> {
    const { row } = await this.prisma.$transaction(
      async (tx) => {
        await readDataAsOf(tx);
        const record = await tx.auditRecord.findFirst({
          where: { id },
          select: AUDIT_SELECT,
        });
        return { row: record };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (!row) {
      throw new AuditRuleError("NOT_FOUND", "Audit record not found", { id });
    }
    return toAuditInspection(row);
  }
}

function toAuditInspection(row: AuditRow): AuditRecordInspection {
  return {
    id: row.id,
    actorAdminId: row.actorAdminId,
    actorRole: row.actorRole,
    sessionId: row.sessionId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    payloadHash: row.payloadHash,
    reason: row.reason,
    reauthEvidenceId: row.reauthEvidenceId,
    approvalId: row.approvalId,
    correlationId: row.correlationId,
    outcome: row.outcome,
    createdAt: row.createdAt,
    actor: {
      id: row.actor.id,
      email: row.actor.email,
      name: row.actor.name,
      role: row.actor.role,
    },
    reauthEvidence: row.reauthEvidence
      ? {
          id: row.reauthEvidence.id,
          actionClass: row.reauthEvidence.actionClass,
          verifiedAt: row.reauthEvidence.verifiedAt,
          expiresAt: row.reauthEvidence.expiresAt,
        }
      : null,
    approval: row.approval
      ? {
          id: row.approval.id,
          action: row.approval.action,
          resourceType: row.approval.resourceType,
          resourceId: row.approval.resourceId,
          requesterAdminId: row.approval.requesterAdminId,
          approverAdminId: row.approval.approverAdminId,
          approvedAt: row.approval.approvedAt,
        }
      : null,
  };
}

async function readDataAsOf(tx: Prisma.TransactionClient): Promise<Date> {
  const clocks = await tx.$queryRaw<Array<{ dataAsOf: Date }>>(
    Prisma.sql`SELECT transaction_timestamp() AS "dataAsOf"`,
  );
  const dataAsOf = clocks[0]?.dataAsOf;
  if (!dataAsOf) throw new Error("Audit dataAsOf is unavailable");
  return dataAsOf;
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return AUDIT_INSPECTION_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_INSPECTION_MAX_LIMIT) {
    throw new AuditRuleError(
      "VALIDATION_ERROR",
      `limit must be an integer between 1 and ${AUDIT_INSPECTION_MAX_LIMIT}`,
      { field: "limit" },
    );
  }
  return limit;
}

function optionalRange(
  from: Date | undefined,
  to: Date | undefined,
  field: string,
): { gte?: Date; lt?: Date } | undefined {
  if (!from && !to) return undefined;
  if (from && to && from.getTime() >= to.getTime()) {
    throw new AuditRuleError(
      "VALIDATION_ERROR",
      `${field} range must be a non-empty half-open [from, to) window`,
      { field },
    );
  }
  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lt: to } : {}),
  };
}
