import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { automaticWeeklyAccountingPeriodBounds } from "../domain/accounting-period";

type TransactionClient = Prisma.TransactionClient;

const EFFECTIVE_STATES = ["SCHEDULED", "OPEN", "CLOSING", "CLOSED"] as const;

export interface AccountingPeriodTransactionClock {
  now(tx: TransactionClient): Promise<Date>;
}

@Injectable()
export class DatabaseAccountingPeriodTransactionClock
  implements AccountingPeriodTransactionClock
{
  async now(tx: TransactionClient): Promise<Date> {
    const clocks = await tx.$queryRaw<Array<{ postedAt: Date }>>(
      Prisma.sql`SELECT transaction_timestamp() AS "postedAt"`,
    );
    const postedAt = clocks[0]?.postedAt;
    if (!postedAt) {
      throw new Error("Authoritative financial posting time is unavailable");
    }
    return postedAt;
  }
}

export interface AutomaticAccountingPeriodCoverage {
  current: { id: string; effectiveStart: Date; effectiveEnd: Date };
  next: { id: string; effectiveStart: Date; effectiveEnd: Date };
}

export async function ensureAutomaticAccountingPeriodCoverage(
  tx: TransactionClient,
  instant: Date,
): Promise<AutomaticAccountingPeriodCoverage> {
  if (Number.isNaN(instant.getTime())) {
    throw new Error("Accounting Period instant must be a valid Date");
  }

  await lockAccountingCalendar(tx);

  await tx.accountingPeriod.updateMany({
    where: {
      state: "OPEN",
      effectiveEnd: { lte: instant },
    },
    data: {
      state: "CLOSING",
      version: { increment: 1 },
    },
  });

  const currentBounds = automaticWeeklyAccountingPeriodBounds(instant);
  const current = await ensureNominalAutomaticPeriod(tx, currentBounds, "OPEN");
  const nextBounds = automaticWeeklyAccountingPeriodBounds(currentBounds.end);
  const next = await ensureNominalAutomaticPeriod(tx, nextBounds, "SCHEDULED");

  return { current, next };
}

async function lockAccountingCalendar(tx: TransactionClient): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(19002026, 1)`,
  );
}

async function ensureNominalAutomaticPeriod(
  tx: TransactionClient,
  bounds: { start: Date; end: Date },
  requiredState: "OPEN" | "SCHEDULED",
): Promise<{ id: string; effectiveStart: Date; effectiveEnd: Date }> {
  const overlapping = await tx.accountingPeriod.findMany({
    where: {
      state: { in: [...EFFECTIVE_STATES] },
      effectiveStart: { lt: bounds.end },
      effectiveEnd: { gt: bounds.start },
    },
    orderBy: [{ effectiveStart: "asc" }, { id: "asc" }],
    select: {
      id: true,
      mode: true,
      generationKind: true,
      effectiveStart: true,
      effectiveEnd: true,
      state: true,
    },
  });

  const exact = overlapping.find(
    (period) =>
      period.effectiveStart.getTime() === bounds.start.getTime() &&
      period.effectiveEnd.getTime() === bounds.end.getTime(),
  );
  const conflicting = overlapping.find((period) => period.id !== exact?.id);
  if (conflicting) {
    throw new Error("Accounting Period coverage conflict for Automatic generation");
  }

  if (!exact) {
    return tx.accountingPeriod.create({
      data: {
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "NOMINAL_WEEK",
        effectiveStart: bounds.start,
        effectiveEnd: bounds.end,
        state: requiredState,
      },
      select: { id: true, effectiveStart: true, effectiveEnd: true },
    });
  }

  if (exact.mode !== "AUTOMATIC_WEEKLY" || exact.generationKind !== "NOMINAL_WEEK") {
    throw new Error("Accounting Period coverage conflict for Automatic generation");
  }

  if (requiredState === "OPEN") {
    if (exact.state === "OPEN") {
      return exact;
    }
    if (exact.state !== "SCHEDULED") {
      throw new Error("Accounting Period is not postable for authoritative postedAt");
    }
    return tx.accountingPeriod.update({
      where: { id: exact.id },
      data: { state: "OPEN", version: { increment: 1 } },
      select: { id: true, effectiveStart: true, effectiveEnd: true },
    });
  }

  if (exact.state !== "SCHEDULED") {
    throw new Error("Future Automatic Accounting Period must remain SCHEDULED");
  }
  return exact;
}
