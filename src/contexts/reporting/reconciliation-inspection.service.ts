import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../platform/persistence/prisma.service";
import { ReportingRuleError } from "./reporting-rule-error";

/**
 * Reconciliation pair exposed by this read surface. Reporting owns reconciliation
 * evidence for every authoritative pair (Ticket 14 round 2); only the merged
 * Ledger ↔ Wallet pair has an accepted implementation today, so the Admin surface
 * is scoped to it rather than inventing evidence for the others.
 */
export const RECONCILIATION_PAIR = "LEDGER_WALLET" as const;
export type ReconciliationPair = typeof RECONCILIATION_PAIR;

export const RECONCILIATION_RESULTS = ["MATCHED", "MISMATCH"] as const;
export type ReconciliationResult = (typeof RECONCILIATION_RESULTS)[number];

/** `DETECTED → INVESTIGATING → RESOLUTION_PENDING → RESOLVED` (Ticket 14 round 2). */
export const RECONCILIATION_DISCREPANCY_STATUSES = [
  "DETECTED",
  "INVESTIGATING",
  "RESOLUTION_PENDING",
  "RESOLVED",
] as const;
export type ReconciliationDiscrepancyStatus =
  (typeof RECONCILIATION_DISCREPANCY_STATUSES)[number];

/** Governed outcomes a RESOLVED discrepancy may carry. */
export const RECONCILIATION_DISCREPANCY_OUTCOMES = [
  "FALSE_POSITIVE",
  "ACCEPTED_EXCEPTION",
] as const;
export type ReconciliationDiscrepancyOutcome =
  (typeof RECONCILIATION_DISCREPANCY_OUTCOMES)[number];

export const RECONCILIATION_DISCREPANCY_SEVERITIES = ["ERROR", "CRITICAL"] as const;
export type ReconciliationDiscrepancySeverity =
  (typeof RECONCILIATION_DISCREPANCY_SEVERITIES)[number];

export const RECONCILIATION_CURRENCIES = ["THB"] as const;
export type ReconciliationCurrency = (typeof RECONCILIATION_CURRENCIES)[number];

export const RECONCILIATION_INSPECTION_DEFAULT_LIMIT = 25;
export const RECONCILIATION_INSPECTION_MAX_LIMIT = 100;

export interface ReconciliationInspectedCounts {
  ledgerAccounts: number;
  ledgerPostings: number;
  activeReservationAllocations: number;
  walletBuckets: number;
  discrepancies: number;
}

export interface ReconciliationSourceRange {
  ledgerPostedAt: { through: string };
  reservationLifecycle: { through: string };
}

export interface ReconciliationSourceCheckpoint {
  checkpointKey: string;
  memberId: string;
  currency: string;
  asOf: string;
  latestLedgerPostingId: string | null;
  latestLedgerPostingAt: string | null;
  latestReservationId: string | null;
  latestReservationCreatedAt: string | null;
}

export interface ReconciliationTotals {
  expected: Record<string, string>;
  observed: Record<string, string>;
  difference: Record<string, string>;
}

export interface ReconciliationResultSummary {
  matched: boolean;
  discrepancyCount: number;
  bucketCount: number;
}

export interface ReconciliationRunInspection {
  id: string;
  pair: ReconciliationPair;
  checkpointKey: string;
  memberId: string;
  currency: string;
  asOf: Date;
  createdAt: Date;
  sourceRange: ReconciliationSourceRange;
  sourceCheckpoint: ReconciliationSourceCheckpoint;
  inspectedCounts: ReconciliationInspectedCounts;
  totals: ReconciliationTotals;
  result: ReconciliationResult;
  resultSummary: ReconciliationResultSummary;
  discrepancyCount: number;
}

export interface ReconciliationDiscrepancyFacts {
  memberId: string;
  currency: string;
  bucket: string;
  metric: string;
  amountMinor: string;
}

export interface ReconciliationDiscrepancySourceReferences {
  pair: string;
  checkpointKey: string;
  memberId: string;
  ledgerAccountId: string | null;
}

