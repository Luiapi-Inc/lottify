import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  LEDGER_WALLET_PROJECTION_PORT,
  RECONCILIATION_MEMBER_BUCKETS,
  type LedgerWalletProjectionPort,
  type ReconciliationCurrency,
  type ReconciliationMemberBucket,
  type ReconciliationWalletProjection,
} from "./ledger-wallet-projection.port";
import {
  LEDGER_WALLET_SOURCE_PORT,
  type LedgerWalletSourcePort,
  type ReconciliationSourceSnapshot,
} from "./ledger-wallet-source.port";
import { PrismaService } from "../../platform/persistence/prisma.service";

const RECONCILIATION_PAIR = "LEDGER_WALLET" as const;
const RECONCILIATION_RESULT_MATCHED = "MATCHED" as const;
const RECONCILIATION_RESULT_MISMATCH = "MISMATCH" as const;

type ReconciliationResult =
  | typeof RECONCILIATION_RESULT_MATCHED
  | typeof RECONCILIATION_RESULT_MISMATCH;

type ReconciliationMetric = "postedMinor" | "reservedMinor" | "availableMinor";

export interface LedgerWalletReconciliationInput {
  checkpointKey: string;
  memberId: string;
  currency?: ReconciliationCurrency;
}

export interface LedgerWalletReconciliationResult {
  id: string;
  checkpointKey: string;
  memberId: string;
  currency: ReconciliationCurrency;
  asOf: Date;
  result: ReconciliationResult;
  discrepancyCount: number;
}

interface ExpectedBucket {
  bucket: ReconciliationMemberBucket;
  accountId: string | null;
  postedMinor: bigint;
  reservedMinor: bigint;
  availableMinor: bigint;
}

interface ExpectedEvidence {
  buckets: readonly ExpectedBucket[];
  ledgerAccountCount: number;
  ledgerPostingCount: number;
  activeReservationAllocationCount: number;
  latestLedgerPosting: { id: string; postedAt: Date } | null;
  latestReservation: { id: string; createdAt: Date } | null;
}

interface Difference {
  identityKey: string;
  bucket: ReconciliationMemberBucket;
  metric: ReconciliationMetric;
  expectedMinor: bigint;
  observedMinor: bigint;
  accountId: string | null;
}

