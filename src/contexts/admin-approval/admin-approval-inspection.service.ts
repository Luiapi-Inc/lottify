import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../platform/persistence/prisma.service";
import { AdminApprovalRuleError } from "./admin-approval-rule-error";

export const ADMIN_APPROVAL_INSPECTION_DEFAULT_LIMIT = 25;
export const ADMIN_APPROVAL_INSPECTION_MAX_LIMIT = 100;

/**
 * The durable AdminApprovalEvidence model is created atomically with a required
 * `approvedAt` the moment an approval decision is finalised, so the only state
 * the immutable evidence can express is a granted decision. Exposing any other
 * lifecycle state (pending/expired/...) would invent approval semantics the
 * locked model does not persist (Ticket 08 round 3); this surface therefore
 * reports every record as APPROVED.
 */
export const ADMIN_APPROVAL_STATES = ["APPROVED"] as const;
export type AdminApprovalState = (typeof ADMIN_APPROVAL_STATES)[number];

export interface AdminApprovalPrincipalReference {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface AdminApprovalReauthReference {
  id: string;
  actionClass: string;
  verifiedAt: Date;
  expiresAt: Date;
}

export interface AdminApprovalLinkedAuditReference {
  id: string;
  outcome: string;
  createdAt: Date;
}

export interface AdminApprovalInspection {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requesterAdminId: string;
  approverAdminId: string;
  requestedVersion: number;
  payloadHash: string;
  reason: string;
  policyVersion: string;
  reauthEvidenceId: string;
  correlationId: string;
  approvedAt: Date;
  createdAt: Date;
  state: AdminApprovalState;
  ageMs: number;
  requester: AdminApprovalPrincipalReference;
  approver: AdminApprovalPrincipalReference;
  reauthEvidence: AdminApprovalReauthReference;
  auditRecords: readonly AdminApprovalLinkedAuditReference[];
}

export interface AdminApprovalListQuery {
  state?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
}

export interface AdminApprovalPage {
  items: readonly AdminApprovalInspection[];
  nextCursor: string | null;
  dataAsOf: Date;
}

const APPROVAL_SELECT = {
  id: true,
  action: true,
  resourceType: true,
  resourceId: true,
  requesterAdminId: true,
  approverAdminId: true,
  requestedVersion: true,
  payloadHash: true,
  reason: true,
  policyVersion: true,
  reauthEvidenceId: true,
  correlationId: true,
  approvedAt: true,
  createdAt: true,
  requester: { select: { id: true, email: true, name: true, role: true } },
  approver: { select: { id: true, email: true, name: true, role: true } },
  reauthEvidence: { select: { id: true, actionClass: true, verifiedAt: true, expiresAt: true } },
  auditRecords: {
    select: { id: true, outcome: true, createdAt: true },
    orderBy: { createdAt: "desc" as const },
  },
} as const;

type ApprovalRow = Prisma.AdminApprovalEvidenceGetPayload<{ select: typeof APPROVAL_SELECT }>;

/**
 * Read model over the durable AdminApprovalEvidence work-queue surface (Ticket 08
 * / Ticket 12 Approvals area). Every record is an immutable, granted approval
 * decision carrying requester/approver, target action/resource, reason, policy
 * version, payload hash, reauth evidence and the audit records it produced, with
 * allowlisted filters and deterministic cursor pagination.
 */
@Injectable()
export class AdminApprovalInspectionService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async listApprovals(query: AdminApprovalListQuery): Promise<AdminApprovalPage> {
    const limit = boundedLimit(query.limit);
    void optionalState(query.state);
    const created = optionalRange(query.from, query.to, "createdAt");
    const where: Prisma.AdminApprovalEvidenceWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(created ? { createdAt: created } : {}),
    };

    const { clock, rows } = await this.prisma.$transaction(
      async (tx) => {
        const dataAsOf = await readDataAsOf(tx);
        const approvals = await tx.adminApprovalEvidence.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
          select: APPROVAL_SELECT,
        });
        return { clock: dataAsOf, rows: approvals };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => toApprovalInspection(row, clock)),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
      dataAsOf: clock,
    };
  }

  async getApproval(id: string): Promise<AdminApprovalInspection> {
    const { clock, row } = await this.prisma.$transaction(
      async (tx) => {
        const dataAsOf = await readDataAsOf(tx);
        const approval = await tx.adminApprovalEvidence.findFirst({
          where: { id },
          select: APPROVAL_SELECT,
        });
        return { clock: dataAsOf, row: approval };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (!row) {
      throw new AdminApprovalRuleError("NOT_FOUND", "Approval evidence not found", { id });
    }
    return toApprovalInspection(row, clock);
  }
}

function toApprovalInspection(row: ApprovalRow, dataAsOf: Date): AdminApprovalInspection {
  return {
    id: row.id,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    requesterAdminId: row.requesterAdminId,
    approverAdminId: row.approverAdminId,
    requestedVersion: row.requestedVersion,
    payloadHash: row.payloadHash,
    reason: row.reason,
    policyVersion: row.policyVersion,
    reauthEvidenceId: row.reauthEvidenceId,
    correlationId: row.correlationId,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
    state: "APPROVED",
    ageMs: Math.max(0, dataAsOf.getTime() - row.createdAt.getTime()),
    requester: {
      id: row.requester.id,
      email: row.requester.email,
      name: row.requester.name,
      role: row.requester.role,
    },
    approver: {
      id: row.approver.id,
      email: row.approver.email,
      name: row.approver.name,
      role: row.approver.role,
    },
    reauthEvidence: {
      id: row.reauthEvidence.id,
      actionClass: row.reauthEvidence.actionClass,
      verifiedAt: row.reauthEvidence.verifiedAt,
      expiresAt: row.reauthEvidence.expiresAt,
    },
    auditRecords: row.auditRecords.map((record) => ({
      id: record.id,
      outcome: record.outcome,
      createdAt: record.createdAt,
    })),
  };
}

async function readDataAsOf(tx: Prisma.TransactionClient): Promise<Date> {
  const clocks = await tx.$queryRaw<Array<{ dataAsOf: Date }>>(
    Prisma.sql`SELECT transaction_timestamp() AS "dataAsOf"`,
  );
  const dataAsOf = clocks[0]?.dataAsOf;
  if (!dataAsOf) throw new Error("Approval dataAsOf is unavailable");
  return dataAsOf;
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return ADMIN_APPROVAL_INSPECTION_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > ADMIN_APPROVAL_INSPECTION_MAX_LIMIT) {
    throw new AdminApprovalRuleError(
      "VALIDATION_ERROR",
      `limit must be an integer between 1 and ${ADMIN_APPROVAL_INSPECTION_MAX_LIMIT}`,
      { field: "limit" },
    );
  }
  return limit;
}

function optionalState(state: string | undefined): AdminApprovalState | undefined {
  if (state === undefined || state.trim() === "") return undefined;
  if (!(ADMIN_APPROVAL_STATES as readonly string[]).includes(state)) {
    throw new AdminApprovalRuleError(
      "VALIDATION_ERROR",
      `state must be one of ${ADMIN_APPROVAL_STATES.join(", ")}`,
      { field: "state" },
    );
  }
  return state as AdminApprovalState;
}

function optionalRange(
  from: Date | undefined,
  to: Date | undefined,
  field: string,
): { gte?: Date; lt?: Date } | undefined {
  if (!from && !to) return undefined;
  if (from && to && from.getTime() >= to.getTime()) {
    throw new AdminApprovalRuleError(
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
