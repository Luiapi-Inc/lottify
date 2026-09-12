import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AdminReconciliationController } from "../../apps/api/src/admin-reconciliation.controller";
import { AdminReportingController } from "../../apps/api/src/admin-reporting.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { AdminCapabilityGuard } from "../../apps/api/src/admin-capability.guard";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import { hashAdminPassword } from "../../src/contexts/identity-access/domain/admin-password";
import { encryptAdminSecret } from "../../src/contexts/identity-access/domain/admin-secret-crypto";
import { generateTotpCode, generateTotpSecret } from "../../src/contexts/identity-access/domain/totp";
import { PrismaAdminAuthRepository } from "../../src/contexts/identity-access/infrastructure/prisma-admin-auth.repository";
import {
  AccountingPeriodFinancialReportService,
  REPORTING_POSTABLE_PERIOD_STATES,
  REPORTING_TIME_ZONE,
} from "../../src/contexts/reporting/accounting-period-financial-report.service";
import type { LedgerWalletProjectionPort } from "../../src/contexts/reporting/ledger-wallet-projection.port";
import { LedgerWalletReconciliationService } from "../../src/contexts/reporting/ledger-wallet-reconciliation.service";
import { ReconciliationInspectionService } from "../../src/contexts/reporting/reconciliation-inspection.service";
import { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { ACCOUNTING_TIME_ZONE } from "../../src/contexts/wallet-ledger/domain/accounting-period";
import type { AccountingPeriodTransactionClock } from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import { PrismaFinancialLedgerRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { getAdminMfaEncryptionKey, resetEnvironmentForTests } from "../../src/platform/config/env";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const emailPrefix = "reporting-rest-integration+";

/** Fixed historical posting instant: its automatic weekly period is the report window. */
const reportPostingInstant = new Date("2019-03-06T04:00:00.000Z");
/**
 * A past week no authoritative Accounting Period covers and that the fixture's own
 * posting week does not touch, so the coverage gap is a controlled precondition.
 */
const uncoveredWindowStart = new Date("2019-03-18T00:00:00.000Z");
const uncoveredWindowEnd = new Date("2019-03-25T00:00:00.000Z");
/**
 * Ledger postings also materialise the following nominal week as a SCHEDULED
 * period, so cleanup is scoped to a band that only this fixture uses.
 */
const fixturePeriodBandStart = new Date("2019-03-01T00:00:00.000Z");
const fixturePeriodBandEnd = new Date("2019-04-01T00:00:00.000Z");

class MutableAccountingPeriodClock implements AccountingPeriodTransactionClock {
  constructor(private readonly instant: Date) {}

  async now(): Promise<Date> {
    return new Date(this.instant);
  }
}

describe.runIf(runIntegration)("Reporting/Reconciliation REST boundary", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAuth: AdminAuthService;
  let ledger: FinancialLedgerService;
  let baseUrl: string;

  const adminIds: string[] = [];
  const memberIds: string[] = [];
  const systemAccountIds: string[] = [];
  const transactionIds: string[] = [];
  const reservationIds: string[] = [];
  const accountingPeriodIds: string[] = [];

  let accessToken = "";
  let matchedMemberId = "";
  let mismatchMemberId = "";
  let mismatchRunId = "";

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    adminAuth = new AdminAuthService(new PrismaAdminAuthRepository(prisma), new JwtService());
    ledger = new FinancialLedgerService(
      new PrismaFinancialLedgerRepository(
        prisma,
        new MutableAccountingPeriodClock(reportPostingInstant),
      ),
    );

    // The fixture's 2019 windows must start from a known-clean coverage state.
    await clearFixturePeriodBand();
    const seededPeriodCount = await prisma.accountingPeriod.count({
      where: { effectiveStart: { gte: fixturePeriodBandStart, lt: fixturePeriodBandEnd } },
    });
    if (seededPeriodCount !== 0) {
      throw new Error("The reporting fixture period band is not clean");
    }
    await seedReconciliationEvidence();

    @Module({
      controllers: [AdminReconciliationController, AdminReportingController],
      providers: [
        AdminAuthGuard,
        AdminCapabilityGuard,
        { provide: Reflector, useValue: new Reflector() },
        { provide: AdminAuthService, useValue: adminAuth },
        { provide: ReconciliationInspectionService, useValue: new ReconciliationInspectionService(prisma) },
        {
          provide: AccountingPeriodFinancialReportService,
          useValue: new AccountingPeriodFinancialReportService(prisma),
        },
      ],
    })
    class ReportingApiModule {}

    app = await NestFactory.create(ReportingApiModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();

    accessToken = await createAdminSession();
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    try {
      const runs = await prisma.reconciliationRun.findMany({
        where: { memberId: { in: memberIds } },
        select: { id: true },
      });
      const runIds = runs.map((run) => run.id);
      if (runIds.length > 0) {
        await prisma.reconciliationDiscrepancy.deleteMany({
          where: { reconciliationRunId: { in: runIds } },
        });
        await prisma.reconciliationRun.deleteMany({ where: { id: { in: runIds } } });
      }
      if (reservationIds.length > 0) {
        await prisma.reservationAllocation.deleteMany({
          where: { reservationId: { in: reservationIds } },
        });
        await prisma.reservation.deleteMany({ where: { id: { in: reservationIds } } });
      }
      if (transactionIds.length > 0) {
        await prisma.ledgerPosting.deleteMany({
          where: { transactionId: { in: transactionIds } },
        });
        await prisma.financialTransaction.deleteMany({ where: { id: { in: transactionIds } } });
      }
      await prisma.ledgerAccount.deleteMany({
        where: { OR: [{ memberId: { in: memberIds } }, { id: { in: systemAccountIds } }] },
      });
      if (accountingPeriodIds.length > 0) {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
          await tx.accountingPeriod.deleteMany({ where: { id: { in: accountingPeriodIds } } });
        });
      }
      await clearFixturePeriodBand();
      await prisma.adminAuthSession.deleteMany({ where: { adminUserId: { in: adminIds } } });
      await prisma.adminReauthEvidence.deleteMany({ where: { adminUserId: { in: adminIds } } });
      await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    } finally {
      try {
        await app?.close();
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  async function createAdminSession(): Promise<string> {
    const id = randomUUID();
    const password = "Reporting REST integration password 123!";
    const secret = generateTotpSecret();
    const email = `${emailPrefix}${id}@example.com`;
    await prisma.adminUser.create({
      data: {
        id,
        email,
        name: "Reporting Admin",
        passwordHash: await hashAdminPassword(password),
        role: "ADMIN",
        status: "ACTIVE",
        mfaEnabled: true,
        mfaSecretEncrypted: encryptAdminSecret(secret, getAdminMfaEncryptionKey()),
      },
    });
    adminIds.push(id);
    const login = await adminAuth.login(email, password);
    if (login.status !== "MFA_REQUIRED") throw new Error("Expected MFA challenge");
    const tokens = await adminAuth.verifyMfa(
      login.challengeToken,
      generateTotpCode(secret),
      "127.0.0.1",
      "reporting-rest-integration",
    );
    return tokens.accessToken;
  }

  /**
   * Removes every unreferenced Accounting Period this fixture can create: the
   * posting week itself plus the following nominal week the runtime schedules.
   */
  async function clearFixturePeriodBand(): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.accountingPeriod.deleteMany({
        where: {
          effectiveStart: { gte: fixturePeriodBandStart, lt: fixturePeriodBandEnd },
          financialTransactions: { none: {} },
        },
      });
    });
  }

  async function seedMember(label: string): Promise<string> {
    const memberId = randomUUID();
    memberIds.push(memberId);
    const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH");
    const systemAccountId = await ledger.ensureSystemAccount(`reporting-rest:${label}:${randomUUID()}`);
    systemAccountIds.push(systemAccountId);

    const transactionId = await ledger.post({
      businessTransactionId: randomUUID(),
      operationType: "DEPOSIT_CREDIT",
      correlationId: randomUUID(),
      idempotency: {
        scope: `reporting-rest.integration.deposit.${label}`,
        key: randomUUID(),
        fingerprint: `${label}:deposit:5000`,
      },
      domainReferences: { test: "reporting-rest", label },
      currency: "THB",
      effectiveAt: reportPostingInstant,
      postings: [
        { accountId: systemAccountId, side: "DEBIT", amountMinor: 5_000n },
        { accountId: cashAccountId, side: "CREDIT", amountMinor: 5_000n },
      ],
    });
    transactionIds.push(transactionId);
    const transaction = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: transactionId },
      select: { accountingPeriodId: true },
    });
    accountingPeriodIds.push(transaction.accountingPeriodId);

    const reservationId = await ledger.reserve({
      purpose: "BET",
      businessReference: `reporting-rest-bet:${label}:${randomUUID()}`,
      memberId,
      currency: "THB",
      amountMinor: 1_200n,
      correlationId: randomUUID(),
      idempotency: {
        scope: `reporting-rest.integration.reserve.${label}`,
        key: randomUUID(),
        fingerprint: `${label}:reserve:1200`,
      },
      allocations: [{ accountId: cashAccountId, amountMinor: 1_200n }],
    });
    reservationIds.push(reservationId);

    return memberId;
  }

  async function seedReconciliationEvidence(): Promise<void> {
    const reconciliation = new LedgerWalletReconciliationService(prisma, ledger, ledger);

    matchedMemberId = await seedMember("matched");
    await reconciliation.run({
      checkpointKey: `ledger-wallet:rest:matched-a:${randomUUID()}`,
      memberId: matchedMemberId,
    });
    await reconciliation.run({
      checkpointKey: `ledger-wallet:rest:matched-b:${randomUUID()}`,
      memberId: matchedMemberId,
    });

    mismatchMemberId = await seedMember("mismatch");
    const driftingReader: LedgerWalletProjectionPort = {
      async getWalletProjection(memberId, currency) {
        const projection = await ledger.getWalletProjection(memberId, currency);
        return {
          ...projection,
          buckets: projection.buckets.map((bucket) =>
            bucket.bucket === "CASH"
              ? {
                  ...bucket,
                  postedMinor: bucket.postedMinor + 7n,
                  availableMinor: bucket.availableMinor + 1n,
                }
              : bucket,
          ),
        };
      },
    };
    const mismatchReconciliation = new LedgerWalletReconciliationService(
      prisma,
      driftingReader,
      ledger,
    );
    const mismatch = await mismatchReconciliation.run({
      checkpointKey: `ledger-wallet:rest:mismatch:${randomUUID()}`,
      memberId: mismatchMemberId,
    });
    if (mismatch.discrepancyCount < 2) {
      throw new Error("Expected the drifting projection to produce two discrepancies");
    }
    mismatchRunId = mismatch.id;

    // Advance one discrepancy through the governed lifecycle so the read surface is
    // exercised with owner, resolution trail and resolution evidence present.
    const inspection = new ReconciliationInspectionService(prisma);
    const discrepancies = await inspection.listDiscrepancies({ runId: mismatch.id, limit: 100 });
    const resolved = discrepancies.items.find(
      (item) => item.identityKey === "CASH:availableMinor",
    );
    if (!resolved) {
      throw new Error("Expected the drifted availability difference to be persisted");
    }
    const resolvedAt = new Date(resolved.detectedAt.getTime() + 1_000);
    await prisma.reconciliationDiscrepancy.update({
      where: { id: resolved.id },
      data: {
        status: "RESOLVED",
        severity: "CRITICAL",
        ownerReference: "admin:reconciliation-owner",
        resolvedAt,
        resolutionTrail: [
          { at: resolvedAt.toISOString(), actor: "admin:reconciliation-owner", to: "RESOLVED" },
        ],
        resolutionEvidence: {
          outcome: "ACCEPTED_EXCEPTION",
          reasonRef: "exception-ref-1",
          evidenceRef: "evidence-ref-1",
        },
      },
    });
  }

  function authenticated(): HeadersInit {
    return { Authorization: `Bearer ${accessToken}` };
  }

  async function get(path: string, headers: HeadersInit = authenticated()) {
    return fetch(`${baseUrl}${path}`, { headers });
  }

  async function databaseEpochMs(): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ epochMs: number }>>(
      Prisma.sql`
        SELECT (extract(epoch FROM transaction_timestamp()) * 1000)::double precision AS "epochMs"
      `,
    );
    const epochMs = rows[0]?.epochMs;
    if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) {
      throw new Error("Database clock epoch is unavailable");
    }
    return epochMs;
  }

  it("denies unauthenticated Admin access to every new read surface", async () => {
    const runs = await get("/api/v1/admin/reconciliation/runs", {});
    expect(runs.status).toBe(401);
    expect((await runs.json()).code).toBe("AUTHENTICATION_REQUIRED");

    const report = await get(
      "/api/v1/admin/reports/accounting-period-financial?from=2019-03-04T00:00:00.000Z&to=2019-03-11T00:00:00.000Z",
      {},
    );
    expect(report.status).toBe(401);
    expect((await report.json()).code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("lists and reads reconciliation runs with asOf, checkpoints, counts, totals and summary", async () => {
    const listed = await get(`/api/v1/admin/reconciliation/runs?memberId=${mismatchMemberId}`);
    expect(listed.status).toBe(200);
    const page = await listed.json();
    expect(page.dataAsOf).toBeTruthy();
    expect(page.items).toHaveLength(1);
    const run = page.items[0];
    expect(run).toMatchObject({
      id: mismatchRunId,
      pair: "LEDGER_WALLET",
      memberId: mismatchMemberId,
      currency: "THB",
      result: "MISMATCH",
      discrepancyCount: 2,
    });
    expect(run.sourceRange.ledgerPostedAt.through).toBe(run.sourceCheckpoint.asOf);
    expect(run.sourceCheckpoint.checkpointKey).toBe(run.checkpointKey);
    expect(run.sourceCheckpoint.memberId).toBe(mismatchMemberId);
    expect(run.inspectedCounts).toMatchObject({
      ledgerAccounts: 1,
      ledgerPostings: 1,
      activeReservationAllocations: 1,
      walletBuckets: 3,
      discrepancies: 2,
    });
    expect(run.totals).toEqual({
      expected: { postedMinor: "5000", reservedMinor: "1200", availableMinor: "3800" },
      observed: { postedMinor: "5007", reservedMinor: "1200", availableMinor: "3801" },
      difference: { postedMinor: "7", reservedMinor: "0", availableMinor: "1" },
    });
    expect(run.resultSummary).toEqual({ matched: false, discrepancyCount: 2, bucketCount: 3 });

    const matchedRun = await get(
      `/api/v1/admin/reconciliation/runs?memberId=${matchedMemberId}&result=MATCHED`,
    );
    const matchedPage = await matchedRun.json();
    expect(matchedPage.items).toHaveLength(2);
    expect(matchedPage.items[0].resultSummary).toEqual({
      matched: true,
      discrepancyCount: 0,
      bucketCount: 3,
    });
    expect(matchedPage.items[0].totals.difference).toEqual({
      postedMinor: "0",
      reservedMinor: "0",
      availableMinor: "0",
    });

    const detail = await get(`/api/v1/admin/reconciliation/runs/${run.id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual(run);

    const missing = await get(`/api/v1/admin/reconciliation/runs/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("NOT_FOUND");
  });

  it("filters and pages reconciliation runs deterministically", async () => {
    const mismatchOnly = await get(
      `/api/v1/admin/reconciliation/runs?memberId=${mismatchMemberId}&result=MISMATCH`,
    );
    expect(mismatchOnly.status).toBe(200);
    const mismatchPage = await mismatchOnly.json();
    expect(mismatchPage.items).toHaveLength(1);
    expect(mismatchPage.items[0].id).toBe(mismatchRunId);

    const firstResponse = await get(
      `/api/v1/admin/reconciliation/runs?memberId=${matchedMemberId}&limit=1`,
    );
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBe(first.items[0].id);

    const secondResponse = await get(
      `/api/v1/admin/reconciliation/runs?memberId=${matchedMemberId}&limit=1&cursor=${first.nextCursor}`,
    );
    const second = await secondResponse.json();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.items[0].id).not.toBe(first.items[0].id);

    // Use PostgreSQL epoch as an independent oracle so this assertion catches a
    // timezone-shifted JS Date materialized from a server-authoritative timestamptz.
    const dbNowEpochMs = await databaseEpochMs();
    const persistedRun = await prisma.reconciliationRun.findUniqueOrThrow({
      where: { id: mismatchRunId },
      select: { asOf: true },
    });
    expect(persistedRun.asOf.getTime()).toBeLessThanOrEqual(dbNowEpochMs);

    const rangeFiltered = await get(
      `/api/v1/admin/reconciliation/runs?memberId=${mismatchMemberId}&from=${new Date(dbNowEpochMs + 1_000).toISOString()}`,
    );
    expect((await rangeFiltered.json()).items).toHaveLength(0);

    const invalidLimit = await get(
      `/api/v1/admin/reconciliation/runs?memberId=${mismatchMemberId}&limit=0`,
    );
    expect(invalidLimit.status).toBe(400);
    expect((await invalidLimit.json()).code).toBe("VALIDATION_ERROR");

    const invalidResult = await get("/api/v1/admin/reconciliation/runs?result=UNKNOWN");
    expect(invalidResult.status).toBe(400);
    expect((await invalidResult.json()).code).toBe("VALIDATION_ERROR");

    const invalidCurrency = await get("/api/v1/admin/reconciliation/runs?currency=USD");
    expect(invalidCurrency.status).toBe(400);
    expect((await invalidCurrency.json()).code).toBe("VALIDATION_ERROR");
  });

  it("lists and reads discrepancies with expected/observed facts, age, owner and resolution evidence", async () => {
    const listed = await get(`/api/v1/admin/reconciliation/discrepancies?memberId=${mismatchMemberId}`);
    expect(listed.status).toBe(200);
    const page = await listed.json();
    expect(page.dataAsOf).toBeTruthy();
    expect(page.items).toHaveLength(2);

    const detected = page.items.find((item: { status: string }) => item.status === "DETECTED");
    expect(detected).toBeTruthy();
    expect(detected).toMatchObject({
      pair: "LEDGER_WALLET",
      memberId: mismatchMemberId,
      currency: "THB",
      identityKey: "CASH:postedMinor",
      severity: "ERROR",
      ownerReference: null,
      outcome: null,
      resolutionEvidence: null,
      resolvedAt: null,
    });
    expect(detected.reconciliationRunId).toBe(mismatchRunId);
    expect(detected.expectedFacts).toMatchObject({
      memberId: mismatchMemberId,
      currency: "THB",
      bucket: "CASH",
      metric: "postedMinor",
      amountMinor: "5000",
    });
    expect(detected.observedFacts).toMatchObject({
      bucket: "CASH",
      metric: "postedMinor",
      amountMinor: "5007",
    });
    expect(detected.amountDifferenceMinor).toBe("7");
    expect(detected.ageMs).toBeGreaterThanOrEqual(0);
    expect(detected.sourceReferences).toMatchObject({
      pair: "LEDGER_WALLET",
      memberId: mismatchMemberId,
    });
    expect(detected.sourceReferences.ledgerAccountId).toBeTruthy();
    expect(detected.resolutionTrail).toEqual([]);

    const resolved = page.items.find((item: { status: string }) => item.status === "RESOLVED");
    expect(resolved).toBeTruthy();
    expect(resolved).toMatchObject({
      identityKey: "CASH:availableMinor",
      severity: "CRITICAL",
      ownerReference: "admin:reconciliation-owner",
      outcome: "ACCEPTED_EXCEPTION",
    });
    expect(resolved.expectedFacts.amountMinor).toBe("3800");
    expect(resolved.observedFacts.amountMinor).toBe("3801");
    expect(resolved.amountDifferenceMinor).toBe("1");
    expect(
      page.items.map((item: { identityKey: string }) => item.identityKey).sort(),
    ).toEqual(["CASH:availableMinor", "CASH:postedMinor"]);
    expect(resolved.resolutionEvidence).toMatchObject({
      outcome: "ACCEPTED_EXCEPTION",
      reasonRef: "exception-ref-1",
      evidenceRef: "evidence-ref-1",
    });
    expect(resolved.resolutionTrail[0]).toMatchObject({ to: "RESOLVED" });
    expect(resolved.resolvedAt).toBeTruthy();

    const detail = await get(`/api/v1/admin/reconciliation/discrepancies/${resolved.id}`);
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    const { ageMs: detailAgeMs, ...detailEvidence } = detailBody;
    const { ageMs: listAgeMs, ...listEvidence } = resolved;
    // Detection age is evaluated against each response's own dataAsOf instant.
    expect(detailEvidence).toEqual(listEvidence);
    expect(detailAgeMs).toBeGreaterThanOrEqual(listAgeMs);

    const lifecycleFilter = await get(
      `/api/v1/admin/reconciliation/discrepancies?memberId=${mismatchMemberId}&status=RESOLUTION_PENDING`,
    );
    expect(lifecycleFilter.status).toBe(200);
    expect((await lifecycleFilter.json()).items).toHaveLength(0);

    const severityFilter = await get(
      `/api/v1/admin/reconciliation/discrepancies?memberId=${mismatchMemberId}&severity=CRITICAL`,
    );
    expect((await severityFilter.json()).items).toHaveLength(1);

    const runFilter = await get(
      `/api/v1/admin/reconciliation/discrepancies?memberId=${matchedMemberId}`,
    );
    expect((await runFilter.json()).items).toHaveLength(0);

    const unknownStatus = await get(
      "/api/v1/admin/reconciliation/discrepancies?status=RESOLVING",
    );
    expect(unknownStatus.status).toBe(400);
    expect((await unknownStatus.json()).code).toBe("VALIDATION_ERROR");

    const missing = await get(`/api/v1/admin/reconciliation/discrepancies/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("NOT_FOUND");
  });

  it("reports authoritative accounting-period financials as CURRENT for a declared window", async () => {
    const period = await prisma.accountingPeriod.findUniqueOrThrow({
      where: { id: accountingPeriodIds[0]! },
      select: { id: true, effectiveStart: true, effectiveEnd: true, state: true },
    });

    const response = await get(
      `/api/v1/admin/reports/accounting-period-financial?from=${period.effectiveStart.toISOString()}&to=${period.effectiveEnd.toISOString()}`,
    );
    expect(response.status).toBe(200);
    const report = await response.json();

    expect(report.reportingTimezone).toBe(REPORTING_TIME_ZONE);
    expect(report.reportingTimezone).toBe(ACCOUNTING_TIME_ZONE);
    expect(report.completeness).toBe("CURRENT");
    expect(report.projectionLagMs).toBe(0);
    expect(report.generatedAt).toBe(report.dataAsOf);
    expect(report.range).toMatchObject({
      boundary: "half-open",
      source: "EXPLICIT",
      accountingPeriodId: null,
    });
    expect(report.range.from).toBe(period.effectiveStart.toISOString());
    expect(report.range.to).toBe(period.effectiveEnd.toISOString());
    expect(report.coverage.unobservedRange).toBeNull();
    expect(report.coverage.uncoveredRanges).toEqual([]);
    expect(report.coverage.authoritativePeriodCount).toBeGreaterThanOrEqual(1);

    const group = report.periods.find(
      (item: { accountingPeriodId: string }) => item.accountingPeriodId === period.id,
    );
    expect(group).toBeTruthy();
    expect(group.state).toBe(period.state);
    expect(group.transactionCount).toBeGreaterThanOrEqual(1);
    expect(BigInt(group.debitAmountMinor)).toBeGreaterThanOrEqual(5_000n);
    expect(group.creditAmountMinor).toBe(group.debitAmountMinor);
    expect(report.corrections).toEqual([]);
  });

  it("flags a window no authoritative Accounting Period covers as PARTIAL", async () => {
    const precondition = await prisma.accountingPeriod.count({
      where: {
        state: { in: [...REPORTING_POSTABLE_PERIOD_STATES] },
        effectiveStart: { lt: uncoveredWindowEnd },
        effectiveEnd: { gt: uncoveredWindowStart },
      },
    });
    expect(precondition).toBe(0);

    const response = await get(
      `/api/v1/admin/reports/accounting-period-financial?from=${uncoveredWindowStart.toISOString()}&to=${uncoveredWindowEnd.toISOString()}`,
    );
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report.completeness).toBe("PARTIAL");
    expect(report.coverage.authoritativePeriodCount).toBe(0);
    expect(report.coverage.unobservedRange).toBeNull();
    expect(report.coverage.uncoveredRanges).toEqual([
      { from: uncoveredWindowStart.toISOString(), to: uncoveredWindowEnd.toISOString() },
    ]);
    expect(report.periods).toEqual([]);
  });

  it("flags a window beyond the data snapshot as LAGGING instead of presenting it as definitive", async () => {
    const from = new Date(Date.now() + 2 * 24 * 60 * 60 * 1_000);
    const to = new Date(Date.now() + 9 * 24 * 60 * 60 * 1_000);
    const response = await get(
      `/api/v1/admin/reports/accounting-period-financial?from=${from.toISOString()}&to=${to.toISOString()}`,
    );
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report.completeness).toBe("LAGGING");
    expect(report.coverage.unobservedRange).toEqual({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    expect(report.coverage.uncoveredRanges).toEqual([]);
    expect(new Date(report.dataAsOf).getTime()).toBeLessThan(from.getTime());
  });

  it("does not let an unactivated Accounting Period proposal masquerade as coverage", async () => {
    const draftPeriodId = randomUUID();
    const draftInsert = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRawUnsafe(
        `INSERT INTO "accounting_periods"
           ("id","mode","generation_kind","effective_start","effective_end","state","version","created_at","updated_at")
         VALUES ($1::uuid,'CUSTOM','CUSTOM',$2,$3,'DRAFT',1,now(),now())`,
        draftPeriodId,
        uncoveredWindowStart,
        uncoveredWindowEnd,
      );
    });

    try {
      await draftInsert;
      const draft = await prisma.accountingPeriod.findUniqueOrThrow({
        where: { id: draftPeriodId },
        select: { state: true },
      });
      expect(draft.state).toBe("DRAFT");

      const response = await get(
        `/api/v1/admin/reports/accounting-period-financial?from=${uncoveredWindowStart.toISOString()}&to=${uncoveredWindowEnd.toISOString()}`,
      );
      expect(response.status).toBe(200);
      const report = await response.json();

      // A DRAFT proposal cannot host a posting, so it is not coverage and must not
      // upgrade an uncovered window to CURRENT.
      expect(report.completeness).toBe("PARTIAL");
      expect(report.coverage.authoritativePeriodCount).toBe(0);
      expect(report.coverage.uncoveredRanges).toEqual([
        { from: uncoveredWindowStart.toISOString(), to: uncoveredWindowEnd.toISOString() },
      ]);
      expect(report.periods).toEqual([]);
    } finally {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await tx.accountingPeriod.deleteMany({ where: { id: draftPeriodId } });
      });
    }

    // The proposal is fully removed so the uncovered window stays reproducible.
    expect(await prisma.accountingPeriod.count({ where: { id: draftPeriodId } })).toBe(0);
    const postable = await prisma.accountingPeriod.count({
      where: {
        state: { in: [...REPORTING_POSTABLE_PERIOD_STATES] },
        effectiveStart: { lt: uncoveredWindowEnd },
        effectiveEnd: { gt: uncoveredWindowStart },
      },
    });
    expect(postable).toBe(0);
  });

  it("resolves the report window from the authoritative Accounting Period identity", async () => {
    const period = await prisma.accountingPeriod.findUniqueOrThrow({
      where: { id: accountingPeriodIds[0]! },
      select: { effectiveStart: true, effectiveEnd: true },
    });

    const response = await get(
      `/api/v1/admin/reports/accounting-period-financial?accountingPeriodId=${accountingPeriodIds[0]!}`,
    );
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report.range).toMatchObject({
      source: "ACCOUNTING_PERIOD",
      accountingPeriodId: accountingPeriodIds[0]!,
      boundary: "half-open",
    });
    expect(report.range.from).toBe(period.effectiveStart.toISOString());
    expect(report.range.to).toBe(period.effectiveEnd.toISOString());
    expect(report.completeness).toBe("CURRENT");
  });

  it("rejects an ambiguous, unsupported, or missing reporting scope with canonical codes", async () => {
    const ambiguous = await get(
      `/api/v1/admin/reports/accounting-period-financial?accountingPeriodId=${randomUUID()}&from=2019-03-04T00:00:00.000Z&to=2019-03-11T00:00:00.000Z`,
    );
    expect(ambiguous.status).toBe(400);
    expect((await ambiguous.json()).code).toBe("VALIDATION_ERROR");

    const incomplete = await get(
      "/api/v1/admin/reports/accounting-period-financial?from=2019-03-04T00:00:00.000Z",
    );
    expect(incomplete.status).toBe(400);
    expect((await incomplete.json()).code).toBe("VALIDATION_ERROR");

    const inverted = await get(
      "/api/v1/admin/reports/accounting-period-financial?from=2019-03-11T00:00:00.000Z&to=2019-03-04T00:00:00.000Z",
    );
    expect(inverted.status).toBe(400);
    expect((await inverted.json()).code).toBe("VALIDATION_ERROR");

    const unsupportedTimezone = await get(
      "/api/v1/admin/reports/accounting-period-financial?from=2019-03-04T00:00:00.000Z&to=2019-03-11T00:00:00.000Z&timezone=UTC",
    );
    expect(unsupportedTimezone.status).toBe(400);
    expect((await unsupportedTimezone.json()).code).toBe("UNSUPPORTED_REPORTING_TIME_ZONE");

    const declaredTimezone = await get(
      `/api/v1/admin/reports/accounting-period-financial?from=2019-03-04T00:00:00.000Z&to=2019-03-11T00:00:00.000Z&timezone=${REPORTING_TIME_ZONE}`,
    );
    expect(declaredTimezone.status).toBe(200);

    const unknownPeriod = await get(
      `/api/v1/admin/reports/accounting-period-financial?accountingPeriodId=${randomUUID()}`,
    );
    expect(unknownPeriod.status).toBe(404);
    expect((await unknownPeriod.json()).code).toBe("NOT_FOUND");
  });
});