@Injectable()
export class LedgerWalletReconciliationService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(LEDGER_WALLET_PROJECTION_PORT)
    private readonly walletProjection: LedgerWalletProjectionPort,
    @Inject(LEDGER_WALLET_SOURCE_PORT)
    private readonly walletSource: LedgerWalletSourcePort,
  ) {}

  async run(input: LedgerWalletReconciliationInput): Promise<LedgerWalletReconciliationResult> {
    const currency = input.currency ?? "THB";
    const fingerprint = reconciliationFingerprint(input.memberId, currency);
    const replay = await this.findReplay(input.checkpointKey, fingerprint);
    if (replay) return replay;

    const observed = await this.walletProjection.getWalletProjection(input.memberId, currency);
    const expected = await this.buildExpectedAt(input.memberId, currency, observed.dataAsOf);
    const differences = compareProjection(expected.buckets, observed);
    const result: ReconciliationResult =
      differences.length === 0 ? RECONCILIATION_RESULT_MATCHED : RECONCILIATION_RESULT_MISMATCH;

    const expectedTotals = sumExpectedBuckets(expected.buckets);
    const observedTotals = sumObservedBuckets(observed);
    const sourceRange = {
      ledgerPostedAt: { through: observed.dataAsOf.toISOString() },
      reservationLifecycle: { through: observed.dataAsOf.toISOString() },
    };
    const sourceCheckpoint = {
      checkpointKey: input.checkpointKey,
      memberId: input.memberId,
      currency,
      asOf: observed.dataAsOf.toISOString(),
      ...(expected.latestLedgerPosting
        ? {
            latestLedgerPostingId: expected.latestLedgerPosting.id,
            latestLedgerPostingAt: expected.latestLedgerPosting.postedAt.toISOString(),
          }
        : {}),
      ...(expected.latestReservation
        ? {
            latestReservationId: expected.latestReservation.id,
            latestReservationCreatedAt: expected.latestReservation.createdAt.toISOString(),
          }
        : {}),
    };
    const inspectedCounts = {
      ledgerAccounts: expected.ledgerAccountCount,
      ledgerPostings: expected.ledgerPostingCount,
      activeReservationAllocations: expected.activeReservationAllocationCount,
      walletBuckets: observed.buckets.length,
      discrepancies: differences.length,
    };
    const totals = {
      expected: bigintTotalsToJson(expectedTotals),
      observed: bigintTotalsToJson(observedTotals),
      difference: bigintTotalsToJson({
        postedMinor: observedTotals.postedMinor - expectedTotals.postedMinor,
        reservedMinor: observedTotals.reservedMinor - expectedTotals.reservedMinor,
        availableMinor: observedTotals.availableMinor - expectedTotals.availableMinor,
      }),
    };
    const resultSummary = {
      matched: differences.length === 0,
      discrepancyCount: differences.length,
      bucketCount: RECONCILIATION_MEMBER_BUCKETS.length,
    };

    try {
      const created = await this.prisma.reconciliationRun.create({
        data: {
          pair: RECONCILIATION_PAIR,
          checkpointKey: input.checkpointKey,
          fingerprint,
          memberId: input.memberId,
          currency,
          asOf: observed.dataAsOf,
          sourceRange,
          sourceCheckpoint,
          inspectedCounts,
          totals,
          result,
          resultSummary,
          discrepancies: {
            create: differences.map((difference) => ({
              identityKey: difference.identityKey,
              status: "DETECTED",
              severity: "ERROR",
              expectedFacts: discrepancyFacts(input.memberId, currency, difference, "expected"),
              observedFacts: discrepancyFacts(input.memberId, currency, difference, "observed"),
              amountDifferenceMinor: difference.observedMinor - difference.expectedMinor,
              sourceReferences: {
                pair: RECONCILIATION_PAIR,
                checkpointKey: input.checkpointKey,
                memberId: input.memberId,
                ...(difference.accountId ? { ledgerAccountId: difference.accountId } : {}),
              },
              detectedAt: observed.dataAsOf,
              resolutionTrail: [],
            })),
          },
        },
        include: { discrepancies: { select: { id: true } } },
      });
      return {
        id: created.id,
        checkpointKey: created.checkpointKey,
        memberId: created.memberId,
        currency: assertFinancialCurrency(created.currency),
        asOf: created.asOf,
        result: assertReconciliationResult(created.result),
        discrepancyCount: created.discrepancies.length,
      };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const racedReplay = await this.findReplay(input.checkpointKey, fingerprint);
      if (racedReplay) return racedReplay;
      throw error;
    }
  }

  private async findReplay(
    checkpointKey: string,
    fingerprint: string,
  ): Promise<LedgerWalletReconciliationResult | null> {
    const existing = await this.prisma.reconciliationRun.findUnique({
      where: {
        pair_checkpointKey: { pair: RECONCILIATION_PAIR, checkpointKey },
      },
      include: { discrepancies: { select: { id: true } } },
    });
    if (!existing) return null;
    if (existing.fingerprint !== fingerprint) {
      throw new Error("Reconciliation checkpoint idempotency conflict");
    }
    return {
      id: existing.id,
      checkpointKey: existing.checkpointKey,
      memberId: existing.memberId,
      currency: assertFinancialCurrency(existing.currency),
      asOf: existing.asOf,
      result: assertReconciliationResult(existing.result),
      discrepancyCount: existing.discrepancies.length,
    };
  }

  private async buildExpectedAt(
    memberId: string,
    currency: ReconciliationCurrency,
    asOf: Date,
  ): Promise<ExpectedEvidence> {
    const source = await this.walletSource.getReconciliationSourceSnapshot(memberId, currency, asOf);
    return expectedEvidenceFromSource(source);
  }
}

