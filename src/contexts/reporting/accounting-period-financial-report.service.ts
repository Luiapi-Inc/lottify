import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../platform/persistence/prisma.service";
import { ReportingRuleError } from "./reporting-rule-error";

/**
 * Freshness/completeness states every Reporting output must declare
 * (Wayfinder Ticket 14, Reporting round 2). `REBUILDING` is reserved for a
 * Reporting projection that is being rebuilt; this report reads authoritative
 * Financial Transactions and Accounting Periods directly inside one
 * `RepeatableRead` snapshot, so it never reports `REBUILDING`.
 */
export const REPORTING_COMPLETENESS_STATES = [
  "CURRENT",
  "LAGGING",
  "PARTIAL",
  "REBUILDING",
] as const;
export type ReportingCompleteness = (typeof REPORTING_COMPLETENESS_STATES)[number];

/**
 * Declared reporting timezone for global/Admin aggregates (Ticket 14: "global/Admin
 * aggregates always declare their reporting timezone"). Reporting never derives
 * Accounting Period boundaries of its own: it groups by the authoritative
 * Accounting Period identity persisted by Wallet & Ledger, which is expressed in
 * `Asia/Bangkok` (Ticket 14 round 5). The declaration is asserted against that
 * authoritative timezone in `tests/integration/reporting-rest.integration.spec.ts`.
 */
export const REPORTING_TIME_ZONE = "Asia/Bangkok" as const;
export type ReportingTimeZone = typeof REPORTING_TIME_ZONE;

/**
 * Accounting Period states that can hold authoritative Financial Transactions.
 *
 * `DRAFT` and `PENDING_APPROVAL` are unactivated proposals and `CANCELLED` is a
 * never-opened window: none of them can host a posting, so none of them is
 * coverage. Counting them would let a report claim `CURRENT` for a window that
 * was never opened, which Ticket 14 forbids ("partial/lagging financial outputs
 * cannot masquerade as definitive data"). Declared locally because Reporting
 * consumes the authoritative period identity through its persisted state and
 * must not import Wallet & Ledger internals across the context boundary.
 */
export const REPORTING_POSTABLE_PERIOD_STATES = [
  "SCHEDULED",
  "OPEN",
  "CLOSING",
  "CLOSED",
] as const;

export interface AccountingPeriodFinancialReportGroup {
  accountingPeriodId: string;
  mode: string;
  generationKind: string;
  effectiveStart: Date;
  effectiveEnd: Date;
  state: string;
  transactionCount: number;
  debitAmountMinor: bigint;
  creditAmountMinor: bigint;
}

export interface AccountingPeriodCorrectionLineage {
  transactionId: string;
  correctionKind: string;
  accountingPeriodId: string;
  correctsTransactionId: string;
  originalAccountingPeriodId: string;
}

/** Half-open `[from, to)` reporting window. */
export interface AccountingPeriodReportRange {
  from: Date;
  to: Date;
  boundary: "half-open";
  /** How the window was declared: explicit instants or an authoritative Accounting Period. */
  source: "EXPLICIT" | "ACCOUNTING_PERIOD";
  accountingPeriodId: string | null;
}

export interface AccountingPeriodReportCoverageGap {
  from: Date;
  to: Date;
}

export interface AccountingPeriodReportCoverage {
  /** Authoritative (non-CANCELLED) Accounting Periods intersecting the window. */
  authoritativePeriodCount: number;
  /** Observable spans of the window no authoritative Accounting Period covers. */
  uncoveredRanges: readonly AccountingPeriodReportCoverageGap[];
  /** Span of the window that is later than `dataAsOf` and therefore not yet observable. */
  unobservedRange: AccountingPeriodReportCoverageGap | null;
}

export interface AccountingPeriodFinancialReport {
  generatedAt: Date;
  dataAsOf: Date;
  projectionLagMs: 0;
  completeness: ReportingCompleteness;
  reportingTimezone: ReportingTimeZone;
  range: AccountingPeriodReportRange | null;
  coverage: AccountingPeriodReportCoverage | null;
  periods: readonly AccountingPeriodFinancialReportGroup[];
  corrections: readonly AccountingPeriodCorrectionLineage[];
}

export interface AccountingPeriodReportRangeScope {
  from: Date;
  to: Date;
  timezone?: ReportingTimeZone;
}

export interface AccountingPeriodReportPeriodScope {
  accountingPeriodId: string;
  timezone?: ReportingTimeZone;
}

interface ReportSelection {
  range: AccountingPeriodReportRange;
}

