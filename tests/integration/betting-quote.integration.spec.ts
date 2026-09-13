import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../src/platform/persistence/prisma.service";
import { resetEnvironmentForTests } from "../../src/platform/config/env";
import { LotteryDrawService } from "../../src/contexts/lottery/application/lottery-draw.service";
import {
  BettingQuoteService,
  BettingQuoteError,
} from "../../src/contexts/betting/application/betting-quote.service";
import { BettingQuoteDrawAdapter } from "../../src/platform/integration/quote-draw.adapter";
import { QuoteRuleError } from "../../src/contexts/betting/domain/quote";
import {
  allowBetEligibility,
  denyBetEligibility,
} from "../support/betting-eligibility.fake";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

describe.runIf(runIntegration)("Betting Quote resolver + persistence", () => {
  let prisma: PrismaService;
  let draws: LotteryDrawService;
  let quotes: BettingQuoteService;
  let adminId: string;
  let sessionId: string;
  const memberIds: string[] = [];
  const productIds: string[] = [];
  const betTypeIds: string[] = [];
  const productVersionIds: string[] = [];
  const betTypeVersionIds: string[] = [];
  const drawIds: string[] = [];
  const overrideIds: string[] = [];
  const quoteIds: string[] = [];

  const actor = () => ({ adminId, sessionId, role: "ADMIN" as const });

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    draws = new LotteryDrawService(prisma);
    quotes = new BettingQuoteService(
      prisma,
      new BettingQuoteDrawAdapter(prisma),
      allowBetEligibility,
    );

    adminId = randomUUID();
    sessionId = randomUUID();
    await prisma.adminUser.create({
      data: {
        id: adminId,
        email: `quote-admin-${adminId}@example.test`,
        name: "Quote Test Admin",
        passwordHash: "test-hash",
        role: "ADMIN",
      },
    });
    await prisma.adminAuthSession.create({
      data: {
        id: sessionId,
        adminUserId: adminId,
        refreshTokenHash: `quote-refresh-${sessionId}`,
        familyId: randomUUID(),
        expiresAt: new Date("2199-01-01T00:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_version_bet_types" DISABLE TRIGGER "lottery_product_version_links_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_versions" DISABLE TRIGGER "lottery_product_versions_published_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_bet_type_versions" DISABLE TRIGGER "lottery_bet_type_versions_published_immutable"');
        await tx.bettingQuoteLine.deleteMany({ where: { quote: { memberId: { in: memberIds } } } });
        await tx.bettingQuote.deleteMany({ where: { memberId: { in: memberIds } } });
        await tx.lotteryDrawOverride.deleteMany({ where: { drawId: { in: drawIds } } });
        await tx.lotteryDrawBetType.deleteMany({ where: { drawId: { in: drawIds } } });
        await tx.lotteryDraw.deleteMany({ where: { id: { in: drawIds } } });
        await tx.lotteryProductVersionBetType.deleteMany({ where: { productVersionId: { in: productVersionIds } } });
        await tx.lotteryProductVersion.deleteMany({ where: { id: { in: productVersionIds } } });
        await tx.lotteryBetTypeVersion.deleteMany({ where: { id: { in: betTypeVersionIds } } });
        await tx.lotteryProduct.deleteMany({ where: { id: { in: productIds } } });
        await tx.lotteryBetType.deleteMany({ where: { id: { in: betTypeIds } } });
        await tx.member.deleteMany({ where: { id: { in: memberIds } } });
        await tx.adminAuthSession.deleteMany({ where: { id: sessionId } });
        await tx.adminUser.deleteMany({ where: { id: adminId } });
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_bet_type_versions" ENABLE TRIGGER "lottery_bet_type_versions_published_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_versions" ENABLE TRIGGER "lottery_product_versions_published_immutable"');
        await tx.$executeRawUnsafe('ALTER TABLE "lottery_product_version_bet_types" ENABLE TRIGGER "lottery_product_version_links_immutable"');
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  async function publishedProductFixture(prefix: string): Promise<{
    productId: string;
    productVersionId: string;
    betTypeId: string;
    betTypeVersionId: string;
  }> {
    const suffix = randomUUID();
    const productId = randomUUID();
    const betTypeId = randomUUID();
    const productVersionId = randomUUID();
    const betTypeVersionId = randomUUID();
    productIds.push(productId);
    betTypeIds.push(betTypeId);
    productVersionIds.push(productVersionId);
    betTypeVersionIds.push(betTypeVersionId);
    await prisma.lotteryProduct.create({ data: { id: productId } });
    await prisma.lotteryBetType.create({
      data: { id: betTypeId, code: `${prefix}_${suffix.slice(0, 8)}` },
    });
    await prisma.lotteryBetTypeVersion.create({
      data: {
        id: betTypeVersionId,
        betTypeId,
        state: "PUBLISHED",
        canonicalNumberFormat: "00",
        validationPattern: "^[0-9]{2}$",
        defaultPayout: { kind: "FIXED", amountMinor: 9000 },
        minStakeMinor: 100n,
        maxStakeMinor: 100000n,
        limitPolicyRef: "limit-v1",
        restrictionPolicyRef: "restriction-v1",
        settlementRuleVersionRef: "settlement-v1",
        effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    await prisma.lotteryProductVersion.create({
      data: {
        id: productVersionId,
        productId,
        state: "DRAFT",
        timezone: "Asia/Bangkok",
        scheduleTemplateRef: "schedule-v1",
        resultSchemaVersionRef: "result-v1",
        settlementRuleVersionRef: "settlement-v1",
        defaultPayoutPolicyRef: "payout-v1",
        defaultLimitPolicyRef: "limit-v1",
        defaultRestrictionPolicyRef: "restriction-v1",
        effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    await prisma.lotteryProductVersionBetType.create({
      data: { productVersionId, betTypeId, betTypeVersionId },
    });
    await prisma.lotteryProductVersion.update({
      where: { id: productVersionId },
      data: { state: "PUBLISHED" },
    });
    return { productId, productVersionId, betTypeId, betTypeVersionId };
  }

  async function openDraw(prefix: string, day: string): Promise<{
    drawId: string;
    betTypeId: string;
    betTypeCode: string;
    cutoffAt: Date;
  }> {
    const { productId, betTypeId } = await publishedProductFixture(prefix);
    const occurrence = {
      occurrenceIdentity: `${productId}-${day}`,
      localDate: day,
      openAt: new Date(`${day}T06:00:00.000Z`),
      cutoffAt: new Date(`${day}T11:00:00.000Z`),
      drawAt: new Date(`${day}T12:00:00.000Z`),
      provenance: "SCHEDULE_GENERATED" as const,
    };
    const summary = (await draws.generateDraws({ productId, baseOccurrences: [occurrence], actor: actor() })).created[0]!;
    drawIds.push(summary.id);
    await draws.transition({ id: summary.id, command: "SCHEDULE", expectedVersion: 1, actor: actor() });
    await draws.transition({ id: summary.id, command: "OPEN", expectedVersion: 2, actor: actor() });
    const draw = await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: summary.id } });
    const betType = await prisma.lotteryDrawBetType.findFirstOrThrow({ where: { drawId: summary.id } });
    return { drawId: summary.id, betTypeId, betTypeCode: betType.betTypeCode, cutoffAt: draw.cutoffAt };
  }

  async function newMember(): Promise<string> {
    const id = randomUUID();
    memberIds.push(id);
    await prisma.member.create({
      data: { id, phone: `+66${id.replaceAll("-", "").slice(0, 10)}` },
    });
    return id;
  }

  it("resolves, aggregates and persists a Quote with server-authoritative payout, total and expiry", async () => {
    const { drawId, betTypeCode } = await openDraw("Q_HAPPY", "2099-08-05");
    const memberId = await newMember();
    const serverNow = new Date("2099-08-05T08:00:00.000Z");

    const quote = await quotes.createQuote({
      memberId,
      drawId,
      currency: "THB",
      idempotencyKey: `happy-${randomUUID()}`,
      lines: [
        { betTypeCode, canonicalNumber: "42", stakeMinor: 100n },
        { betTypeCode, canonicalNumber: "42", stakeMinor: 200n },
        { betTypeCode, canonicalNumber: "07", stakeMinor: 300n },
      ],
      now: serverNow,
    });
    quoteIds.push(quote.id);

    expect(quote.status).toBe("QUOTED");
    expect(quote.totalStakeMinor).toBe(600n);
    expect(quote.lines).toHaveLength(2);
    const fortyTwo = quote.lines.find((line) => line.canonicalNumber === "42");
    expect(fortyTwo).toMatchObject({
      stakeMinor: 300n,
      payoutSource: "DRAW_SNAPSHOT",
      resolvedPayout: { kind: "FIXED", amountMinor: 9000 },
      restrictions: [],
    });
    // TTL (120s) is earlier than the cutoff, so the quote expires at serverNow + TTL.
    expect(quote.expiresAt.getTime()).toBe(serverNow.getTime() + 120_000);
    expect(quote.cutoffAt.toISOString()).toBe("2099-08-05T11:00:00.000Z");

    const stored = await prisma.bettingQuote.findUniqueOrThrow({
      where: { id: quote.id },
      include: { lines: true },
    });
    expect(stored.totalStakeMinor).toBe(600n);
    expect(stored.lines).toHaveLength(2);
    expect(stored.idempotencyScope).toBe(`BET_QUOTE:${memberId}`);

    const read = await quotes.getQuote(memberId, quote.id, serverNow);
    expect(read.id).toBe(quote.id);
    expect(read.status).toBe("QUOTED");
  });

  it("enforces strictest stake limits and BLOCKED restrictions as denial/restriction", async () => {
    const { drawId, betTypeId, betTypeCode } = await openDraw("Q_DENY", "2099-09-05");
    const memberId = await newMember();
    const serverNow = new Date("2099-09-05T08:00:00.000Z");

    await expect(
      quotes.createQuote({
        memberId,
        drawId,
        currency: "THB",
        idempotencyKey: `below-${randomUUID()}`,
        lines: [{ betTypeCode, canonicalNumber: "42", stakeMinor: 50n }], // below min 100
        now: serverNow,
      }),
    ).rejects.toMatchObject({ code: "STAKE_BELOW_MINIMUM" });

    await expect(
      quotes.createQuote({
        memberId,
        drawId,
        currency: "THB",
        idempotencyKey: `above-${randomUUID()}`,
        lines: [{ betTypeCode, canonicalNumber: "42", stakeMinor: 200000n }], // above max 100000
        now: serverNow,
      }),
    ).rejects.toMatchObject({ code: "STAKE_LIMIT_EXCEEDED" });

    // Apply a HARD_EMERGENCY BLOCKED restriction on the number, then a quote for it is denied.
    await draws.applyDrawOverride({
      drawId,
      reason: "Block number 13 for a Draw",
      actor: actor(),
      changes: {
        betTypes: [
          {
            betTypeId,
            numberRestrictions: [
              { kind: "BLOCKED", numbers: ["13"] },
            ],
            restrictionSeverity: "HARD_EMERGENCY",
          },
        ],
      } as never,
      approvalEvidenceRef: `approval-${randomUUID()}`,
      auditEvidenceRef: `audit-${randomUUID()}`,
      effectiveAt: new Date("2099-09-05T07:00:00.000Z"),
    });

    await expect(
      quotes.createQuote({
        memberId,
        drawId,
        currency: "THB",
        idempotencyKey: `blocked-${randomUUID()}`,
        lines: [{ betTypeCode, canonicalNumber: "13", stakeMinor: 100n }],
        now: serverNow,
      }),
    ).rejects.toMatchObject({ code: "NUMBER_BLOCKED" });
  });

  it("enforces the authoritative cutoff and quote TTL expiry", async () => {
    const { drawId, betTypeCode } = await openDraw("Q_CUTOFF", "2099-10-05");
    const memberId = await newMember();
    const cutoffAt = new Date("2099-10-05T11:00:00.000Z");

    // Post-cutoff creation is rejected.
    const after = new Date(cutoffAt.getTime() + 60_000);
    await expect(
      quotes.createQuote({
        memberId,
        drawId,
        currency: "THB",
        idempotencyKey: `late-${randomUUID()}`,
        lines: [{ betTypeCode, canonicalNumber: "42", stakeMinor: 100n }],
        now: after,
      }),
    ).rejects.toMatchObject({ code: "QUOTE_CUTOFF_REACHED" });

    // A quote created before cutoff is read as EXPIRED once server time passes expiry.
    const created = await quotes.createQuote({
      memberId,
      drawId,
      currency: "THB",
      idempotencyKey: `ttl-${randomUUID()}`,
      lines: [{ betTypeCode, canonicalNumber: "42", stakeMinor: 100n }],
      now: new Date("2099-10-05T08:00:00.000Z"),
    });
    quoteIds.push(created.id);
    const expiredRead = await quotes.getQuote(
      memberId,
      created.id,
      new Date("2099-10-05T08:02:01.000Z"), // 121s later, past TTL
    );
    expect(expiredRead.status).toBe("EXPIRED");
  });

  it("is idempotent by Idempotency-Key and conflicts on a changed payload", async () => {
    const { drawId, betTypeCode } = await openDraw("Q_IDEM", "2099-11-05");
    const memberId = await newMember();
    const serverNow = new Date("2099-11-05T08:00:00.000Z");
    const key = `idem-${randomUUID()}`;

    const first = await quotes.createQuote({
      memberId,
      drawId,
      currency: "THB",
      idempotencyKey: key,
      lines: [
        { betTypeCode, canonicalNumber: "42", stakeMinor: 100n },
        { betTypeCode, canonicalNumber: "42", stakeMinor: 100n },
      ],
      now: serverNow,
    });
    quoteIds.push(first.id);

    const replay = await quotes.createQuote({
      memberId,
      drawId,
      currency: "THB",
      idempotencyKey: key,
      lines: [
        { betTypeCode, canonicalNumber: "42", stakeMinor: 100n },
        { betTypeCode, canonicalNumber: "42", stakeMinor: 100n },
      ],
      now: serverNow,
    });
    expect(replay.id).toBe(first.id);

    // Same key with a different payload is an IDEMPOTENCY_CONFLICT.
    await expect(
      quotes.createQuote({
        memberId,
        drawId,
        currency: "THB",
        idempotencyKey: key,
        lines: [{ betTypeCode, canonicalNumber: "07", stakeMinor: 100n }],
        now: serverNow,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const count = await prisma.bettingQuote.count({
      where: { idempotencyScope: `BET_QUOTE:${memberId}`, idempotencyKey: key },
    });
    expect(count).toBe(1);
  });

  it("denies Quote creation on current BET eligibility before Draw resolution", async () => {
    const memberId = await newMember();
    const serverNow = new Date("2099-12-05T08:00:00.000Z");
    const deniedQuotes = new BettingQuoteService(
      prisma,
      new BettingQuoteDrawAdapter(prisma),
      denyBetEligibility,
    );

    await expect(
      deniedQuotes.createQuote({
        memberId,
        drawId: randomUUID(),
        currency: "THB",
        idempotencyKey: `eligibility-deny-${randomUUID()}`,
        lines: [{ betTypeCode: "TWO_DIGIT", canonicalNumber: "42", stakeMinor: 100n }],
        now: serverNow,
      }),
    ).rejects.toMatchObject({
      code: "MEMBER_NOT_ELIGIBLE",
      status: 403,
      details: {
        outcome: "DENY",
        reasonCodes: ["KYC_REQUIRED"],
        policyVersion: "capability-readiness-policy-v1",
      },
    });

    expect(await prisma.bettingQuote.count({ where: { memberId } })).toBe(0);
  });

  it("denies access to another member's quote and missing draws", async () => {
    const { drawId, betTypeCode } = await openDraw("Q_ACCESS", "2099-12-05");
    const memberA = await newMember();
    const memberB = await newMember();
    const serverNow = new Date("2099-12-05T08:00:00.000Z");

    const quote = await quotes.createQuote({
      memberId: memberA,
      drawId,
      currency: "THB",
      idempotencyKey: `access-${randomUUID()}`,
      lines: [{ betTypeCode, canonicalNumber: "42", stakeMinor: 100n }],
      now: serverNow,
    });
    quoteIds.push(quote.id);

    await expect(
      quotes.getQuote(memberB, quote.id, serverNow),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      quotes.createQuote({
        memberId: memberA,
        drawId: randomUUID(),
        currency: "THB",
        idempotencyKey: `missing-draw-${randomUUID()}`,
        lines: [{ betTypeCode, canonicalNumber: "42", stakeMinor: 100n }],
        now: serverNow,
      }),
    ).rejects.toMatchObject({ code: "DRAW_NOT_FOUND" });
  });

  it("exposes canonical error contract on the domain error types", () => {
    expect(new QuoteRuleError("NUMBER_BLOCKED", "blocked", 409, {}).code).toBe("NUMBER_BLOCKED");
    expect(new BettingQuoteError("QUOTE_CUTOFF_REACHED", "late", 409, {}).status).toBe(409);
  });
});
