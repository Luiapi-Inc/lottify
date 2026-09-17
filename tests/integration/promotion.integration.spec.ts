import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/platform/persistence/prisma.service";
import { resetEnvironmentForTests } from "../../src/platform/config/env";
import { FinancialLedgerService } from "../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { MemberWalletService } from "../../src/contexts/wallet-ledger/application/member-wallet.service";
import { PrismaFinancialLedgerRepository } from "../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { DatabaseAccountingPeriodTransactionClock } from "../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import { PromotionLedgerAdapter } from "../../src/platform/integration/promotion-ledger.adapter";
import { PromotionCampaignService } from "../../src/contexts/promotion/application/promotion-campaign.service";
import { PromotionEntitlementService } from "../../src/contexts/promotion/application/promotion-entitlement.service";
import { NotificationPreferenceService } from "../../src/contexts/promotion/application/notification-preference.service";
import { PromotionRuleError } from "../../src/contexts/promotion/domain/rule-error";
import type { PromotionLedgerPort } from "../../src/contexts/promotion/application/promotion-ledger.port";
import type {
  PromotionMemberFacts,
  PromotionMemberFactsPort,
} from "../../src/contexts/promotion/application/promotion-member-facts.port";
import { validTerms } from "../support/promotion-fixtures";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const phonePrefix = "+6697"; // promotion integration namespace

/**
 * Member facts fixture. Promotion consumes the port; the identity-access wiring
 * behind it is proven by its own vertical, so this fixture only has to honour
 * the port contract (the stored Member status).
 */
class PrismaMemberFacts implements PromotionMemberFactsPort {
  constructor(private readonly prisma: PrismaService) {}

  async getMemberFacts(memberId: string): Promise<PromotionMemberFacts> {
    const member = await this.prisma.member.findUniqueOrThrow({
      where: { id: memberId },
      select: { id: true, status: true },
    });
    return { memberId: member.id, status: member.status };
  }
}

/** Ledger seam that reports a crash after the durable BONUS → CASH conversion. */
class CrashAfterConversionLedger implements PromotionLedgerPort {
  private crashed = 0;

  constructor(private readonly delegate: PromotionLedgerPort) {}

  grantBonus(input: Parameters<PromotionLedgerPort["grantBonus"]>[0]) {
    return this.delegate.grantBonus(input);
  }

  async convertBonusToCash(input: Parameters<PromotionLedgerPort["convertBonusToCash"]>[0]) {
    const transactionId = await this.delegate.convertBonusToCash(input);
    if (this.crashed === 0) {
      this.crashed += 1;
      throw new Error("simulated crash after the durable conversion posting");
    }
    return transactionId;
  }

  removeExpiredBonus(input: Parameters<PromotionLedgerPort["removeExpiredBonus"]>[0]) {
    return this.delegate.removeExpiredBonus(input);
  }
}