export interface ReconciliationDiscrepancyInspection {
  id: string;
  reconciliationRunId: string;
  pair: ReconciliationPair;
  identityKey: string;
  memberId: string;
  currency: string;
  status: string;
  severity: string;
  expectedFacts: ReconciliationDiscrepancyFacts;
  observedFacts: ReconciliationDiscrepancyFacts;
  amountDifferenceMinor: string | null;
  sourceReferences: ReconciliationDiscrepancySourceReferences;
  detectedAt: Date;
  /** Detection age evaluated against the report's `dataAsOf`, never the client clock. */
  ageMs: number;
  ownerReference: string | null;
  resolutionTrail: readonly Record<string, unknown>[];
  resolutionEvidence: Record<string, unknown> | null;
  outcome: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReconciliationRunListQuery {
  memberId?: string;
  currency?: string;
  result?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
}

export interface ReconciliationDiscrepancyListQuery {
  runId?: string;
  memberId?: string;
  currency?: string;
  status?: string;
  severity?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
}

export interface ReconciliationRunPage {
  items: readonly ReconciliationRunInspection[];
  nextCursor: string | null;
  dataAsOf: Date;
}

export interface ReconciliationDiscrepancyPage {
  items: readonly ReconciliationDiscrepancyInspection[];
  nextCursor: string | null;
  dataAsOf: Date;
}

const RUN_EVIDENCE_SELECT = {
  id: true,
  pair: true,
  checkpointKey: true,
  memberId: true,
  currency: true,
  asOf: true,
  createdAt: true,
  sourceRange: true,
  sourceCheckpoint: true,
  inspectedCounts: true,
  totals: true,
  result: true,
  resultSummary: true,
} as const;

const DISCREPANCY_SELECT = {
  id: true,
  reconciliationRunId: true,
  identityKey: true,
  status: true,
  severity: true,
  expectedFacts: true,
  observedFacts: true,
  amountDifferenceMinor: true,
  sourceReferences: true,
  detectedAt: true,
  ownerReference: true,
  resolutionTrail: true,
  resolutionEvidence: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
  reconciliationRun: { select: { pair: true, memberId: true, currency: true } },
} as const;

type RunEvidenceRow = {
  id: string;
  pair: string;
  checkpointKey: string;
  memberId: string;
  currency: string;
  asOf: Date;
  createdAt: Date;
  sourceRange: Prisma.JsonValue;
  sourceCheckpoint: Prisma.JsonValue;
  inspectedCounts: Prisma.JsonValue;
  totals: Prisma.JsonValue;
  result: string;
  resultSummary: Prisma.JsonValue;
};

type DiscrepancyRow = {
  id: string;
  reconciliationRunId: string;
  identityKey: string;
  status: string;
  severity: string;
  expectedFacts: Prisma.JsonValue;
  observedFacts: Prisma.JsonValue;
  amountDifferenceMinor: bigint | null;
  sourceReferences: Prisma.JsonValue;
  detectedAt: Date;
  ownerReference: string | null;
  resolutionTrail: Prisma.JsonValue;
  resolutionEvidence: Prisma.JsonValue | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  reconciliationRun: { pair: string; memberId: string; currency: string };
};

/**
 * Read model over durable Reporting reconciliation evidence. It exposes exactly the
 * run/discrepancy fields the accepted reconciliation service persists, with
 * allowlisted filters, and never joins authoritative financial tables or offers a
 * generic query surface.
 */
@Injectable()
export class ReconciliationInspectionService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async listRuns(query: ReconciliationRunListQuery): Promise<ReconciliationRunPage> {
    const limit = boundedLimit(query.limit);
    const currency = optionalCurrency(query.currency);
    const result = optionalResult(query.result);
    const asOf = optionalRange(query.from, query.to, "asOf");
    const where: Prisma.ReconciliationRunWhereInput = {
      pair: RECONCILIATION_PAIR,
      ...(query.memberId ? { memberId: query.memberId } : {}),
      ...(currency ? { currency } : {}),
      ...(result ? { result } : {}),
      ...(asOf ? { asOf } : {}),
    };