@Injectable()
export class AccountingPeriodFinancialReportService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  /** Full report over every authoritative Accounting Period in the snapshot. */
  async build(): Promise<AccountingPeriodFinancialReport> {
    return this.execute(null, REPORTING_TIME_ZONE);
  }

  /**
   * Report for an explicit half-open `[from, to)` window. Facts are selected by the
   * accounting-period assignment authority (`postedAt`); grouping still uses the
   * authoritative Accounting Period identity, never a derived boundary.
   */
  async buildForRange(scope: AccountingPeriodReportRangeScope): Promise<AccountingPeriodFinancialReport> {
    const timezone = declaredTimeZone(scope.timezone);
    const range = explicitRange(scope.from, scope.to);
    return this.execute({ range }, timezone);
  }

  /**
   * Report for one authoritative Accounting Period identity: its stored half-open
   * bounds are the window, so no competing boundary is synthesized.
   */
  async buildForAccountingPeriod(
    scope: AccountingPeriodReportPeriodScope,
  ): Promise<AccountingPeriodFinancialReport> {
    const timezone = declaredTimeZone(scope.timezone);
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { id: scope.accountingPeriodId },
      select: { id: true, effectiveStart: true, effectiveEnd: true },
    });
    if (!period) {
      throw new ReportingRuleError("NOT_FOUND", "Accounting Period not found", {
        accountingPeriodId: scope.accountingPeriodId,
      });
    }
    return this.execute(
      {
        range: {
          from: period.effectiveStart,
          to: period.effectiveEnd,
          boundary: "half-open",
          source: "ACCOUNTING_PERIOD",
          accountingPeriodId: period.id,
        },
      },
      timezone,
    );
  }

  private async execute(
    selection: ReportSelection | null,
    reportingTimezone: ReportingTimeZone,
  ): Promise<AccountingPeriodFinancialReport> {
    return this.prisma.$transaction(
      async (tx) => {
        const clocks = await tx.$queryRaw<Array<{ dataAsOf: Date }>>(
          Prisma.sql`SELECT transaction_timestamp() AS "dataAsOf"`,
        );
        const dataAsOf = clocks[0]?.dataAsOf;
        if (!dataAsOf) {
          throw new Error("Reporting dataAsOf is unavailable");
        }

        const transactions = await tx.financialTransaction.findMany({
          where: selection
            ? { postedAt: { gte: selection.range.from, lt: selection.range.to } }
            : undefined,
          select: {
            id: true,
            accountingPeriodId: true,
            correctionKind: true,
            correctsTransactionId: true,
            postings: {
              select: { side: true, amountMinor: true },
            },
            accountingPeriod: {
              select: {
                id: true,
                mode: true,
                generationKind: true,
                effectiveStart: true,
                effectiveEnd: true,
                state: true,
              },
            },
            correctsTransaction: {
              select: { accountingPeriodId: true },
            },
          },
          orderBy: [{ accountingPeriodId: "asc" }, { id: "asc" }],
        });

        const { periods, corrections } = groupTransactions(transactions);

        const coverage = selection ? await buildCoverage(tx, selection.range, dataAsOf) : null;
        const completeness: ReportingCompleteness = !coverage
          ? "CURRENT"
          : coverage.unobservedRange
            ? "LAGGING"
            : coverage.uncoveredRanges.length > 0
              ? "PARTIAL"
              : "CURRENT";

        return {
          generatedAt: dataAsOf,
          dataAsOf,
          projectionLagMs: 0,
          completeness,
          reportingTimezone,
          range: selection?.range ?? null,
          coverage,
          periods,
          corrections,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

function declaredTimeZone(value: ReportingTimeZone | undefined): ReportingTimeZone {
  if (value === undefined || value === REPORTING_TIME_ZONE) return REPORTING_TIME_ZONE;
  throw new ReportingRuleError("UNSUPPORTED_REPORTING_TIME_ZONE", "Unsupported reporting timezone", {
    reportingTimezone: value,
    supported: [REPORTING_TIME_ZONE],
  });
}

function explicitRange(from: Date, to: Date): AccountingPeriodReportRange {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    throw new ReportingRuleError("VALIDATION_ERROR", "Reporting range instants must be valid", {});
  }
  if (from.getTime() >= to.getTime()) {
    throw new ReportingRuleError(
      "VALIDATION_ERROR",
      "Reporting range must be a non-empty half-open [from, to) window",
      { field: "from" },
    );
  }
  return { from, to, boundary: "half-open", source: "EXPLICIT", accountingPeriodId: null };
}

/**
 * Coverage is derived only from authoritative, postable Accounting Periods: a
 * CANCELLED period is never an authoritative accounting window (Ticket 14 round 7)
 * and an unactivated DRAFT/PENDING_APPROVAL proposal cannot host a posting, so
 * neither can make the requested window definitively reported.
 */
async function buildCoverage(
  tx: Prisma.TransactionClient,
  range: AccountingPeriodReportRange,
  dataAsOf: Date,
): Promise<AccountingPeriodReportCoverage> {
  const periods = await tx.accountingPeriod.findMany({
    where: {
      state: { in: [...REPORTING_POSTABLE_PERIOD_STATES] },
      effectiveStart: { lt: range.to },
      effectiveEnd: { gt: range.from },
    },
    select: { effectiveStart: true, effectiveEnd: true },
    orderBy: [{ effectiveStart: "asc" }, { id: "asc" }],
  });

  const observableEnd =
    range.to.getTime() > dataAsOf.getTime() ? dataAsOf : range.to;
  const unobservedRange =
    range.to.getTime() > dataAsOf.getTime()
      ? {
          from: range.from.getTime() > dataAsOf.getTime() ? range.from : dataAsOf,
          to: range.to,
        }
      : null;

  const uncoveredRanges: AccountingPeriodReportCoverageGap[] = [];
  if (observableEnd.getTime() > range.from.getTime()) {
    let coveredThrough = range.from;
    for (const period of periods) {
      const start = period.effectiveStart.getTime() < range.from.getTime() ? range.from : period.effectiveStart;
      const end = period.effectiveEnd.getTime() > observableEnd.getTime() ? observableEnd : period.effectiveEnd;
      if (end.getTime() <= coveredThrough.getTime()) continue;
      if (start.getTime() > coveredThrough.getTime()) {
        uncoveredRanges.push({ from: coveredThrough, to: start });
      }
      coveredThrough = end;
    }
    if (coveredThrough.getTime() < observableEnd.getTime()) {
      uncoveredRanges.push({ from: coveredThrough, to: observableEnd });
    }
  }

  return {
    authoritativePeriodCount: periods.length,
    uncoveredRanges,
    unobservedRange,
  };
}

interface ReportTransaction {
  id: string;
  accountingPeriodId: string;
  correctionKind: string | null;
  correctsTransactionId: string | null;
  postings: readonly { side: string; amountMinor: bigint }[];
  accountingPeriod: {
    id: string;
    mode: string;
    generationKind: string;
    effectiveStart: Date;
    effectiveEnd: Date;
    state: string;
  };
  correctsTransaction: { accountingPeriodId: string } | null;
}

function groupTransactions(transactions: readonly ReportTransaction[]): {
  periods: AccountingPeriodFinancialReportGroup[];
  corrections: AccountingPeriodCorrectionLineage[];
} {
  const groups = new Map<string, AccountingPeriodFinancialReportGroup>();
  const corrections: AccountingPeriodCorrectionLineage[] = [];

  for (const transaction of transactions) {
    if (transaction.accountingPeriod.id !== transaction.accountingPeriodId) {
      throw new Error("Financial Transaction Accounting Period relation is inconsistent");
    }

    let group = groups.get(transaction.accountingPeriodId);
    if (!group) {
      group = {
        accountingPeriodId: transaction.accountingPeriodId,
        mode: transaction.accountingPeriod.mode,
        generationKind: transaction.accountingPeriod.generationKind,
        effectiveStart: transaction.accountingPeriod.effectiveStart,
        effectiveEnd: transaction.accountingPeriod.effectiveEnd,
        state: transaction.accountingPeriod.state,
        transactionCount: 0,
        debitAmountMinor: 0n,
        creditAmountMinor: 0n,
      };
      groups.set(transaction.accountingPeriodId, group);
    }

    group.transactionCount += 1;
    for (const posting of transaction.postings) {
      if (posting.side === "DEBIT") {
        group.debitAmountMinor += posting.amountMinor;
      } else if (posting.side === "CREDIT") {
        group.creditAmountMinor += posting.amountMinor;
      } else {
        throw new Error(`Unsupported Ledger posting side: ${posting.side}`);
      }
    }

    if (transaction.correctionKind || transaction.correctsTransactionId) {
      if (
        !transaction.correctionKind ||
        !transaction.correctsTransactionId ||
        !transaction.correctsTransaction
      ) {
        throw new Error("Financial correction lineage is incomplete");
      }
      corrections.push({
        transactionId: transaction.id,
        correctionKind: transaction.correctionKind,
        accountingPeriodId: transaction.accountingPeriodId,
        correctsTransactionId: transaction.correctsTransactionId,
        originalAccountingPeriodId: transaction.correctsTransaction.accountingPeriodId,
      });
    }
  }

  const periods = [...groups.values()].sort(
    (left, right) =>
      left.effectiveStart.getTime() - right.effectiveStart.getTime() ||
      left.accountingPeriodId.localeCompare(right.accountingPeriodId),
  );

  return { periods, corrections };
}