function expectedEvidenceFromSource(source: ReconciliationSourceSnapshot): ExpectedEvidence {
  const buckets = source.buckets.map((bucket) => {
    const derivedAvailableMinor = bucket.postedMinor - bucket.reservedMinor;
    return {
      ...bucket,
      availableMinor:
        bucket.bucket === "LOCKED" || derivedAvailableMinor < 0n ? 0n : derivedAvailableMinor,
    };
  });
  const cashPostedMinor = buckets.find((bucket) => bucket.bucket === "CASH")?.postedMinor ?? 0n;
  return {
    buckets:
      cashPostedMinor < 0n
        ? buckets.map((bucket) => ({ ...bucket, availableMinor: 0n }))
        : buckets,
    ledgerAccountCount: source.ledgerAccountCount,
    ledgerPostingCount: source.ledgerPostingCount,
    activeReservationAllocationCount: source.activeReservationAllocationCount,
    latestLedgerPosting: source.latestLedgerPosting,
    latestReservation: source.latestReservation,
  };
}

function compareProjection(
  expectedBuckets: readonly ExpectedBucket[],
  observed: ReconciliationWalletProjection,
): Difference[] {
  const observedByBucket = new Map(observed.buckets.map((bucket) => [bucket.bucket, bucket]));
  const metrics: readonly ReconciliationMetric[] = [
    "postedMinor",
    "reservedMinor",
    "availableMinor",
  ];
  const differences: Difference[] = [];
  for (const expected of expectedBuckets) {
    const observedBucket = observedByBucket.get(expected.bucket) ?? {
      bucket: expected.bucket,
      postedMinor: 0n,
      reservedMinor: 0n,
      availableMinor: 0n,
    };
    for (const metric of metrics) {
      if (expected[metric] === observedBucket[metric]) continue;
      differences.push({
        identityKey: `${expected.bucket}:${metric}`,
        bucket: expected.bucket,
        metric,
        expectedMinor: expected[metric],
        observedMinor: observedBucket[metric],
        accountId: expected.accountId,
      });
    }
  }
  return differences;
}

function reconciliationFingerprint(memberId: string, currency: ReconciliationCurrency): string {
  return createHash("sha256").update(`${memberId}\u0000${currency}`).digest("hex");
}

function discrepancyFacts(
  memberId: string,
  currency: ReconciliationCurrency,
  difference: Difference,
  side: "expected" | "observed",
): Record<string, string> {
  return {
    memberId,
    currency,
    bucket: difference.bucket,
    metric: difference.metric,
    amountMinor:
      side === "expected"
        ? difference.expectedMinor.toString()
        : difference.observedMinor.toString(),
  };
}

function sumExpectedBuckets(buckets: readonly ExpectedBucket[]): {
  postedMinor: bigint;
  reservedMinor: bigint;
  availableMinor: bigint;
} {
  return buckets.reduce(
    (totals, bucket) => ({
      postedMinor: totals.postedMinor + bucket.postedMinor,
      reservedMinor: totals.reservedMinor + bucket.reservedMinor,
      availableMinor: totals.availableMinor + bucket.availableMinor,
    }),
    { postedMinor: 0n, reservedMinor: 0n, availableMinor: 0n },
  );
}

function sumObservedBuckets(projection: ReconciliationWalletProjection): {
  postedMinor: bigint;
  reservedMinor: bigint;
  availableMinor: bigint;
} {
  return projection.buckets.reduce(
    (totals, bucket) => ({
      postedMinor: totals.postedMinor + bucket.postedMinor,
      reservedMinor: totals.reservedMinor + bucket.reservedMinor,
      availableMinor: totals.availableMinor + bucket.availableMinor,
    }),
    { postedMinor: 0n, reservedMinor: 0n, availableMinor: 0n },
  );
}

function bigintTotalsToJson(totals: {
  postedMinor: bigint;
  reservedMinor: bigint;
  availableMinor: bigint;
}): Record<string, string> {
  return {
    postedMinor: totals.postedMinor.toString(),
    reservedMinor: totals.reservedMinor.toString(),
    availableMinor: totals.availableMinor.toString(),
  };
}

function assertFinancialCurrency(value: string): ReconciliationCurrency {
  if (value !== "THB") throw new Error(`Unsupported reconciliation currency: ${value}`);
  return value;
}

function assertReconciliationResult(value: string): ReconciliationResult {
  if (value !== RECONCILIATION_RESULT_MATCHED && value !== RECONCILIATION_RESULT_MISMATCH) {
    throw new Error(`Unsupported reconciliation result: ${value}`);
  }
  return value;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