    const { clock, rows } = await this.prisma.$transaction(
      async (tx) => {
        const dataAsOf = await readDataAsOf(tx);
        const evidence = await tx.reconciliationRun.findMany({
          where,
          orderBy: [{ asOf: "desc" }, { id: "desc" }],
          take: limit + 1,
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
          select: { ...RUN_EVIDENCE_SELECT, _count: { select: { discrepancies: true } } },
        });
        return { clock: dataAsOf, rows: evidence };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const page = rows.slice(0, limit);
    return {
      items: page.map((row) =>
        toRunInspection(row, row._count.discrepancies),
      ),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
      dataAsOf: clock,
    };
  }

  async getRun(id: string): Promise<ReconciliationRunInspection> {
    const { row } = await this.prisma.$transaction(
      async (tx) => {
        await readDataAsOf(tx);
        const evidence = await tx.reconciliationRun.findFirst({
          where: { id, pair: RECONCILIATION_PAIR },
          select: { ...RUN_EVIDENCE_SELECT, _count: { select: { discrepancies: true } } },
        });
        return { row: evidence };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (!row) {
      throw new ReportingRuleError("NOT_FOUND", "Reconciliation run not found", { id });
    }
    return toRunInspection(row, row._count.discrepancies);
  }

  async listDiscrepancies(
    query: ReconciliationDiscrepancyListQuery,
  ): Promise<ReconciliationDiscrepancyPage> {
    const limit = boundedLimit(query.limit);
    const currency = optionalCurrency(query.currency);
    const status = optionalStatus(query.status);
    const severity = optionalSeverity(query.severity);
    const detectedAt = optionalRange(query.from, query.to, "detectedAt");
    const runScope: Prisma.ReconciliationRunWhereInput = {
      pair: RECONCILIATION_PAIR,
      ...(query.memberId ? { memberId: query.memberId } : {}),
      ...(currency ? { currency } : {}),
    };
    const where: Prisma.ReconciliationDiscrepancyWhereInput = {
      ...(query.runId ? { reconciliationRunId: query.runId } : {}),
      ...(status ? { status } : {}),
      ...(severity ? { severity } : {}),
      ...(detectedAt ? { detectedAt } : {}),
      reconciliationRun: runScope,
    };

    const { clock, rows } = await this.prisma.$transaction(
      async (tx) => {
        const dataAsOf = await readDataAsOf(tx);
        const evidence = await tx.reconciliationDiscrepancy.findMany({
          where,
          orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
          select: DISCREPANCY_SELECT,
        });
        return { clock: dataAsOf, rows: evidence };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => toDiscrepancyInspection(row, clock)),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
      dataAsOf: clock,
    };
  }

  async getDiscrepancy(id: string): Promise<ReconciliationDiscrepancyInspection> {
    const { clock, row } = await this.prisma.$transaction(
      async (tx) => {
        const dataAsOf = await readDataAsOf(tx);
        const evidence = await tx.reconciliationDiscrepancy.findFirst({
          where: { id, reconciliationRun: { pair: RECONCILIATION_PAIR } },
          select: DISCREPANCY_SELECT,
        });
        return { clock: dataAsOf, row: evidence };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (!row) {
      throw new ReportingRuleError("NOT_FOUND", "Reconciliation discrepancy not found", { id });
    }
    return toDiscrepancyInspection(row, clock);
  }
}

async function readDataAsOf(tx: Prisma.TransactionClient): Promise<Date> {
  const clocks = await tx.$queryRaw<Array<{ dataAsOf: Date }>>(
    Prisma.sql`SELECT transaction_timestamp() AS "dataAsOf"`,
  );
  const dataAsOf = clocks[0]?.dataAsOf;
  if (!dataAsOf) throw new Error("Reporting dataAsOf is unavailable");
  return dataAsOf;
}

function toRunInspection(row: RunEvidenceRow, discrepancyCount: number): ReconciliationRunInspection {
  if (row.pair !== RECONCILIATION_PAIR) {
    throw new ReportingRuleError("EVIDENCE_MALFORMED", "Unsupported reconciliation pair", {
      pair: row.pair,
    });
  }
  if (row.result !== "MATCHED" && row.result !== "MISMATCH") {
    throw new ReportingRuleError("EVIDENCE_MALFORMED", "Unsupported reconciliation result", {
      result: row.result,
    });
  }
  const sourceRange = asRecord(row.sourceRange, "sourceRange");
  const sourceCheckpoint = asRecord(row.sourceCheckpoint, "sourceCheckpoint");
  const inspectedCounts = asRecord(row.inspectedCounts, "inspectedCounts");
  const totals = asRecord(row.totals, "totals");
  const resultSummary = asRecord(row.resultSummary, "resultSummary");
  const ledgerPostedAt = asRecord(sourceRange.ledgerPostedAt, "sourceRange.ledgerPostedAt");
  const reservationLifecycle = asRecord(
    sourceRange.reservationLifecycle,
    "sourceRange.reservationLifecycle",
  );

  return {
    id: row.id,
    pair: RECONCILIATION_PAIR,
    checkpointKey: row.checkpointKey,
    memberId: row.memberId,
    currency: row.currency,
    asOf: row.asOf,
    createdAt: row.createdAt,
    sourceRange: {
      ledgerPostedAt: { through: asString(ledgerPostedAt.through, "sourceRange.ledgerPostedAt.through") },
      reservationLifecycle: {
        through: asString(
          reservationLifecycle.through,
          "sourceRange.reservationLifecycle.through",
        ),
      },
    },
    sourceCheckpoint: {
      checkpointKey: asString(sourceCheckpoint.checkpointKey, "sourceCheckpoint.checkpointKey"),
      memberId: asString(sourceCheckpoint.memberId, "sourceCheckpoint.memberId"),
      currency: asString(sourceCheckpoint.currency, "sourceCheckpoint.currency"),
      asOf: asString(sourceCheckpoint.asOf, "sourceCheckpoint.asOf"),
      latestLedgerPostingId: optionalString(
        sourceCheckpoint.latestLedgerPostingId,
        "sourceCheckpoint.latestLedgerPostingId",
      ),
      latestLedgerPostingAt: optionalString(
        sourceCheckpoint.latestLedgerPostingAt,
        "sourceCheckpoint.latestLedgerPostingAt",
      ),
      latestReservationId: optionalString(
        sourceCheckpoint.latestReservationId,
        "sourceCheckpoint.latestReservationId",
      ),
      latestReservationCreatedAt: optionalString(
        sourceCheckpoint.latestReservationCreatedAt,
        "sourceCheckpoint.latestReservationCreatedAt",
      ),
    },
    inspectedCounts: {
      ledgerAccounts: asCount(inspectedCounts.ledgerAccounts, "inspectedCounts.ledgerAccounts"),
      ledgerPostings: asCount(inspectedCounts.ledgerPostings, "inspectedCounts.ledgerPostings"),
      activeReservationAllocations: asCount(
        inspectedCounts.activeReservationAllocations,
        "inspectedCounts.activeReservationAllocations",
      ),
      walletBuckets: asCount(inspectedCounts.walletBuckets, "inspectedCounts.walletBuckets"),
      discrepancies: asCount(inspectedCounts.discrepancies, "inspectedCounts.discrepancies"),
    },
    totals: {
      expected: asStringRecord(totals.expected, "totals.expected"),
      observed: asStringRecord(totals.observed, "totals.observed"),
      difference: asStringRecord(totals.difference, "totals.difference"),
    },
    result: row.result,
    resultSummary: {
      matched: asBoolean(resultSummary.matched, "resultSummary.matched"),
      discrepancyCount: asCount(resultSummary.discrepancyCount, "resultSummary.discrepancyCount"),
      bucketCount: asCount(resultSummary.bucketCount, "resultSummary.bucketCount"),
    },
    discrepancyCount,
  };
}

function toDiscrepancyInspection(
  row: DiscrepancyRow,
  dataAsOf: Date,
): ReconciliationDiscrepancyInspection {
  if (row.reconciliationRun.pair !== RECONCILIATION_PAIR) {
    throw new ReportingRuleError("EVIDENCE_MALFORMED", "Unsupported reconciliation pair", {
      pair: row.reconciliationRun.pair,
    });
  }
  const expectedFacts = asRecord(row.expectedFacts, "expectedFacts");
  const observedFacts = asRecord(row.observedFacts, "observedFacts");
  const sourceReferences = asRecord(row.sourceReferences, "sourceReferences");
  const resolutionEvidence = nullableRecord(row.resolutionEvidence, "resolutionEvidence");
  const ageMs = Math.max(0, dataAsOf.getTime() - row.detectedAt.getTime());

  return {
    id: row.id,
    reconciliationRunId: row.reconciliationRunId,
    pair: RECONCILIATION_PAIR,
    identityKey: row.identityKey,
    memberId: row.reconciliationRun.memberId,
    currency: row.reconciliationRun.currency,
    status: row.status,
    severity: row.severity,
    expectedFacts: toFacts(expectedFacts, "expectedFacts"),
    observedFacts: toFacts(observedFacts, "observedFacts"),
    amountDifferenceMinor: row.amountDifferenceMinor === null ? null : row.amountDifferenceMinor.toString(),
    sourceReferences: {
      pair: asString(sourceReferences.pair, "sourceReferences.pair"),
      checkpointKey: asString(sourceReferences.checkpointKey, "sourceReferences.checkpointKey"),
      memberId: asString(sourceReferences.memberId, "sourceReferences.memberId"),
      ledgerAccountId: optionalString(sourceReferences.ledgerAccountId, "sourceReferences.ledgerAccountId"),
    },
    detectedAt: row.detectedAt,
    ageMs,
    ownerReference: row.ownerReference,
    resolutionTrail: asRecordArray(row.resolutionTrail, "resolutionTrail"),
    resolutionEvidence,
    outcome: optionalString(resolutionEvidence?.outcome, "resolutionEvidence.outcome"),
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toFacts(
  record: Record<string, unknown>,
  field: string,
): ReconciliationDiscrepancyFacts {
  return {
    memberId: asString(record.memberId, `${field}.memberId`),
    currency: asString(record.currency, `${field}.currency`),
    bucket: asString(record.bucket, `${field}.bucket`),
    metric: asString(record.metric, `${field}.metric`),
    amountMinor: asString(record.amountMinor, `${field}.amountMinor`),
  };
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return RECONCILIATION_INSPECTION_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > RECONCILIATION_INSPECTION_MAX_LIMIT) {
    throw new ReportingRuleError(
      "VALIDATION_ERROR",
      `limit must be an integer between 1 and ${RECONCILIATION_INSPECTION_MAX_LIMIT}`,
      { field: "limit" },
    );
  }
  return limit;
}

function optionalCurrency(currency: string | undefined): string | undefined {
  if (currency === undefined || currency.trim() === "") return undefined;
  if (!(RECONCILIATION_CURRENCIES as readonly string[]).includes(currency)) {
    throw new ReportingRuleError("VALIDATION_ERROR", "currency must be THB", { field: "currency" });
  }
  return currency;
}

function optionalResult(result: string | undefined): string | undefined {
  if (result === undefined || result.trim() === "") return undefined;
  if (!(RECONCILIATION_RESULTS as readonly string[]).includes(result)) {
    throw new ReportingRuleError("VALIDATION_ERROR", "result must be MATCHED or MISMATCH", {
      field: "result",
    });
  }
  return result;
}

function optionalStatus(status: string | undefined): string | undefined {
  if (status === undefined || status.trim() === "") return undefined;
  if (!(RECONCILIATION_DISCREPANCY_STATUSES as readonly string[]).includes(status)) {
    throw new ReportingRuleError(
      "VALIDATION_ERROR",
      `status must be one of ${RECONCILIATION_DISCREPANCY_STATUSES.join(", ")}`,
      { field: "status" },
    );
  }
  return status;
}

function optionalSeverity(severity: string | undefined): string | undefined {
  if (severity === undefined || severity.trim() === "") return undefined;
  if (!(RECONCILIATION_DISCREPANCY_SEVERITIES as readonly string[]).includes(severity)) {
    throw new ReportingRuleError("VALIDATION_ERROR", "severity must be ERROR or CRITICAL", {
      field: "severity",
    });
  }
  return severity;
}

function optionalRange(
  from: Date | undefined,
  to: Date | undefined,
  field: string,
): { gte?: Date; lt?: Date } | undefined {
  if (!from && !to) return undefined;
  if (from && to && from.getTime() >= to.getTime()) {
    throw new ReportingRuleError(
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

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReportingRuleError("EVIDENCE_MALFORMED", `Persisted ${field} evidence is not an object`, {
      field,
    });
  }
  return value as Record<string, unknown>;
}

function nullableRecord(value: unknown, field: string): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  return asRecord(value, field);
}

function asRecordArray(value: unknown, field: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new ReportingRuleError("EVIDENCE_MALFORMED", `Persisted ${field} evidence is not a list`, {
      field,
    });
  }
  return value.map((entry) => asRecord(entry, field));
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ReportingRuleError("EVIDENCE_MALFORMED", `Persisted ${field} evidence is not a string`, {
      field,
    });
  }
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return asString(value, field);
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ReportingRuleError("EVIDENCE_MALFORMED", `Persisted ${field} evidence is not a boolean`, {
      field,
    });
  }
  return value;
}

function asCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ReportingRuleError("EVIDENCE_MALFORMED", `Persisted ${field} evidence is not an integer`, {
      field,
    });
  }
  return value;
}

function asStringRecord(value: unknown, field: string): Record<string, string> {
  const record = asRecord(value, field);
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, asString(entry, `${field}.${key}`)]),
  );
}
