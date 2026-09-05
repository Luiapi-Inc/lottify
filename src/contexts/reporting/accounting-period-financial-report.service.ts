import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../platform/persistence/prisma.service";

export type ReportingCompleteness = "CURRENT";

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

export interface AccountingPeriodFinancialReport {
  generatedAt: Date;
  dataAsOf: Date;
  projectionLagMs: 0;
  completeness: ReportingCompleteness;
  periods: readonly AccountingPeriodFinancialReportGroup[];
  corrections: readonly AccountingPeriodCorrectionLineage[];
}

@Injectable()
export class AccountingPeriodFinancialReportService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async build(): Promise<AccountingPeriodFinancialReport> {
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

        return {
          generatedAt: dataAsOf,
          dataAsOf,
          projectionLagMs: 0,
          completeness: "CURRENT",
          periods,
          corrections,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
