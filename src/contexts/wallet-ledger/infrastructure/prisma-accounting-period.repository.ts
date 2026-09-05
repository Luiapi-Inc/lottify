import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import type {
  AccountingPeriodGenerationKind,
  AccountingPeriodMode,
  AccountingPeriodReplacementPreview,
  AccountingPeriodState,
} from "../domain/accounting-period";
import {
  AccountingPeriodRuleError,
  automaticWeeklyAccountingPeriodBounds,
} from "../domain/accounting-period";
import type {
  AccountingPeriodCustomCommandRecord,
  AccountingPeriodRecord,
  AccountingPeriodRepository,
} from "../domain/accounting-period.repository";
import {
  type AccountingPeriodTransactionClock,
  DatabaseAccountingPeriodTransactionClock,
  EFFECTIVE_ACCOUNTING_PERIOD_STATES,
  ensureAutomaticAccountingPeriodCoverage,
  lockAccountingCalendar,
} from "./accounting-period-runtime";

type TransactionClient = Prisma.TransactionClient;

export type CustomAccountingPeriodApprovalCandidate = AccountingPeriodRecord & {
  mode: "CUSTOM";
  generationKind: "CUSTOM";
  state: "PENDING_APPROVAL";
  reason: string;
  createdByAdminId: string;
};

export type CustomAccountingPeriodCancellationCandidate = AccountingPeriodRecord & {
  mode: "CUSTOM";
  generationKind: "CUSTOM";
  state: "DRAFT" | "PENDING_APPROVAL" | "SCHEDULED";
  reason: string;
  createdByAdminId: string;
};

export type CustomAccountingPeriodApprovalScheduleResult =
  | {
      kind: "elapsed";
      period: AccountingPeriodRecord;
    }
  | {
      kind: "scheduled";
      period: AccountingPeriodRecord;
      replacementPreview: AccountingPeriodReplacementPreview;
    };

