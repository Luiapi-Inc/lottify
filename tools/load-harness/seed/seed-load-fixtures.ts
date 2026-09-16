// Test-scoped fixture seeding for the Lottify load/performance harness.
//
// Why this exists: `apps/api` exposes no @Public route, so a load driver has to
// present real Member sessions. Rather than adding a production authentication
// bypass, this script provisions fixtures through the repository's own services
// (SessionService for sessions, FinancialLedgerService for funding, the Betting
// services for Quotes/Orders) against a database the harness owns.
//
// Safety:
//   * refuses to write when the target database name matches /prod|production/i
//     unless --allow-shared-db is passed explicitly;
//   * warns loudly when the target is a shared development database;
//   * records every id it creates in the manifest so --cleanup can delete exactly
//     those rows and nothing else (never prefix-based deletion);
//   * --cleanup is the only delete path in the harness.
//
// Usage:
//   pnpm load:seed -- --profile smoke --manifest <path>  --members 20 --settlement-orders 200
//   pnpm load:seed -- --manifest <path> --cleanup
//
// Exit code 0 on success, 2 on a guard refusal, 1 on failure.

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { JwtService } from "@nestjs/jwt";

import { PrismaService } from "../../../src/platform/persistence/prisma.service";
import { getEnvironment, resetEnvironmentForTests } from "../../../src/platform/config/env";
import { LotteryDrawService } from "../../../src/contexts/lottery/application/lottery-draw.service";
import { BettingQuoteService } from "../../../src/contexts/betting/application/betting-quote.service";
import { BettingOrderService } from "../../../src/contexts/betting/application/betting-order.service";
import { BettingQuoteDrawAdapter } from "../../../src/platform/integration/quote-draw.adapter";
import { BetOrderWalletAdapter } from "../../../src/platform/integration/betting-order-wallet.adapter";
import { PrismaDrawAdmissionBoundary } from "../../../src/platform/concurrency/prisma-draw-admission.boundary";
import { FinancialLedgerService } from "../../../src/contexts/wallet-ledger/application/financial-ledger.service";
import { PrismaFinancialLedgerRepository } from "../../../src/contexts/wallet-ledger/infrastructure/prisma-financial-ledger.repository";
import { DatabaseAccountingPeriodTransactionClock } from "../../../src/contexts/wallet-ledger/infrastructure/accounting-period-runtime";
import { SessionService } from "../../../src/contexts/identity-access/application/session.service";
import { PrismaSessionRepository } from "../../../src/contexts/identity-access/infrastructure/prisma-session.repository";
import { AdminAuthService } from "../../../src/contexts/identity-access/application/admin-auth.service";
import { PrismaAdminAuthRepository } from "../../../src/contexts/identity-access/infrastructure/prisma-admin-auth.repository";
import { hashAdminPassword } from "../../../src/contexts/identity-access/domain/admin-password";
import { generateTotpCode, generateTotpSecret } from "../../../src/contexts/identity-access/domain/totp";
import { encryptAdminSecret } from "../../../src/contexts/identity-access/domain/admin-secret-crypto";
import type { BettingEligibilityPort } from "../../../src/contexts/betting/application/betting-eligibility.port";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const manifestPath = typeof args.manifest === "string" ? args.manifest : null;
if (!manifestPath) {
  console.error("--manifest <path> is required (the harness reads its fixtures from there)");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function loadDotEnv(): void {
  const candidates = [".env", "../../../.env"];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    for (const line of readFileSync(candidate, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key!] !== undefined) continue;
      process.env[key!] = rawValue!.replace(/^["']|["']$/g, "");
    }
    return;
  }
}

loadDotEnv();
if (typeof args["database-url"] === "string") process.env.DATABASE_URL = args["database-url"];
process.env.APP_ENV = process.env.APP_ENV ?? "local";
// Seeded sessions must outlive the longest scenario run; the API only verifies
// signature + row state, so the seed process owns the token lifetime.
process.env.JWT_ACCESS_TTL_SECONDS = process.env.JWT_ACCESS_TTL_SECONDS ?? String(24 * 3600);
process.env.ADMIN_MFA_ENCRYPTION_KEY =
  process.env.ADMIN_MFA_ENCRYPTION_KEY ?? "load-harness-admin-mfa-key-0123456789";
resetEnvironmentForTests();

const databaseUrl = process.env.DATABASE_URL ?? "";
const databaseName = (() => {
  try {
    return new URL(databaseUrl).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();

if (/prod/i.test(databaseName) && args["allow-shared-db"] !== true) {
  console.error(
    `REFUSING: target database '${databaseName}' looks like a production database. Seeding writes Member, Ledger and Betting rows. Pass --allow-shared-db only if you are certain.`,
  );
  process.exit(2);
}
if (!/load/i.test(databaseName) && args["allow-shared-db"] !== true) {
  console.error(
    `REFUSING: target database '${databaseName}' is not a dedicated load database (expected a name containing 'load'). A shared development database would leave fixture rows behind and would make the run non-reproducible. Use --allow-shared-db to override deliberately.`,
  );
  process.exit(2);
}
console.log(`[seed] target database: ${databaseName} (${databaseUrl.replace(/:[^:@/]*@/, ":***@").split("@")[1] ?? "?"})`);

// ---------------------------------------------------------------------------
// Fixture volumes
// ---------------------------------------------------------------------------

const profile = typeof args.profile === "string" ? args.profile : "smoke";
const VOLUMES: Record<string, { members: number; settlementOrders: number }> = {
  smoke: { members: 20, settlementOrders: 200 },
  sandbox: { members: 200, settlementOrders: 2000 },
  target: { members: 5000, settlementOrders: 100000 },
};

const members = Number(args.members ?? VOLUMES[profile]?.members ?? 20);
const settlementOrders = Number(args["settlement-orders"] ?? VOLUMES[profile]?.settlementOrders ?? 0);
const prefix = typeof args.prefix === "string" ? args.prefix : `load-${profile}`;
const STARTING_CASH_MINOR = 5_000_000n; // 50,000 THB per Member: ample for a full run's stake volume
const STAKE_MINOR = 1000n;
const CANONICAL_NUMBER = "42";

const created = {
  members: [] as string[],
  sessions: [] as string[],
  termsDocuments: [] as string[],
  termsAcceptances: [] as string[],
  kycStatuses: [] as string[],
  verifications: [] as string[],
  products: [] as string[],
  betTypes: [] as string[],
  productsVersions: [] as string[],
  betTypeVersions: [] as string[],
  draws: [] as string[],
  quotes: [] as string[],
  orders: [] as string[],
  adminUsers: [] as string[],
  adminSessions: [] as string[],
};

const prisma = new PrismaService();

async function main(): Promise<void> {
  await prisma.$connect();

  if (args.cleanup === true) {
    await cleanup();
    return;
  }

  const ledger = new FinancialLedgerService(
    new PrismaFinancialLedgerRepository(prisma, new DatabaseAccountingPeriodTransactionClock()),
  );
  const draws = new LotteryDrawService(prisma);
  const quoteDrawAdapter = new BettingQuoteDrawAdapter(prisma);
  const allowEligibility: BettingEligibilityPort = {
    // Fixture seeding only: the HTTP load drivers go through the production
    // BettingEligibilityAdapter -> EligibilityService path, which the seeded
    // KYC/terms/profile rows satisfy. The in-process seeding calls below are
    // not a security boundary.
    async evaluate() {
      return { outcome: "ALLOW" as const, reasonCodes: [], policyVersion: "load-harness-seed" };
    },
  };
  const quotes = new BettingQuoteService(prisma, quoteDrawAdapter, allowEligibility);
  const orders = new BettingOrderService(
    prisma,
    quoteDrawAdapter,
    new BetOrderWalletAdapter(ledger, prisma),
    allowEligibility,
    new PrismaDrawAdmissionBoundary(prisma),
  );
  const sessionService = new SessionService(new PrismaSessionRepository(prisma), new JwtService());

  // Admin session for the Settlement commands (admin.role ADMIN carries
  // result.manage + settlement.manage).
  const adminToken = await createAdminSession();

  // Published terms document: Members must have accepted it to be BET-eligible
  // through the production eligibility path used by the HTTP load drivers.
  const termsDocumentId = randomUUID();
  await prisma.memberTermsDocument.create({
    data: {
      id: termsDocumentId,
      code: `MEMBER_TERMS_${prefix.slice(0, 24)}`,
      version: 1,
      revision: 1,
      state: "PUBLISHED",
      title: "Lottify load harness terms",
      body: "Load-harness fixture terms document.",
      contentDigest: "b".repeat(64),
      policyVersion: "member-terms-policy-v1",
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      effectiveUntil: null,
      publishedAt: new Date("2020-01-01T00:00:00.000Z"),
    },
  });
  created.termsDocuments.push(termsDocumentId);

  // Steady-state Draw used by the Quote/Confirm drivers.
  const steady = await openDraw(draws, `LH${profile}`.toUpperCase(), "2099-12-01");
  const betTypeCode = steady.betTypeCode;

  // ---- Members ------------------------------------------------------------
  const sessions: Array<{ memberId: string; sessionId: string; token: string }> = [];
  const started = Date.now();
  for (let index = 0; index < members; index += 1) {
    const memberId = randomUUID();
    await prisma.member.create({
      data: {
        id: memberId,
        phone: `+669${String(index).padStart(8, "0")}`,
        status: "ACTIVE",
      },
    });
    created.members.push(memberId);

    await prisma.member.update({
      where: { id: memberId },
      data: {
        fullName: "Load Harness Member",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        province: "กรุงเทพมหานคร",
        profileUpdatedAt: new Date(),
      },
    });

    const acceptanceId = randomUUID();
    await prisma.memberTermsAcceptance.create({
      data: {
        id: acceptanceId,
        memberId,
        documentId: termsDocumentId,
        documentCode: "MEMBER_TERMS",
        documentVersion: 1,
        contentDigest: "b".repeat(64),
        source: "MEMBER_SELF_SERVICE",
        acceptedAt: new Date(),
        evidence: {},
        correlationId: randomUUID(),
      },
    });
    created.termsAcceptances.push(acceptanceId);

    const kycId = randomUUID();
    await prisma.memberKycStatus.create({
      data: {
        id: kycId,
        memberId,
        outcome: "VERIFIED",
        policyVersion: "kyc-policy-v1",
        evidenceRefs: [],
        source: "load-harness",
        evaluatedAt: new Date(),
      },
    });
    created.kycStatuses.push(kycId);

    const verificationId = randomUUID();
    await prisma.memberVerificationRecord.create({
      data: {
        id: verificationId,
        memberId,
        type: "KYC",
        verifiedAt: new Date(),
        source: "load-harness",
        evidenceRefs: [],
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    });
    created.verifications.push(verificationId);

    await fundCash(ledger, memberId, STARTING_CASH_MINOR);

    const session = await sessionService.issue(memberId, `${prefix}-device`);
    created.sessions.push(session.sessionId);
    sessions.push({ memberId, sessionId: session.sessionId, token: session.accessToken });

    if ((index + 1) % 25 === 0) {
      console.log(`[seed] members ${index + 1}/${members} (${Math.round((Date.now() - started) / 1000)}s)`);
    }
  }

  // ---- Settlement dataset -------------------------------------------------
  let settlement: Record<string, unknown> | null = null;
  if (settlementOrders > 0) {
    const settlementDraw = await openDraw(draws, `LHS${profile}`.toUpperCase(), "2099-11-01");
    const orderIds: string[] = [];
    const memberTokens: string[] = [];
    const perMember = Math.max(1, Math.ceil(settlementOrders / Math.max(sessions.length, 1)));
    let createdCount = 0;
    const startedOrders = Date.now();
    for (const session of sessions) {
      if (createdCount >= settlementOrders) break;
      for (let index = 0; index < perMember && createdCount < settlementOrders; index += 1) {
        const quote = await quotes.createQuote({
          memberId: session.memberId,
          drawId: settlementDraw.drawId,
          currency: "THB",
          idempotencyKey: `lhq-${randomUUID()}`,
          lines: [
            {
              betTypeCode: settlementDraw.betTypeCode,
              canonicalNumber: CANONICAL_NUMBER,
              stakeMinor: STAKE_MINOR,
            },
          ],
        });
        created.quotes.push(quote.id);
        const order = await orders.createOrder({
          memberId: session.memberId,
          quoteId: quote.id,
          idempotencyKey: `lho-${randomUUID()}`,
        });
        created.orders.push(order.id);
        await orders.confirmOrder({
          memberId: session.memberId,
          orderId: order.id,
          expectedVersion: order.version,
          idempotencyKey: `lhc-${randomUUID()}`,
        });
        orderIds.push(order.id);
        createdCount += 1;
      }
      memberTokens.push(session.token);
      if (createdCount % 200 === 0 && createdCount > 0) {
        console.log(
          `[seed] settlement orders ${createdCount}/${settlementOrders} (${Math.round((Date.now() - startedOrders) / 1000)}s)`,
        );
      }
    }
    const confirmedCount = await prisma.betOrder.count({
      where: { id: { in: orderIds }, state: "CONFIRMED" },
    });
    const lineCount = await prisma.betOrderLine.count({ where: { orderId: { in: orderIds } } });
    console.log(
      `[seed] settlement dataset: ${orderIds.length} orders created, ${confirmedCount} CONFIRMED, ${lineCount} Bet Lines`,
    );
    settlement = {
      drawId: settlementDraw.drawId,
      productId: settlementDraw.productId,
      betTypeCode: settlementDraw.betTypeCode,
      resultSchemaVersionRef: "result-v1",
      adminToken,
      betLines: lineCount,
      betLineTarget: settlementOrders,
      memberTokens: memberTokens.slice(0, 10),
      memberOrderIds: orderIds.slice(0, 10),
      allOrderIds: orderIds,
      confirmedOrderCount: confirmedCount,
    };
  }

  const manifest = {
    manifestVersion: 1,
    scenarioId: "ticket13-capacity-v1",
    profile,
    prefix,
    createdAt: new Date().toISOString(),
    candidateSha: process.env.CANDIDATE_SHA ?? null,
    databaseUrl: databaseUrl.replace(/:[^:@/]*@/, ":***@"),
    redisUrl: process.env.REDIS_URL ? process.env.REDIS_URL.replace(/:[^:@/]*@/, ":***@") : null,
    sessionProvisioning:
      "Sessions are minted with the repository's own SessionService against this load database (test-scoped seeding). No production authentication bypass was added and no @Public route exists.",
    members: created.members.length,
    sessions,
    drawIds: [steady.drawId],
    steadyDraw: {
      drawId: steady.drawId,
      productId: steady.productId,
      betTypeCode: steady.betTypeCode,
      cutoffAt: steady.cutoffAt.toISOString(),
    },
    betTypeCode,
    settlement,
    cleanupIds: created,
  };

  writeFileSync(manifestPath!, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`[seed] manifest written: ${manifestPath}`);
  console.log(
    `[seed] NOTE: fixture writes use the real services; with --profile target the volumes (${members} Members, ${settlementOrders} confirmed Orders) require the approved production-like environment.`,
  );
}

async function createAdminSession(): Promise<string> {
  const id = randomUUID();
  const password = `Load harness admin ${randomUUID()}`;
  const secret = generateTotpSecret();
  const email = `${prefix}-admin-${id}@example.test`;
  await prisma.adminUser.create({
    data: {
      id,
      email,
      name: "Load Harness Admin",
      passwordHash: await hashAdminPassword(password),
      role: "ADMIN",
      status: "ACTIVE",
      mfaEnabled: true,
      mfaSecretEncrypted: encryptAdminSecret(secret, process.env.ADMIN_MFA_ENCRYPTION_KEY!),
    },
  });
  created.adminUsers.push(id);
  const adminAuth = new AdminAuthService(new PrismaAdminAuthRepository(prisma), new JwtService());
  const login = await adminAuth.login(email, password);
  if (login.status !== "MFA_REQUIRED") throw new Error("expected an MFA challenge for the seeded admin");
  const tokens = await adminAuth.verifyMfa(
    login.challengeToken,
    generateTotpCode(secret),
    "127.0.0.1",
    "lottify-load-harness",
  );
  const sessions = await prisma.adminAuthSession.findMany({ where: { adminUserId: id }, select: { id: true } });
  for (const session of sessions) created.adminSessions.push(session.id);
  return tokens.accessToken;
}

async function publishProduct(prefixTag: string): Promise<{
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
  created.products.push(productId);
  created.betTypes.push(betTypeId);
  created.productsVersions.push(productVersionId);
  created.betTypeVersions.push(betTypeVersionId);

  await prisma.lotteryProduct.create({ data: { id: productId } });
  await prisma.lotteryBetType.create({ data: { id: betTypeId, code: `${prefixTag}_${suffix.slice(0, 8)}` } });
  await prisma.lotteryBetTypeVersion.create({
    data: {
      id: betTypeVersionId,
      betTypeId,
      state: "PUBLISHED",
      canonicalNumberFormat: "00",
      validationPattern: "^[0-9]{2}$",
      defaultPayout: { kind: "FIXED", amountMinor: 9000 },
      minStakeMinor: 100n,
      maxStakeMinor: 1000000n,
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
  await prisma.lotteryProductVersionBetType.create({ data: { productVersionId, betTypeId, betTypeVersionId } });
  await prisma.lotteryProductVersion.update({ where: { id: productVersionId }, data: { state: "PUBLISHED" } });
  return { productId, productVersionId, betTypeId, betTypeVersionId };
}

async function openDraw(
  draws: LotteryDrawService,
  tag: string,
  day: string,
): Promise<{ drawId: string; productId: string; betTypeCode: string; cutoffAt: Date }> {
  const { productId } = await publishProduct(tag);
  const created_ = await draws.generateDraws({
    productId,
    baseOccurrences: [
      {
        occurrenceIdentity: `${productId}-${day}`,
        localDate: day,
        openAt: new Date(`${day}T06:00:00.000Z`),
        cutoffAt: new Date(`${day}T11:00:00.000Z`),
        drawAt: new Date(`${day}T12:00:00.000Z`),
        provenance: "SCHEDULE_GENERATED",
      },
    ],
    actor: { adminId: created.adminUsers[0]!, sessionId: "load-harness", role: "ADMIN" as const },
  });
  const drawId = created_.created[0]!.id;
  created.draws.push(drawId);
  await draws.transition({ id: drawId, command: "SCHEDULE", expectedVersion: 1, actor: actor() });
  await draws.transition({ id: drawId, command: "OPEN", expectedVersion: 2, actor: actor() });
  const draw = await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: drawId } });
  const drawBetType = await prisma.lotteryDrawBetType.findFirstOrThrow({ where: { drawId } });
  return { drawId, productId, betTypeCode: drawBetType.betTypeCode, cutoffAt: draw.cutoffAt };
}

function actor() {
  return { adminId: created.adminUsers[0]!, sessionId: "load-harness", role: "ADMIN" as const };
}

async function fundCash(ledger: FinancialLedgerService, memberId: string, amountMinor: bigint): Promise<void> {
  const cashAccountId = await ledger.ensureMemberAccount(memberId, "CASH", "THB");
  const counterpartyId = await ledger.ensureSystemAccount(`load-harness-funding:${prefix}`, "THB");
  const identity = randomUUID();
  await ledger.post({
    businessTransactionId: `load-harness-funding-${identity}`,
    operationType: "LOAD_HARNESS_FIXTURE_FUNDING",
    correlationId: randomUUID(),
    idempotency: {
      scope: `LOAD_HARNESS_FIXTURE_FUNDING:${identity}`,
      key: identity,
      fingerprint: identity,
    },
    domainReferences: {},
    currency: "THB",
    effectiveAt: new Date(),
    postings: [
      { accountId: cashAccountId, side: "CREDIT", amountMinor },
      { accountId: counterpartyId, side: "DEBIT", amountMinor },
    ],
  });
}

/**
 * Deletes exactly the rows this manifest created, by id. Never prefix-based:
 * a shared database holds other verticals' fixture rows with overlapping ids.
 */
async function cleanup(): Promise<void> {
  const manifest = JSON.parse(readFileSync(manifestPath!, "utf8"));
  const ids = manifest.cleanupIds ?? {};
  const list = (key: string): string[] => (Array.isArray(ids[key]) ? ids[key] : []);
  const orderIds = list("orders");
  const quoteIds = list("quotes");
  const memberIds = list("members");

  const orderLines = await prisma.betOrderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  // These tables are protected by immutability triggers in production; the
  // harness disables them only for its own fixture rows, exactly like the
  // integration suites do. Order: receipts -> lines -> orders.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('ALTER TABLE "bet_receipts" DISABLE TRIGGER "bet_receipts_immutable"');
    await tx.betReceipt.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.betOrderLine.deleteMany({ where: { id: { in: orderLines.map((line) => line.id) } } });
    await tx.betOrder.deleteMany({ where: { id: { in: orderIds } } });
    await tx.$executeRawUnsafe('ALTER TABLE "bet_receipts" ENABLE TRIGGER "bet_receipts_immutable"');
  });
  await prisma.bettingQuoteLine.deleteMany({ where: { quoteId: { in: quoteIds } } });
  await prisma.bettingQuote.deleteMany({ where: { id: { in: quoteIds } } });
  await prisma.authSession.deleteMany({ where: { id: { in: list("sessions") } } });
  await prisma.memberVerificationRecord.deleteMany({ where: { id: { in: list("verifications") } } });
  await prisma.memberKycStatus.deleteMany({ where: { id: { in: list("kycStatuses") } } });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('ALTER TABLE "member_terms_acceptances" DISABLE TRIGGER "member_terms_acceptances_immutable"');
    await tx.memberTermsAcceptance.deleteMany({ where: { id: { in: list("termsAcceptances") } } });
    await tx.$executeRawUnsafe('ALTER TABLE "member_terms_acceptances" ENABLE TRIGGER "member_terms_acceptances_immutable"');
  });
  await prisma.memberTermsDocument.deleteMany({ where: { id: { in: list("termsDocuments") } } });
  await prisma.lotteryDrawBetType.deleteMany({ where: { drawId: { in: list("draws") } } });
  await prisma.lotteryDraw.deleteMany({ where: { id: { in: list("draws") } } });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'ALTER TABLE "lottery_bet_type_versions" DISABLE TRIGGER "lottery_bet_type_versions_published_immutable"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "lottery_product_versions" DISABLE TRIGGER "lottery_product_versions_published_immutable"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "lottery_product_version_bet_types" DISABLE TRIGGER "lottery_product_version_links_immutable"',
    );
    await tx.lotteryProductVersionBetType.deleteMany({
      where: { productVersionId: { in: list("productsVersions") } },
    });
    await tx.lotteryProductVersion.deleteMany({ where: { id: { in: list("productsVersions") } } });
    await tx.lotteryBetTypeVersion.deleteMany({ where: { id: { in: list("betTypeVersions") } } });
    await tx.$executeRawUnsafe(
      'ALTER TABLE "lottery_bet_type_versions" ENABLE TRIGGER "lottery_bet_type_versions_published_immutable"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "lottery_product_versions" ENABLE TRIGGER "lottery_product_versions_published_immutable"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "lottery_product_version_bet_types" ENABLE TRIGGER "lottery_product_version_links_immutable"',
    );
  });
  await prisma.lotteryProduct.deleteMany({ where: { id: { in: list("products") } } });
  await prisma.lotteryBetType.deleteMany({ where: { id: { in: list("betTypes") } } });
  await prisma.member.deleteMany({ where: { id: { in: memberIds } } });
  await prisma.adminAuthSession.deleteMany({ where: { id: { in: list("adminSessions") } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: list("adminUsers") } } });

  const remainingOrders = await prisma.betOrder.count({ where: { id: { in: orderIds } } });
  const remainingMembers = await prisma.member.count({ where: { id: { in: memberIds } } });
  console.log(
    `[seed] cleanup done. remaining fixture orders=${remainingOrders} members=${remainingMembers} (both must be 0)`,
  );
  if (remainingOrders !== 0 || remainingMembers !== 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[seed] FAILED:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