describe.runIf(runIntegration)("Member API — Promotion vertical integration", () => {
  let prisma: PrismaService;
  let ledger: FinancialLedgerService;
  let ledgerPort: PromotionLedgerAdapter;
  let wallet: MemberWalletService;
  let campaigns: PromotionCampaignService;
  let entitlements: PromotionEntitlementService;
  let preferences: NotificationPreferenceService;
  let memberFacts: PrismaMemberFacts;

  const memberIds: string[] = [];
  const campaignIds: string[] = [];
  const versionIds: string[] = [];
  const entitlementIds: string[] = [];
  const turnoverEntryIds: string[] = [];
  const ledgerTransactionIds: string[] = [];
  const adminIds: string[] = [];
  const sessionIds: string[] = [];
  const reauthEvidenceIds: string[] = [];
  const approvalIds: string[] = [];

  const adminActor = (adminId: string, sessionId: string) => ({
    adminId,
    sessionId,
    role: "ADMIN",
  });

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new FinancialLedgerService(
      new PrismaFinancialLedgerRepository(prisma, new DatabaseAccountingPeriodTransactionClock()),
    );
    ledgerPort = new PromotionLedgerAdapter(ledger);
    wallet = new MemberWalletService(ledger);
    memberFacts = new PrismaMemberFacts(prisma);
    campaigns = new PromotionCampaignService(prisma, memberFacts);
    entitlements = new PromotionEntitlementService(prisma, ledgerPort, memberFacts);
    preferences = new NotificationPreferenceService(prisma);
  });

  afterAll(async () => {
    try {
      await prisma.promotionTurnoverEntry.deleteMany({ where: { id: { in: turnoverEntryIds } } });
      await prisma.promotionTurnoverEntry.deleteMany({ where: { memberId: { in: memberIds } } });
      await prisma.promotionEntitlement.deleteMany({ where: { memberId: { in: memberIds } } });
      await prisma.memberNotificationPreference.deleteMany({ where: { memberId: { in: memberIds } } });
      await prisma.promotionCampaignVersion.deleteMany({ where: { id: { in: versionIds } } });
      await prisma.promotionCampaign.deleteMany({ where: { id: { in: campaignIds } } });

      const transactions = await prisma.financialTransaction.findMany({
        where: { id: { in: ledgerTransactionIds } },
        select: { id: true, accountingPeriodId: true },
      });
      // Accounts this suite's own postings touched. Its flow can cause system
      // accounts (promotion-funding:*) to be created; those must be deleted by id,
      // not by system-code prefix, or the delete sweeps other suites' rows and
      // violates ledger_postings_account_id_fkey under parallel execution.
      const ownAccountIds = (
        await prisma.ledgerPosting.findMany({
          where: { transactionId: { in: transactions.map((row) => row.id) } },
          select: { accountId: true },
          distinct: ["accountId"],
        })
      ).map((row) => row.accountId);
      await prisma.ledgerPosting.deleteMany({
        where: { transactionId: { in: transactions.map((row) => row.id) } },
      });
      await prisma.financialTransaction.deleteMany({
        where: { id: { in: transactions.map((row) => row.id) } },
      });
      await prisma.ledgerAccount.deleteMany({
        where: {
          OR: [{ memberId: { in: memberIds } }, { id: { in: ownAccountIds } }],
        },
      });
      // Accounting periods are auto-created and shared across suites, so only the
      // ones no transaction references any more may be removed — deleting a period
      // another suite still uses violates its foreign key.
      const periodIds = [...new Set(transactions.map((row) => row.accountingPeriodId))];
      const stillReferencedPeriodIds = new Set(
        (
          await prisma.financialTransaction.findMany({
            where: { accountingPeriodId: { in: periodIds } },
            select: { accountingPeriodId: true },
            distinct: ["accountingPeriodId"],
          })
        ).map((row) => row.accountingPeriodId),
      );
      const deletablePeriodIds = periodIds.filter((id) => !stillReferencedPeriodIds.has(id));
      if (deletablePeriodIds.length > 0) {
        await prisma.accountingPeriod.deleteMany({ where: { id: { in: deletablePeriodIds } } });
      }

      await prisma.idempotencyRecord.deleteMany({ where: { scope: { startsWith: "PROMOTION" } } });
      await prisma.idempotencyRecord.deleteMany({ where: { scope: { contains: ":promotion:" } } });
      // Admin approval/audit evidence is immutable by design; the fixture removes
      // its own rows under the same controlled trigger window the lottery
      // integration fixture uses.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'ALTER TABLE "audit_records" DISABLE TRIGGER "audit_records_immutable"',
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE "admin_approval_evidence" DISABLE TRIGGER "admin_approval_evidence_immutable"',
        );
        await tx.auditRecord.deleteMany({ where: { resourceId: { in: versionIds } } });
        await tx.adminApprovalEvidence.deleteMany({ where: { resourceId: { in: versionIds } } });
        await tx.$executeRawUnsafe(
          'ALTER TABLE "admin_approval_evidence" ENABLE TRIGGER "admin_approval_evidence_immutable"',
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE "audit_records" ENABLE TRIGGER "audit_records_immutable"',
        );
      });
      await prisma.adminReauthEvidence.deleteMany({ where: { id: { in: reauthEvidenceIds } } });
      await prisma.adminAuthSession.deleteMany({ where: { id: { in: sessionIds } } });
      await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
      await prisma.member.deleteMany({ where: { id: { in: memberIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  async function createMember(status = "ACTIVE"): Promise<string> {
    const phone = `${phonePrefix}${randomUUID().replace(/\D/g, "").slice(0, 8)}`;
    const member = await prisma.member.create({ data: { phone, status } });
    memberIds.push(member.id);
    return member.id;
  }

  async function createAdmin(): Promise<{ adminId: string; sessionId: string }> {
    const adminId = randomUUID();
    const sessionId = randomUUID();
    await prisma.adminUser.create({
      data: {
        id: adminId,
        email: `promotion-admin-${adminId}@example.test`,
        name: "Promotion Test Admin",
        passwordHash: "test-hash",
        role: "ADMIN",
      },
    });
    await prisma.adminAuthSession.create({
      data: {
        id: sessionId,
        adminUserId: adminId,
        refreshTokenHash: `promotion-refresh-${sessionId}`,
        familyId: randomUUID(),
        expiresAt: new Date("2199-01-01T00:00:00.000Z"),
      },
    });
    adminIds.push(adminId);
    sessionIds.push(sessionId);
    return { adminId, sessionId };
  }

  async function reauthEvidenceFor(adminId: string, sessionId: string): Promise<string> {
    const id = randomUUID();
    await prisma.adminReauthEvidence.create({
      data: {
        id,
        adminUserId: adminId,
        sessionId,
        actionClass: "promotion-campaign.publish",
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    reauthEvidenceIds.push(id);
    return id;
  }

  /**
   * Publishes a Campaign version through the full governed lifecycle and returns
   * the published version id.
   */
  async function publishCampaign(input: {
    terms?: Parameters<typeof validTerms>[0];
    effectiveFrom?: Date;
    effectiveUntil?: Date | null;
    expectedVersion?: number;
  } = {}): Promise<{ versionId: string; campaignCode: string }> {
    const maker = await createAdmin();
    const checker = await createAdmin();
    const campaignCode = `PROMO-${randomUUID().slice(0, 8).toUpperCase()}`;
    const created = await campaigns.createDraftVersion({
      campaignCode,
      version: input.expectedVersion ?? 1,
      terms: validTerms(input.terms),
      effectiveFrom: input.effectiveFrom ?? new Date("2020-01-01T00:00:00.000Z"),
      effectiveUntil: input.effectiveUntil ?? null,
      reason: "integration fixture",
      actor: adminActor(maker.adminId, maker.sessionId),
      correlationId: randomUUID(),
    });
    campaignIds.push(created.campaignId);
    versionIds.push(created.id);

    const validated = await campaigns.validateVersion({
      versionId: created.id,
      expectedRevision: created.revision,
      correlationId: randomUUID(),
    });
    expect(validated.state).toBe("VALIDATED");

    const reauthEvidenceId = await reauthEvidenceFor(checker.adminId, checker.sessionId);
    const published = await campaigns.approveAndPublish({
      versionId: created.id,
      expectedRevision: validated.revision,
      actor: adminActor(checker.adminId, checker.sessionId),
      reauthEvidenceId,
      reason: "integration publish",
      correlationId: randomUUID(),
    });
    if (published.approvalEvidenceRef) approvalIds.push(published.approvalEvidenceRef);
    expect(published.state).toBe("PUBLISHED");
    return { versionId: created.id, campaignCode };
  }

  async function claimFor(memberId: string, campaignVersionId: string, now = new Date()) {
    const entitlement = await entitlements.claimEntitlementIdempotent(
      memberId,
      { campaignVersionId, idempotencyKey: randomUUID() },
      now,
      randomUUID(),
    );
    entitlementIds.push(entitlement.id);
    if (entitlement.grantLedgerTransactionId) {
      ledgerTransactionIds.push(entitlement.grantLedgerTransactionId);
    }
    return entitlement;
  }

  it("publishes a Campaign version through Draft → Validate → Approval and freezes its terms", async () => {
    const maker = await createAdmin();
    const checker = await createAdmin();
    const campaignCode = `PROMO-${randomUUID().slice(0, 8).toUpperCase()}`;
    const created = await campaigns.createDraftVersion({
      campaignCode,
      version: 1,
      terms: validTerms(),
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      effectiveUntil: null,
      reason: "governance fixture",
      actor: adminActor(maker.adminId, maker.sessionId),
      correlationId: randomUUID(),
    });
    campaignIds.push(created.campaignId);
    versionIds.push(created.id);
    expect(created.state).toBe("DRAFT");
    expect(created.termsDigest).toMatch(/^[0-9a-f]{64}$/);

    // A stale expectedVersion never silently overwrites a governed resource.
    await expect(
      campaigns.validateVersion({
        versionId: created.id,
        expectedRevision: created.revision + 5,
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    // Draft cannot be published without validation.
    const reauthEvidenceId = await reauthEvidenceFor(checker.adminId, checker.sessionId);
    await expect(
      campaigns.approveAndPublish({
        versionId: created.id,
        expectedRevision: created.revision,
        actor: adminActor(checker.adminId, checker.sessionId),
        reauthEvidenceId,
        reason: "skip validation",
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    const validated = await campaigns.validateVersion({
      versionId: created.id,
      expectedRevision: created.revision,
      correlationId: randomUUID(),
    });
    expect(validated.state).toBe("VALIDATED");

    // Maker-checker: the requester cannot approve their own version.
    const requesterReauth = await reauthEvidenceFor(maker.adminId, maker.sessionId);
    await expect(
      campaigns.approveAndPublish({
        versionId: created.id,
        expectedRevision: validated.revision,
        actor: adminActor(maker.adminId, maker.sessionId),
        reauthEvidenceId: requesterReauth,
        reason: "self approval",
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL_FORBIDDEN" });

    const published = await campaigns.approveAndPublish({
      versionId: created.id,
      expectedRevision: validated.revision,
      actor: adminActor(checker.adminId, checker.sessionId),
      reauthEvidenceId,
      reason: "governed publish",
      correlationId: randomUUID(),
    });
    expect(published.state).toBe("PUBLISHED");
    expect(published.publishedAt).toBeInstanceOf(Date);
    approvalIds.push(published.approvalEvidenceRef!);

    // The approval and audit evidence are durable and joined to the version.
    const approvals = await prisma.adminApprovalEvidence.findMany({
      where: { resourceId: created.id },
    });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.approverAdminId).toBe(checker.adminId);
    expect(approvals[0]!.requesterAdminId).toBe(maker.adminId);
    expect(approvals[0]!.payloadHash).toBe(published.termsDigest);
    const audits = await prisma.auditRecord.findMany({ where: { resourceId: created.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      outcome: "PUBLISHED",
      approvalId: approvals[0]!.id,
      reauthEvidenceId,
    });

    // Published terms are immutable at the database level, not only in code.
    await expect(
      prisma.promotionCampaignVersion.update({
        where: { id: created.id },
        data: { terms: { ...validTerms(), rewardAmountMinor: "999999" } as never },
      }),
    ).rejects.toThrow();

    // A second version cannot overlap the published effective window.
    const overlapping = await campaigns.createDraftVersion({
      campaignCode,
      version: 2,
      terms: validTerms({ stacking: { mode: "STACKABLE", priority: 1, compatibilityGroup: null } }),
      effectiveFrom: new Date("2020-06-01T00:00:00.000Z"),
      effectiveUntil: null,
      reason: "overlap fixture",
      actor: adminActor(maker.adminId, maker.sessionId),
      correlationId: randomUUID(),
    });
    versionIds.push(overlapping.id);
    const overlapValidated = await campaigns.validateVersion({
      versionId: overlapping.id,
      expectedRevision: overlapping.revision,
      correlationId: randomUUID(),
    });
    const overlapReauth = await reauthEvidenceFor(checker.adminId, checker.sessionId);
    await expect(
      campaigns.approveAndPublish({
        versionId: overlapping.id,
        expectedRevision: overlapValidated.revision,
        actor: adminActor(checker.adminId, checker.sessionId),
        reauthEvidenceId: overlapReauth,
        reason: "overlapping publish",
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "OVERLAPPING_PUBLISHED_VERSION" });
  });

  it("discovers a published Promotion for an eligible Member and refuses an excluded one", async () => {
    const eligibleMember = await createMember();
    const suspendedMember = await createMember("DISABLED");
    const excludedMember = await createMember();
    const { versionId, campaignCode } = await publishCampaign({
      terms: { eligibility: { requiredMemberStatus: "ACTIVE", excludedMemberIds: [] } },
    });

    const discovery = await campaigns.discoverForMember(eligibleMember, new Date());
    const item = discovery.items.find((entry) => entry.campaignVersionId === versionId)!;
    expect(item.campaignCode).toBe(campaignCode);
    expect(item.eligible).toBe(true);
    expect(item.ineligibilityReasons).toEqual([]);
    expect(item.rewardAmountMinor).toBe("50000");
    expect(item.turnoverTargetMinor).toBe("150000");

    const suspended = await campaigns.discoverForMember(suspendedMember, new Date());
    expect(
      suspended.items.find((entry) => entry.campaignVersionId === versionId)?.ineligibilityReasons,
    ).toEqual(["MEMBER_STATUS_MISMATCH"]);

    // A Campaign-specific exclusion is evaluated before any grant.
    const excluded = await publishCampaign({
      terms: {
        eligibility: { requiredMemberStatus: null, excludedMemberIds: [excludedMember] },
      },
    });
    const excludedDiscovery = await campaigns.discoverForMember(excludedMember, new Date());
    expect(
      excludedDiscovery.items.find((entry) => entry.campaignVersionId === excluded.versionId)
        ?.ineligibilityReasons,
    ).toEqual(["MEMBER_EXCLUDED"]);
    await expect(claimFor(excludedMember, excluded.versionId)).rejects.toMatchObject({
      code: "ENTITLEMENT_NOT_ELIGIBLE",
    });

    // The Admin preview reports the same decision without granting anything.
    const preview = await campaigns.previewEligibility({
      versionId,
      memberId: eligibleMember,
      now: new Date(),
    });
    expect(preview.eligible).toBe(true);
    expect(preview.entitlementPreview.turnoverTargetMinor).toBe("150000");
    expect(
      await prisma.promotionEntitlement.count({ where: { memberId: eligibleMember } }),
    ).toBe(0);
  });

  it("grants a snapshotted Entitlement through the Ledger and replays the claim exactly once", async () => {
    const memberId = await createMember();
    const { versionId } = await publishCampaign();

    const claimed = await claimFor(memberId, versionId);
    expect(claimed.state).toBe("ACTIVE");
    expect(claimed.grantLedgerTransactionId).toBeTruthy();
    expect(claimed.rewardMinor).toBe(50_000n);
    expect(claimed.terms.rewardAmountMinor).toBe("50000");
    expect(claimed.turnover.targetMinor).toBe(150_000n);
    expect(claimed.expiresAt.getTime()).toBeGreaterThan(claimed.grantedAt.getTime());
    expect(claimed.allowedActions).toEqual(["RELEASE_PENDING", "EXPIRED", "REVOKED"]);

    // The granted value is traceable to the Entitlement in the financial core.
    const grant = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: claimed.grantLedgerTransactionId! },
    });
    expect(grant.operationType).toBe("PROMOTION_BONUS_GRANT");
    expect(grant.domainReferences).toMatchObject({ promotionEntitlementId: claimed.id });

    const balance = await wallet.getBalance(memberId);
    expect(balance.buckets.find((bucket) => bucket.bucket === "BONUS")?.postedMinor).toBe(50_000n);
    expect(balance.buckets.find((bucket) => bucket.bucket === "CASH")?.postedMinor).toBe(0n);

    // A retry of the same claim restores the same Entitlement and never
    // double-credits: the grant is idempotent on the Entitlement id.
    const replay = await entitlements.claimEntitlementIdempotent(
      memberId,
      { campaignVersionId: versionId, idempotencyKey: randomUUID() },
      new Date(),
      randomUUID(),
    );
    expect(replay.id).toBe(claimed.id);
    expect(await prisma.promotionEntitlement.count({ where: { memberId } })).toBe(1);
    const grantTransactions = await prisma.financialTransaction.findMany({
      where: { businessTransactionId: `promotion-grant:${claimed.id}` },
    });
    expect(grantTransactions).toHaveLength(1);
    expect((await wallet.getBalance(memberId)).buckets.find((b) => b.bucket === "BONUS")?.postedMinor).toBe(
      50_000n,
    );
  });

  it("records provisional turnover, removes it on cancellation and releases only on finalized contribution", async () => {
    const memberId = await createMember();
    const { versionId } = await publishCampaign();
    const claimed = await claimFor(memberId, versionId);

    const stake = (betReference: string, amountMinor: bigint) => ({
      memberId,
      betReference,
      productId: "product-1",
      betTypeCode: "TWO_DIGIT",
      stakeMinor: amountMinor,
      payoutRef: "payout-v1",
      acceptedAt: new Date(),
      correlationId: randomUUID(),
    });

    // Cancelled Bet: provisional contribution is removed and never releases.
    const cancelled = await entitlements.recordConfirmedBetTurnover(stake("bet-cancelled", 50_000n));
    expect(cancelled.recorded).toBe(true);
    expect(cancelled.contributionMinor).toBe("50000");
    expect(cancelled.entitlement!.turnover.provisionalMinor).toBe(50_000n);
    expect(cancelled.entitlement!.turnover.releaseReached).toBe(false);

    const afterCancel = await entitlements.releaseProvisionalTurnover({
      memberId,
      betReference: "bet-cancelled",
      correlationId: randomUUID(),
    });
    expect(afterCancel.entitlement!.turnover.provisionalMinor).toBe(0n);
    expect(afterCancel.entitlement!.state).toBe("ACTIVE");

    // Two settled Bets plus one provisional Bet reach the target on paper, but
    // only finalized contribution may release the Promotion.
    await entitlements.recordConfirmedBetTurnover(stake("bet-1", 50_000n));
    await entitlements.recordConfirmedBetTurnover(stake("bet-2", 50_000n));
    await entitlements.recordConfirmedBetTurnover(stake("bet-3", 50_000n));
    const firstFinalize = await entitlements.finalizeTurnover({
      memberId,
      betReference: "bet-1",
      correlationId: randomUUID(),
    });
    const secondFinalize = await entitlements.finalizeTurnover({
      memberId,
      betReference: "bet-2",
      correlationId: randomUUID(),
    });
    expect(firstFinalize.entitlement!.turnover.finalizedMinor).toBe(50_000n);
    expect(secondFinalize.entitlement!.state).toBe("ACTIVE");
    expect(secondFinalize.entitlement!.turnover.progressMinor).toBe(150_000n);
    expect(secondFinalize.entitlement!.turnover.releaseReached).toBe(false);

    const released = await entitlements.finalizeTurnover({
      memberId,
      betReference: "bet-3",
      correlationId: randomUUID(),
    });
    const completed = released.entitlement!;
    expect(completed.state).toBe("COMPLETED");
    expect(completed.releaseLedgerTransactionId).toBeTruthy();
    if (completed.releaseLedgerTransactionId) {
      ledgerTransactionIds.push(completed.releaseLedgerTransactionId);
    }
    expect(completed.releasedMinor).toBe(50_000n);
    expect(completed.completedAt).toBeInstanceOf(Date);

    // The release is an authoritative Ledger conversion, not a balance edit.
    const conversion = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: completed.releaseLedgerTransactionId! },
    });
    expect(conversion.operationType).toBe("PROMOTION_BONUS_TO_CASH");
    expect(conversion.domainReferences).toMatchObject({ promotionEntitlementId: completed.id });
    const balance = await wallet.getBalance(memberId);
    expect(balance.buckets.find((bucket) => bucket.bucket === "BONUS")?.postedMinor).toBe(0n);
    expect(balance.buckets.find((bucket) => bucket.bucket === "CASH")?.postedMinor).toBe(50_000n);

    // Turnover history is preserved and the contribution trail is complete.
    const entries = await prisma.promotionTurnoverEntry.findMany({
      where: { entitlementId: claimed.id },
      orderBy: { betReference: "asc" },
    });
    expect(entries.map((entry) => `${entry.betReference}:${entry.state}`)).toEqual([
      "bet-1:FINALIZED",
      "bet-2:FINALIZED",
      "bet-3:FINALIZED",
      "bet-cancelled:REMOVED",
    ]);
    turnoverEntryIds.push(...entries.map((entry) => entry.id));
  });

  it("recovers a release that crashed after the durable conversion without converting twice", async () => {
    const memberId = await createMember();
    const { versionId } = await publishCampaign();
    const crashing = new CrashAfterConversionLedger(ledgerPort);
    const recovering = new PromotionEntitlementService(prisma, crashing, memberFacts);

    const claimed = await recovering.claimEntitlementIdempotent(
      memberId,
      { campaignVersionId: versionId, idempotencyKey: randomUUID() },
      new Date(),
      randomUUID(),
    );
    entitlementIds.push(claimed.id);
    ledgerTransactionIds.push(claimed.grantLedgerTransactionId!);

    await recovering.recordConfirmedBetTurnover({
      memberId,
      betReference: "bet-recover",
      productId: "product-1",
      betTypeCode: "TWO_DIGIT",
      stakeMinor: 150_000n,
      payoutRef: "payout-v1",
      acceptedAt: new Date(),
      correlationId: randomUUID(),
    });

    await expect(
      recovering.finalizeTurnover({ memberId, betReference: "bet-recover", correlationId: randomUUID() }),
    ).rejects.toThrow(/simulated crash after the durable conversion posting/);

    // The conversion is durable in the financial core even though the Promotion
    // resolution never committed, and the Entitlement has no half-completed
    // state: it is still ACTIVE with a provisional contribution.
    const stuck = await prisma.promotionEntitlement.findUniqueOrThrow({ where: { id: claimed.id } });
    expect(stuck.state).toBe("ACTIVE");
    expect(stuck.releaseLedgerTransactionId).toBeNull();
    expect(stuck.releasedMinor).toBe(0n);
    expect(
      await prisma.financialTransaction.count({
        where: { businessTransactionId: `promotion-release:${claimed.id}` },
      }),
    ).toBe(1);

    // Recovery replays the idempotent conversion and resolves COMPLETED with
    // exactly one conversion posting — never a second one.
    const recovered = (
      await entitlements.finalizeTurnover({
        memberId,
        betReference: "bet-recover",
        correlationId: randomUUID(),
      })
    ).entitlement!;
    expect(recovered.state).toBe("COMPLETED");
    expect(recovered.releasedMinor).toBe(50_000n);
    ledgerTransactionIds.push(recovered.releaseLedgerTransactionId!);

    // The release is an authoritative Ledger conversion, not a balance edit, and
    // the recovery produced exactly one conversion posting.
    const conversion = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: recovered.releaseLedgerTransactionId! },
    });
    expect(conversion.operationType).toBe("PROMOTION_BONUS_TO_CASH");
    expect(
      await prisma.financialTransaction.count({
        where: { businessTransactionId: `promotion-release:${claimed.id}` },
      }),
    ).toBe(1);
    const balance = await wallet.getBalance(memberId);
    expect(balance.buckets.find((bucket) => bucket.bucket === "BONUS")?.postedMinor).toBe(0n);
    expect(balance.buckets.find((bucket) => bucket.bucket === "CASH")?.postedMinor).toBe(50_000n);
  });

  it("corrects turnover with a compensating adjustment and never rewrites history", async () => {
    const memberId = await createMember();
    const { versionId } = await publishCampaign();
    const claimed = await claimFor(memberId, versionId);

    await entitlements.recordConfirmedBetTurnover({
      memberId,
      betReference: "bet-correct",
      productId: "product-1",
      betTypeCode: "TWO_DIGIT",
      stakeMinor: 100_000n,
      payoutRef: "payout-v1",
      acceptedAt: new Date(),
      correlationId: randomUUID(),
    });
    await entitlements.finalizeTurnover({
      memberId,
      betReference: "bet-correct",
      correlationId: randomUUID(),
    });

    const corrected = await entitlements.correctTurnover({
      memberId,
      betReference: "bet-correct",
      correctedContributionMinor: 40_000n,
      correctionReference: `correction-${randomUUID()}`,
      correlationId: randomUUID(),
    });
    expect(corrected.entitlement!.turnover.finalizedMinor).toBe(40_000n);
    expect(corrected.entitlement!.state).toBe("ACTIVE");

    const entries = await prisma.promotionTurnoverEntry.findMany({
      where: { entitlementId: claimed.id },
      orderBy: { entryKind: "asc" },
    });
    const bet = entries.find((entry) => entry.entryKind === "BET")!;
    const adjustment = entries.find((entry) => entry.entryKind === "ADJUSTMENT")!;
    expect(bet.contributionMinor).toBe(100_000n);
    expect(bet.state).toBe("FINALIZED");
    expect(adjustment.contributionMinor).toBe(-60_000n);
    expect(adjustment.correctsEntryId).toBe(bet.id);
    expect(adjustment.state).toBe("FINALIZED");
    turnoverEntryIds.push(...entries.map((entry) => entry.id));
  });

  it("expires an Entitlement by removing only its remaining BONUS value", async () => {
    const memberId = await createMember();
    const { versionId } = await publishCampaign({ terms: { expiryDaysAfterGrant: 30 } });
    const claimed = await claimFor(memberId, versionId);

    const early = await entitlements.expireEntitlementIfDue(
      memberId,
      claimed.id,
      new Date(claimed.expiresAt.getTime() - 60_000),
      randomUUID(),
    );
    expect(early.state).toBe("ACTIVE");

    const expired = await entitlements.expireEntitlementIfDue(
      memberId,
      claimed.id,
      new Date(claimed.expiresAt.getTime() + 1),
      randomUUID(),
    );
    expect(expired.state).toBe("EXPIRED");
    expect(expired.expiredAt).toBeInstanceOf(Date);
    expect(expired.expiryLedgerTransactionId).toBeTruthy();
    ledgerTransactionIds.push(expired.expiryLedgerTransactionId!);

    const expiry = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: expired.expiryLedgerTransactionId! },
    });
    expect(expiry.operationType).toBe("PROMOTION_BONUS_EXPIRY");
    const balance = await wallet.getBalance(memberId);
    expect(balance.buckets.find((bucket) => bucket.bucket === "BONUS")?.postedMinor).toBe(0n);
    // CASH was never touched by the bonus expiry.
    expect(balance.buckets.find((bucket) => bucket.bucket === "CASH")?.postedMinor).toBe(0n);
  });

  it("stores notification preferences as a complete matrix and refuses to disable mandatory topics", async () => {
    const memberId = await createMember();
    const defaults = await preferences.listPreferences(memberId);
    expect(defaults.items).toHaveLength(12);
    expect(defaults.items.every((item) => item.enabled && item.version === 0)).toBe(true);

    const updated = await preferences.updatePreferences(memberId, [
      { topic: "PROMOTIONAL", channel: "SMS", enabled: false },
      { topic: "RESULT", channel: "EMAIL", enabled: false },
    ]);
    expect(
      updated.items.find((item) => item.topic === "PROMOTIONAL" && item.channel === "SMS"),
    ).toMatchObject({ enabled: false, version: 1 });
    expect(
      updated.items.find((item) => item.topic === "RESULT" && item.channel === "EMAIL"),
    ).toMatchObject({ enabled: false, version: 1 });
    expect(
      updated.items.find((item) => item.topic === "TRANSACTIONAL" && item.channel === "SMS"),
    ).toMatchObject({ enabled: true });

    await expect(
      preferences.updatePreferences(memberId, [
        { topic: "TRANSACTIONAL", channel: "SMS", enabled: false },
      ]),
    ).rejects.toBeInstanceOf(PromotionRuleError);

    // Re-applying the same change set is a no-op: versions do not drift.
    const replayed = await preferences.updatePreferences(memberId, [
      { topic: "PROMOTIONAL", channel: "SMS", enabled: false },
    ]);
    expect(
      replayed.items.find((item) => item.topic === "PROMOTIONAL" && item.channel === "SMS")?.version,
    ).toBe(1);
  });
});