@Injectable()
export class PrismaAccountingPeriodRepository implements AccountingPeriodRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(DatabaseAccountingPeriodTransactionClock)
    private readonly clock: AccountingPeriodTransactionClock,
  ) {}

  async getById(id: string): Promise<AccountingPeriodRecord | null> {
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { id },
    });
    return period ? mapRecord(period) : null;
  }

  async list(): Promise<readonly AccountingPeriodRecord[]> {
    const periods = await this.prisma.accountingPeriod.findMany({
      orderBy: [{ effectiveStart: "desc" }, { id: "desc" }],
    });
    return periods.map(mapRecord);
  }

  async ensureAutomaticCoverage(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const instant = await this.clock.now(tx);
      await ensureAutomaticAccountingPeriodCoverage(tx, instant);
    });
  }

  async createCustom(input: {
    effectiveStart: Date;
    effectiveEnd: Date;
    reason: string;
    createdByAdminId: string;
  }): Promise<AccountingPeriodCustomCommandRecord> {
    return this.prisma.$transaction(async (tx) => {
      const instant = await this.clock.now(tx);
      await lockAccountingCalendar(tx);
      const replacementPreview = await buildCustomReplacementPreview(
        tx,
        input.effectiveStart,
        input.effectiveEnd,
        instant,
      );
      const period = await tx.accountingPeriod.create({
        data: {
          mode: "CUSTOM",
          generationKind: "CUSTOM",
          effectiveStart: input.effectiveStart,
          effectiveEnd: input.effectiveEnd,
          state: "DRAFT",
          reason: input.reason,
          createdByAdminId: input.createdByAdminId,
        },
      });
      return { period: mapRecord(period), replacementPreview };
    });
  }

  async submitCustom(input: {
    id: string;
    expectedVersion: number;
  }): Promise<AccountingPeriodCustomCommandRecord> {
    return this.prisma.$transaction(async (tx) => {
      const instant = await this.clock.now(tx);
      await lockAccountingCalendar(tx);
      const current = await tx.accountingPeriod.findUnique({ where: { id: input.id } });
      if (!current) {
        throw new AccountingPeriodRuleError(
          "ACCOUNTING_PERIOD_NOT_FOUND",
          "Accounting Period not found",
        );
      }
      if (current.version !== input.expectedVersion) {
        throw new AccountingPeriodRuleError(
          "VERSION_CONFLICT",
          "Accounting Period version is stale",
          { expectedVersion: input.expectedVersion, currentVersion: current.version },
        );
      }
      if (current.mode !== "CUSTOM" || current.state !== "DRAFT") {
        throw new AccountingPeriodRuleError(
          "ACCOUNTING_PERIOD_STATE_CONFLICT",
          "Accounting Period can be submitted only from DRAFT",
          { state: current.state },
        );
      }

      const replacementPreview = await buildCustomReplacementPreview(
        tx,
        current.effectiveStart,
        current.effectiveEnd,
        instant,
      );

      const updated = await tx.accountingPeriod.updateMany({
        where: {
          id: current.id,
          version: input.expectedVersion,
          state: "DRAFT",
        },
        data: {
          state: "PENDING_APPROVAL",
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        const latest = await tx.accountingPeriod.findUnique({ where: { id: current.id } });
        if (!latest) {
          throw new AccountingPeriodRuleError(
            "ACCOUNTING_PERIOD_NOT_FOUND",
            "Accounting Period not found",
          );
        }
        if (latest.version !== input.expectedVersion) {
          throw new AccountingPeriodRuleError(
            "VERSION_CONFLICT",
            "Accounting Period version is stale",
            { expectedVersion: input.expectedVersion, currentVersion: latest.version },
          );
        }
        throw new AccountingPeriodRuleError(
          "ACCOUNTING_PERIOD_STATE_CONFLICT",
          "Accounting Period can be submitted only from DRAFT",
          { state: latest.state },
        );
      }

      const period = await tx.accountingPeriod.findUniqueOrThrow({
        where: { id: current.id },
      });
      return { period: mapRecord(period), replacementPreview };
    });
  }
}

export async function getCustomAccountingPeriodApprovalCandidate(
  tx: TransactionClient,
  id: string,
  expectedVersion: number,
): Promise<CustomAccountingPeriodApprovalCandidate> {
  const current = await tx.accountingPeriod.findUnique({ where: { id } });
  if (!current) {
    throw new AccountingPeriodRuleError(
      "ACCOUNTING_PERIOD_NOT_FOUND",
      "Accounting Period not found",
    );
  }
  if (current.version !== expectedVersion) {
    throw new AccountingPeriodRuleError(
      "VERSION_CONFLICT",
      "Accounting Period version is stale",
      { expectedVersion, currentVersion: current.version },
    );
  }
  if (
    current.mode !== "CUSTOM" ||
    current.generationKind !== "CUSTOM" ||
    current.state !== "PENDING_APPROVAL"
  ) {
    throw new AccountingPeriodRuleError(
      "ACCOUNTING_PERIOD_STATE_CONFLICT",
      "Accounting Period can be approved only from PENDING_APPROVAL",
      { state: current.state },
    );
  }
  if (!current.createdByAdminId || !current.reason) {
    throw new AccountingPeriodRuleError(
      "ACCOUNTING_PERIOD_STATE_CONFLICT",
      "Custom Accounting Period approval evidence is incomplete",
    );
  }
  return mapRecord(current) as CustomAccountingPeriodApprovalCandidate;
}

export async function getAccountingPeriodApprovalAuditSubject(
  tx: TransactionClient,
  id: string,
): Promise<AccountingPeriodRecord | null> {
  const period = await tx.accountingPeriod.findUnique({ where: { id } });
  return period ? mapRecord(period) : null;
}

export async function getCustomAccountingPeriodCancellationCandidate(
  tx: TransactionClient,
  id: string,
  expectedVersion: number,
): Promise<CustomAccountingPeriodCancellationCandidate> {
  const current = await tx.accountingPeriod.findUnique({ where: { id } });
  if (!current) {
    throw new AccountingPeriodRuleError(
      "ACCOUNTING_PERIOD_NOT_FOUND",
      "Accounting Period not found",
    );
  }
  if (current.version !== expectedVersion) {
    throw new AccountingPeriodRuleError(
      "VERSION_CONFLICT",
      "Accounting Period version is stale",
      { expectedVersion, currentVersion: current.version },
    );
  }
  if (
    current.mode !== "CUSTOM" ||
    current.generationKind !== "CUSTOM" ||
    !["DRAFT", "PENDING_APPROVAL", "SCHEDULED"].includes(current.state)
  ) {
    throw new AccountingPeriodRuleError(
      "ACCOUNTING_PERIOD_STATE_CONFLICT",
      "Custom Accounting Period can be cancelled only before OPEN",
      { state: current.state },
    );
  }
  if (!current.createdByAdminId || !current.reason) {
    throw new AccountingPeriodRuleError(
      "ACCOUNTING_PERIOD_STATE_CONFLICT",
      "Custom Accounting Period cancellation evidence is incomplete",
    );
  }
  return mapRecord(current) as CustomAccountingPeriodCancellationCandidate;
}

export async function applyCustomAccountingPeriodCancellation(
  tx: TransactionClient,
  current: CustomAccountingPeriodCancellationCandidate,
  instant: Date,
): Promise<AccountingPeriodRecord> {
  let restorationStart: Date | undefined;
  let restorationEnd: Date | undefined;
  let automaticIdsToReplace: string[] = [];
  let remainingCustoms: Array<{ effectiveStart: Date; effectiveEnd: Date }> = [];

  if (current.state === "SCHEDULED") {
    if (
      !current.cancellationRequestedByAdminId ||
      !current.cancellationReason ||
      !current.cancellationRequestedAt
    ) {
      throw new AccountingPeriodRuleError(
        "ACCOUNTING_PERIOD_STATE_CONFLICT",
        "SCHEDULED Custom cancellation requires a durable pending cancellation request",
      );
    }
    if (current.effectiveStart.getTime() <= instant.getTime()) {
      throw new AccountingPeriodRuleError(
        "ACCOUNTING_PERIOD_STATE_CONFLICT",
        "SCHEDULED Custom Accounting Period can be cancelled only before its start boundary",
        { state: current.state, authoritativeNow: instant.toISOString() },
      );
    }
    const referenced = await tx.financialTransaction.findFirst({
      where: { accountingPeriodId: current.id },
      select: { id: true },
    });
    if (referenced) {
      throw new AccountingPeriodRuleError(
        "ACCOUNTING_PERIOD_COVERAGE_CONFLICT",
        "Transaction-referenced Accounting Period cannot be cancelled",
        { financialTransactionId: referenced.id },
      );
    }

    restorationStart = automaticWeeklyAccountingPeriodBounds(current.effectiveStart).start;
    let week = automaticWeeklyAccountingPeriodBounds(restorationStart);
    while (week.start.getTime() < current.effectiveEnd.getTime()) {
      restorationEnd = week.end;
      week = automaticWeeklyAccountingPeriodBounds(week.end);
    }
    if (!restorationEnd) {
      throw new Error("Accounting Period cancellation restoration range is unavailable");
    }

    const automaticCoverage = await tx.accountingPeriod.findMany({
      where: {
        state: { in: [...EFFECTIVE_ACCOUNTING_PERIOD_STATES] },
        mode: "AUTOMATIC_WEEKLY",
        effectiveStart: { lt: restorationEnd },
        effectiveEnd: { gt: restorationStart },
      },
      orderBy: [{ effectiveStart: "asc" }, { id: "asc" }],
      select: {
        id: true,
        state: true,
        financialTransactions: { select: { id: true }, take: 1 },
      },
    });
    const protectedAutomatic = automaticCoverage.find(
      (period) =>
        period.state !== "SCHEDULED" || period.financialTransactions.length > 0,
    );
    if (protectedAutomatic) {
      throw new AccountingPeriodRuleError(
        "ACCOUNTING_PERIOD_COVERAGE_CONFLICT",
        "Automatic Accounting Period coverage cannot be regenerated during cancellation",
        { conflictingPeriodId: protectedAutomatic.id, conflictingState: protectedAutomatic.state },
      );
    }
    automaticIdsToReplace = automaticCoverage.map((period) => period.id);
    remainingCustoms = await tx.accountingPeriod.findMany({
      where: {
        id: { not: current.id },
        state: { in: [...EFFECTIVE_ACCOUNTING_PERIOD_STATES] },
        mode: "CUSTOM",
        effectiveStart: { lt: restorationEnd },
        effectiveEnd: { gt: restorationStart },
      },
      orderBy: [{ effectiveStart: "asc" }, { id: "asc" }],
      select: { effectiveStart: true, effectiveEnd: true },
    });
  }

  if (automaticIdsToReplace.length > 0) {
    const cancelledAutomatic = await tx.accountingPeriod.updateMany({
      where: {
        id: { in: automaticIdsToReplace },
        state: "SCHEDULED",
        mode: "AUTOMATIC_WEEKLY",
        financialTransactions: { none: {} },
      },
      data: { state: "CANCELLED", version: { increment: 1 } },
    });
    if (cancelledAutomatic.count !== automaticIdsToReplace.length) {
      throw new AccountingPeriodRuleError(
        "ACCOUNTING_PERIOD_COVERAGE_CONFLICT",
        "Automatic Accounting Period coverage changed during cancellation",
      );
    }
  }

  const cancelled = await tx.accountingPeriod.updateMany({
    where: {
      id: current.id,
      version: current.version,
      state: current.state,
    },
    data: { state: "CANCELLED", version: { increment: 1 } },
  });
  if (cancelled.count !== 1) {
    throw new AccountingPeriodRuleError(
      "VERSION_CONFLICT",
      "Accounting Period changed while cancellation was being applied",
    );
  }

  if (current.state === "SCHEDULED" && restorationStart && restorationEnd) {
    let week = automaticWeeklyAccountingPeriodBounds(restorationStart);
    while (week.start.getTime() < restorationEnd.getTime()) {
      const blockers = remainingCustoms.filter(
        (period) =>
          period.effectiveStart.getTime() < week.end.getTime() &&
          period.effectiveEnd.getTime() > week.start.getTime(),
      );
      let cursor = week.start;
      for (const blocker of blockers) {
        const blockerStart = new Date(
          Math.max(blocker.effectiveStart.getTime(), week.start.getTime()),
        );
        const blockerEnd = new Date(
          Math.min(blocker.effectiveEnd.getTime(), week.end.getTime()),
        );
        if (cursor.getTime() < blockerStart.getTime()) {
          await createAutomaticRestorationSegment(tx, cursor, blockerStart, week);
        }
        if (cursor.getTime() < blockerEnd.getTime()) cursor = blockerEnd;
      }
      if (cursor.getTime() < week.end.getTime()) {
        await createAutomaticRestorationSegment(tx, cursor, week.end, week);
      }
      week = automaticWeeklyAccountingPeriodBounds(week.end);
    }
  }

  const period = await tx.accountingPeriod.findUniqueOrThrow({ where: { id: current.id } });
  return mapRecord(period);
}

export async function requestCustomAccountingPeriodCancellation(
  tx: TransactionClient,
  current: CustomAccountingPeriodCancellationCandidate,
  instant: Date,
  requesterAdminId: string,
  cancellationReason: string,
): Promise<AccountingPeriodRecord> {
  if (current.state !== "SCHEDULED") {
    throw new AccountingPeriodRuleError(
      "ACCOUNTING_PERIOD_STATE_CONFLICT",
      "Only a SCHEDULED Custom Accounting Period can enter governed cancellation",
      { state: current.state },
    );
  }
  if (current.cancellationRequestedByAdminId) {
    throw new AccountingPeriodRuleError(
      "ACCOUNTING_PERIOD_STATE_CONFLICT",
      "SCHEDULED Custom Accounting Period already has a pending cancellation request",
      { cancellationRequestedByAdminId: current.cancellationRequestedByAdminId },
    );
  }
  if (current.effectiveStart.getTime() <= instant.getTime()) {
    throw new AccountingPeriodRuleError(
      "ACCOUNTING_PERIOD_STATE_CONFLICT",
      "SCHEDULED Custom Accounting Period can be cancelled only before its start boundary",
      { state: current.state, authoritativeNow: instant.toISOString() },
    );
  }
  const referenced = await tx.financialTransaction.findFirst({
    where: { accountingPeriodId: current.id },
    select: { id: true },
  });
  if (referenced) {
    throw new AccountingPeriodRuleError(
      "ACCOUNTING_PERIOD_COVERAGE_CONFLICT",
      "Transaction-referenced Accounting Period cannot be cancelled",
      { financialTransactionId: referenced.id },
    );
  }

  const requested = await tx.accountingPeriod.updateMany({
    where: {
      id: current.id,
      version: current.version,
      state: "SCHEDULED",
      cancellationRequestedByAdminId: null,
    },
    data: {
      cancellationRequestedByAdminId: requesterAdminId,
      cancellationReason,
      cancellationRequestedAt: instant,
      version: { increment: 1 },
    },
  });
  if (requested.count !== 1) {
    throw new AccountingPeriodRuleError(
      "VERSION_CONFLICT",
      "Accounting Period changed while cancellation was being requested",
    );
  }
  const period = await tx.accountingPeriod.findUniqueOrThrow({ where: { id: current.id } });
  return mapRecord(period);
}

async function createAutomaticRestorationSegment(
  tx: TransactionClient,
  effectiveStart: Date,
  effectiveEnd: Date,
  nominal: { start: Date; end: Date },
): Promise<void> {
  if (effectiveEnd.getTime() <= effectiveStart.getTime()) return;
  await tx.accountingPeriod.create({
    data: {
      mode: "AUTOMATIC_WEEKLY",
      generationKind:
        effectiveStart.getTime() === nominal.start.getTime() &&
        effectiveEnd.getTime() === nominal.end.getTime()
          ? "NOMINAL_WEEK"
          : "DERIVED_FRAGMENT",
      effectiveStart,
      effectiveEnd,
      state: "SCHEDULED",
    },
  });
}

export async function applyCustomAccountingPeriodApprovalSchedule(
  tx: TransactionClient,
  current: CustomAccountingPeriodApprovalCandidate,
  instant: Date,
): Promise<CustomAccountingPeriodApprovalScheduleResult> {
  if (current.effectiveStart.getTime() <= instant.getTime()) {
    const cancelled = await tx.accountingPeriod.updateMany({
      where: {
        id: current.id,
        version: current.version,
        state: "PENDING_APPROVAL",
      },
      data: { state: "CANCELLED", version: { increment: 1 } },
    });
    if (cancelled.count !== 1) {
      throw new AccountingPeriodRuleError(
        "VERSION_CONFLICT",
        "Accounting Period changed while approval was being evaluated",
      );
    }
    const period = await tx.accountingPeriod.findUniqueOrThrow({ where: { id: current.id } });
    return { kind: "elapsed", period: mapRecord(period) };
  }

  const replacementPreview = await buildCustomReplacementPreview(
    tx,
    current.effectiveStart,
    current.effectiveEnd,
    instant,
  );
  const persistedIds = replacementPreview.affectedAutomaticPeriods.flatMap((period) =>
    period.id ? [period.id] : [],
  );
  if (persistedIds.length > 0) {
    const cancelled = await tx.accountingPeriod.updateMany({
      where: {
        id: { in: persistedIds },
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "NOMINAL_WEEK",
        state: "SCHEDULED",
        financialTransactions: { none: {} },
      },
      data: { state: "CANCELLED", version: { increment: 1 } },
    });
    if (cancelled.count !== persistedIds.length) {
      throw new AccountingPeriodRuleError(
        "ACCOUNTING_PERIOD_COVERAGE_CONFLICT",
        "Automatic Accounting Period coverage changed during approval",
      );
    }
  }

  for (const fragment of replacementPreview.residualFragments) {
    await tx.accountingPeriod.create({
      data: {
        mode: "AUTOMATIC_WEEKLY",
        generationKind: "DERIVED_FRAGMENT",
        effectiveStart: fragment.effectiveStart,
        effectiveEnd: fragment.effectiveEnd,
        state: "SCHEDULED",
      },
    });
  }

  const scheduled = await tx.accountingPeriod.updateMany({
    where: {
      id: current.id,
      version: current.version,
      state: "PENDING_APPROVAL",
    },
    data: { state: "SCHEDULED", version: { increment: 1 } },
  });
  if (scheduled.count !== 1) {
    throw new AccountingPeriodRuleError(
      "VERSION_CONFLICT",
      "Accounting Period changed while approval was being applied",
    );
  }

  const period = await tx.accountingPeriod.findUniqueOrThrow({ where: { id: current.id } });
  return { kind: "scheduled", period: mapRecord(period), replacementPreview };
}

export async function buildCustomReplacementPreview(
  tx: TransactionClient,
  effectiveStart: Date,
  effectiveEnd: Date,
  instant: Date,
): Promise<AccountingPeriodReplacementPreview> {
  if (effectiveStart.getTime() <= instant.getTime()) {
    throw new AccountingPeriodRuleError(
      "ACCOUNTING_PERIOD_NOT_FUTURE",
      "Custom Accounting Period must start in the future",
      { authoritativeNow: instant.toISOString() },
    );
  }

  const blocking = await tx.accountingPeriod.findFirst({
    where: {
      state: { in: [...EFFECTIVE_ACCOUNTING_PERIOD_STATES] },
      effectiveStart: { lt: effectiveEnd },
      effectiveEnd: { gt: effectiveStart },
      OR: [
        { state: { in: ["OPEN", "CLOSING", "CLOSED"] } },
        { mode: { not: "AUTOMATIC_WEEKLY" } },
        { generationKind: { not: "NOMINAL_WEEK" } },
        { financialTransactions: { some: {} } },
      ],
    },
    orderBy: [{ effectiveStart: "asc" }, { id: "asc" }],
    select: {
      id: true,
      mode: true,
      generationKind: true,
      state: true,
      effectiveStart: true,
      effectiveEnd: true,
    },
  });
  if (blocking) {
    throw new AccountingPeriodRuleError(
      "ACCOUNTING_PERIOD_COVERAGE_CONFLICT",
      "Custom Accounting Period overlaps coverage that cannot be overridden",
      {
        conflictingPeriodId: blocking.id,
        conflictingState: blocking.state,
        conflictingMode: blocking.mode,
      },
    );
  }

  const persistedAutomatic = await tx.accountingPeriod.findMany({
    where: {
      state: "SCHEDULED",
      mode: "AUTOMATIC_WEEKLY",
      generationKind: "NOMINAL_WEEK",
      effectiveStart: { lt: effectiveEnd },
      effectiveEnd: { gt: effectiveStart },
    },
    orderBy: [{ effectiveStart: "asc" }, { id: "asc" }],
    select: { id: true, effectiveStart: true, effectiveEnd: true },
  });

  const affectedAutomaticPeriods = [] as Array<{
    id: string | null;
    effectiveStart: Date;
    effectiveEnd: Date;
    generationKind: "NOMINAL_WEEK";
  }>;
  let bounds = automaticWeeklyAccountingPeriodBounds(effectiveStart);
  while (bounds.start.getTime() < effectiveEnd.getTime()) {
    const persisted = persistedAutomatic.find(
      (period) =>
        period.effectiveStart.getTime() === bounds.start.getTime() &&
        period.effectiveEnd.getTime() === bounds.end.getTime(),
    );
    affectedAutomaticPeriods.push({
      id: persisted?.id ?? null,
      effectiveStart: bounds.start,
      effectiveEnd: bounds.end,
      generationKind: "NOMINAL_WEEK",
    });
    bounds = automaticWeeklyAccountingPeriodBounds(bounds.end);
  }

  const residualFragments = [] as Array<{
    sourcePeriodId: string | null;
    effectiveStart: Date;
    effectiveEnd: Date;
    generationKind: "DERIVED_FRAGMENT";
  }>;
  const first = affectedAutomaticPeriods[0];
  if (first && first.effectiveStart.getTime() < effectiveStart.getTime()) {
    residualFragments.push({
      sourcePeriodId: first.id,
      effectiveStart: first.effectiveStart,
      effectiveEnd: effectiveStart,
      generationKind: "DERIVED_FRAGMENT",
    });
  }
  const last = affectedAutomaticPeriods.at(-1);
  if (last && last.effectiveEnd.getTime() > effectiveEnd.getTime()) {
    residualFragments.push({
      sourcePeriodId: last.id,
      effectiveStart: effectiveEnd,
      effectiveEnd: last.effectiveEnd,
      generationKind: "DERIVED_FRAGMENT",
    });
  }

  return { affectedAutomaticPeriods, residualFragments };
}

function mapRecord(period: {
  id: string;
  mode: string;
  generationKind: string;
  effectiveStart: Date;
  effectiveEnd: Date;
  state: string;
  version: number;
  reason: string | null;
  createdByAdminId: string | null;
  cancellationRequestedByAdminId: string | null;
  cancellationReason: string | null;
  cancellationRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AccountingPeriodRecord {
  return {
    id: period.id,
    mode: period.mode as AccountingPeriodMode,
    generationKind: period.generationKind as AccountingPeriodGenerationKind,
    effectiveStart: period.effectiveStart,
    effectiveEnd: period.effectiveEnd,
    state: period.state as AccountingPeriodState,
    version: period.version,
    reason: period.reason,
    createdByAdminId: period.createdByAdminId,
    cancellationRequestedByAdminId: period.cancellationRequestedByAdminId,
    cancellationReason: period.cancellationReason,
    cancellationRequestedAt: period.cancellationRequestedAt,
    createdAt: period.createdAt,
    updatedAt: period.updatedAt,
  };
}
