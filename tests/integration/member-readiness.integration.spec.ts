import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AdminMemberCapabilityRestrictionController } from "../../apps/api/src/admin-member-capability-restriction.controller";
import { MemberReadinessController } from "../../apps/api/src/member-readiness.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { AdminCapabilityGuard } from "../../apps/api/src/admin-capability.guard";
import { MemberAuthGuard } from "../../apps/api/src/member-auth.guard";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import type { AdminRole } from "../../src/contexts/identity-access/domain/admin-auth.repository";
import { hashAdminPassword } from "../../src/contexts/identity-access/domain/admin-password";
import { encryptAdminSecret } from "../../src/contexts/identity-access/domain/admin-secret-crypto";
import { generateTotpCode, generateTotpSecret } from "../../src/contexts/identity-access/domain/totp";
import { PrismaAdminAuthRepository } from "../../src/contexts/identity-access/infrastructure/prisma-admin-auth.repository";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";
import { CapabilityRestrictionAdminService } from "../../src/contexts/member/application/capability-restriction-admin.service";
import { ProfileService } from "../../src/contexts/member/application/profile.service";
import { TermsService } from "../../src/contexts/member/application/terms.service";
import { EligibilityService } from "../../src/contexts/kyc-risk/application/eligibility.service";
import { CapabilityRestrictionAdapter } from "../../src/platform/integration/capability-restriction.adapter";
import { MemberReadinessFactsAdapter } from "../../src/platform/integration/member-readiness-facts.adapter";
import { getAdminMfaEncryptionKey, resetEnvironmentForTests } from "../../src/platform/config/env";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const emailPrefix = "member-readiness-integration+";
const phonePrefix = "095";

/**
 * Member capability readiness + KYC eligibility over the real HTTP boundary and
 * a real Postgres, per Ticket 16 (deterministic evidence) and Ticket 06:
 *   - allow, deny and review-required paths,
 *   - deny-first precedence (a hard restriction cannot be overridden),
 *   - verification expiry is never treated as valid,
 *   - missing explicit requirements (terms, profile, KYC) block the capability,
 *   - readiness is per-capability with coded reasons and no fabricated ALLOW,
 *   - Admin set/clear of a restriction is idempotent, audited and
 *     self-exclusion-protected.
 */
describe.runIf(runIntegration)("Member readiness + KYC eligibility vertical", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAuth: AdminAuthService;
  let baseUrl: string;

  const adminIds: string[] = [];
  const memberIds: string[] = [];
  const documentIds: string[] = [];
  const restrictionIds: string[] = [];

  const members: Record<string, string> = {};

  let termsDocumentId = "";

  const tokenToMember: Record<string, string> = {};

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    adminAuth = new AdminAuthService(new PrismaAdminAuthRepository(prisma), new JwtService());

    const terms = new TermsService(prisma);
    const profiles = new ProfileService(prisma);
    const restrictionAdmin = new CapabilityRestrictionAdminService(prisma);
    const eligibility = new EligibilityService(
      prisma,
      new CapabilityRestrictionAdapter(prisma),
      new MemberReadinessFactsAdapter(terms, profiles),
    );

    const sessions = {
      async authenticateAccess(token: string) {
        const memberId = tokenToMember[token];
        if (!memberId) throw new Error("unknown token");
        return { memberId, sessionId: "integration-session", deviceId: null };
      },
    };

    @Module({
      controllers: [MemberReadinessController, AdminMemberCapabilityRestrictionController],
      providers: [
        Reflector,
        MemberAuthGuard,
        AdminAuthGuard,
        AdminCapabilityGuard,
        { provide: SessionService, useValue: sessions },
        { provide: AdminAuthService, useValue: adminAuth },
        { provide: EligibilityService, useValue: eligibility },
        { provide: CapabilityRestrictionAdminService, useValue: restrictionAdmin },
      ],
    })
    class ReadinessApiModule {}

    app = await NestFactory.create(ReadinessApiModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();

    termsDocumentId = await seedPublishedTerms();

    // allGood: every explicit requirement satisfied and KYC verified + fresh.
    members.allGood = await createMember();
    await seedAcceptance(members.allGood, termsDocumentId);
    await completeProfile(members.allGood);
    await seedKycVerified(members.allGood);

    // noKyc: terms + profile satisfied but no KYC at all.
    members.noKyc = await createMember();
    await seedAcceptance(members.noKyc, termsDocumentId);
    await completeProfile(members.noKyc);

    // kycReview: KYC outcome under review.
    members.kycReview = await createMember();
    await seedAcceptance(members.kycReview, termsDocumentId);
    await completeProfile(members.kycReview);
    await seedKycStatus(members.kycReview, "REVIEW_REQUIRED");

    // expiredKyc: KYC was VERIFIED but the verification has expired.
    members.expiredKyc = await createMember();
    await seedAcceptance(members.expiredKyc, termsDocumentId);
    await completeProfile(members.expiredKyc);
    await seedKycStatus(members.expiredKyc, "VERIFIED");
    await seedKycVerification(members.expiredKyc, new Date("2026-06-01T00:00:00.000Z"));

    // noTerms: profile + KYC satisfied but the required Terms are not accepted.
    members.noTerms = await createMember();
    await completeProfile(members.noTerms);
    await seedKycVerified(members.noTerms);

    // noProfile: terms + KYC satisfied but the mandatory profile is incomplete.
    members.noProfile = await createMember();
    await seedAcceptance(members.noProfile, termsDocumentId);
    await seedKycVerified(members.noProfile);

    for (const [key, id] of Object.entries(members)) {
      tokenToMember[key] = id;
    }
  });

  afterAll(async () => {
    try {
      const allMemberIds = Object.values(members);
      const allRestrictionIds = [...restrictionIds];
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'ALTER TABLE "audit_records" DISABLE TRIGGER "audit_records_immutable"',
        );
        await tx.auditRecord.deleteMany({
          where: { OR: [{ resourceId: { in: allRestrictionIds } }, { resourceId: { in: allMemberIds } }] },
        });
        await tx.$executeRawUnsafe(
          'ALTER TABLE "audit_records" ENABLE TRIGGER "audit_records_immutable"',
        );
      });
      await prisma.memberVerificationRecord.deleteMany({ where: { memberId: { in: allMemberIds } } });
      await prisma.memberKycStatus.deleteMany({ where: { memberId: { in: allMemberIds } } });
      await prisma.capabilityRestriction.deleteMany({ where: { memberId: { in: allMemberIds } } });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'ALTER TABLE "member_terms_acceptances" DISABLE TRIGGER "member_terms_acceptances_immutable"',
        );
        await tx.memberTermsAcceptance.deleteMany({ where: { memberId: { in: allMemberIds } } });
        await tx.$executeRawUnsafe(
          'ALTER TABLE "member_terms_acceptances" ENABLE TRIGGER "member_terms_acceptances_immutable"',
        );
      });
      await prisma.memberTermsDocument.deleteMany({ where: { id: { in: documentIds } } });
      await prisma.idempotencyRecord.deleteMany({
        where: {
          OR: adminIds.map((id) => ({ scope: { startsWith: `admin:${id}:member-capability-restriction:` } })),
        },
      });
      await prisma.adminReauthEvidence.deleteMany({ where: { adminUserId: { in: adminIds } } });
      await prisma.adminAuthSession.deleteMany({ where: { adminUserId: { in: adminIds } } });
      await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
      await prisma.member.deleteMany({ where: { id: { in: allMemberIds } } });
    } finally {
      try {
        await app?.close();
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  async function createMember(): Promise<string> {
    const phone = `${phonePrefix}${randomUUID().replace(/\D/g, "").slice(0, 7)}`;
    const member = await prisma.member.create({ data: { phone, status: "ACTIVE" } });
    memberIds.push(member.id);
    return member.id;
  }

  async function completeProfile(memberId: string): Promise<void> {
    await prisma.member.update({
      where: { id: memberId },
      data: {
        fullName: "คุณ สมาชิก",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        province: "กรุงเทพมหานคร",
        profileUpdatedAt: new Date(),
      },
    });
  }

  async function seedPublishedTerms(): Promise<string> {
    const digest = "a".repeat(64);
    const doc = await prisma.memberTermsDocument.create({
      data: {
        id: randomUUID(),
        code: "MEMBER_TERMS",
        version: 1,
        revision: 1,
        state: "PUBLISHED",
        title: "ข้อตกลงการใช้งาน Lottify",
        body: "การยอมรับข้อตกลงสำหรับการทดสอบ readiness",
        contentDigest: digest,
        policyVersion: "member-terms-policy-v1",
        effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
        effectiveUntil: null,
        publishedAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    documentIds.push(doc.id);
    return doc.id;
  }

  async function seedAcceptance(memberId: string, documentId: string): Promise<void> {
    await prisma.memberTermsAcceptance.create({
      data: {
        id: randomUUID(),
        memberId,
        documentId,
        documentCode: "MEMBER_TERMS",
        documentVersion: 1,
        contentDigest: "a".repeat(64),
        source: "MEMBER_SELF_SERVICE",
        acceptedAt: new Date(),
        evidence: {},
        correlationId: randomUUID(),
      },
    });
  }

  async function seedKycVerified(memberId: string): Promise<void> {
    await seedKycStatus(memberId, "VERIFIED");
    await seedKycVerification(memberId, new Date("2099-01-01T00:00:00.000Z"));
  }

  async function seedKycStatus(memberId: string, outcome: string): Promise<void> {
    await prisma.memberKycStatus.create({
      data: {
        id: randomUUID(),
        memberId,
        outcome,
        policyVersion: "kyc-policy-v1",
        evidenceRefs: [],
        source: "provider",
        evaluatedAt: new Date(),
      },
    });
  }

  async function seedKycVerification(memberId: string, expiresAt: Date): Promise<void> {
    await prisma.memberVerificationRecord.create({
      data: {
        id: randomUUID(),
        memberId,
        type: "KYC",
        verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
        source: "provider",
        evidenceRefs: [],
        expiresAt,
      },
    });
  }

  async function seedRestriction(memberId: string, type: string, source: string): Promise<string> {
    const row = await prisma.capabilityRestriction.create({
      data: {
        id: randomUUID(),
        memberId,
        type,
        source,
        reason: "integration fixture",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveUntil: null,
        actorOrPolicyRef: "admin:integration",
      },
    });
    restrictionIds.push(row.id);
    return row.id;
  }

  async function createAdminSession(role: AdminRole): Promise<{ id: string; accessToken: string }> {
    const id = randomUUID();
    const password = "Member readiness integration password 123!";
    const secret = generateTotpSecret();
    const email = `${emailPrefix}${role.toLowerCase()}-${id}@example.com`;
    await prisma.adminUser.create({
      data: {
        id,
        email,
        name: `Member Readiness ${role}`,
        passwordHash: await hashAdminPassword(password),
        role,
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
      "member-readiness-integration",
    );
    return { id, accessToken: tokens.accessToken };
  }

  const memberHeaders = (token: string) => ({
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  });

  const adminHeaders = (accessToken: string, key?: string) => ({
    Authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    ...(key ? { "Idempotency-Key": key } : {}),
  });

  async function readinessFor(token: string) {
    const response = await fetch(`${baseUrl}/api/v1/member/readiness`, { headers: memberHeaders(token) });
    expect(response.status).toBe(200);
    return response.json();
  }

  it("refuses unauthenticated access to readiness", async () => {
    const response = await fetch(`${baseUrl}/api/v1/member/readiness`);
    expect(response.status).toBe(401);
  });

  it("allows a fully-ready Member across every capability", async () => {
    const body = await readinessFor("allGood");
    expect(body.memberId).toBe(members.allGood);
    expect(body.policyVersion).toBe("capability-readiness-policy-v1");
    for (const capability of ["BET", "WITHDRAWAL", "DEPOSIT", "PROMOTION"]) {
      const decision = body.capabilities.find((c: { capability: string }) => c.capability === capability);
      expect(decision.outcome, capability).toBe("ALLOW");
      expect(decision.reasonCodes).toEqual([]);
      expect(decision.validUntil).toBeDefined();
    }
    expect(body.requirements.termsSatisfied).toBe(true);
    expect(body.requirements.profileComplete).toBe(true);
    expect(body.requirements.kyc.verified).toBe(true);
    expect(body.requirements.outstandingRequirements).toEqual([]);
  });

  it("denies KYC-requiring capabilities when no KYC exists but allows deposit", async () => {
    const body = await readinessFor("noKyc");
    const bet = body.capabilities.find((c: { capability: string }) => c.capability === "BET");
    const withdrawal = body.capabilities.find((c: { capability: string }) => c.capability === "WITHDRAWAL");
    const deposit = body.capabilities.find((c: { capability: string }) => c.capability === "DEPOSIT");
    expect(bet.outcome).toBe("DENY");
    expect(bet.reasonCodes).toContain("KYC_REQUIRED");
    expect(withdrawal.outcome).toBe("DENY");
    expect(deposit.outcome).toBe("ALLOW");
    expect(body.requirements.kyc.verified).toBe(false);
    expect(body.requirements.outstandingRequirements).toContain("KYC_REQUIRED");
  });

  it("reports review-required when KYC is under review", async () => {
    const body = await readinessFor("kycReview");
    const bet = body.capabilities.find((c: { capability: string }) => c.capability === "BET");
    expect(bet.outcome).toBe("REVIEW_REQUIRED");
    expect(bet.reasonCodes).toContain("KYC_REVIEW_REQUIRED");
    expect(body.requirements.kyc.status).toBe("REVIEW_REQUIRED");
  });

  it("does not treat an expired KYC verification as valid", async () => {
    const body = await readinessFor("expiredKyc");
    const bet = body.capabilities.find((c: { capability: string }) => c.capability === "BET");
    expect(bet.outcome).toBe("DENY");
    expect(bet.reasonCodes).toContain("KYC_EXPIRED");
    expect(body.requirements.kyc.expired).toBe(true);
    expect(body.requirements.outstandingRequirements).toContain("KYC_EXPIRED");
  });

  it("blocks a capability when the required Terms are not accepted", async () => {
    const body = await readinessFor("noTerms");
    const bet = body.capabilities.find((c: { capability: string }) => c.capability === "BET");
    expect(bet.outcome).toBe("DENY");
    expect(bet.reasonCodes).toContain("TERMS_NOT_ACCEPTED");
    expect(body.requirements.termsSatisfied).toBe(false);
  });

  it("blocks a capability when the mandatory profile is incomplete", async () => {
    const body = await readinessFor("noProfile");
    const bet = body.capabilities.find((c: { capability: string }) => c.capability === "BET");
    expect(bet.outcome).toBe("DENY");
    expect(bet.reasonCodes).toContain("PROFILE_INCOMPLETE");
    expect(body.requirements.profileComplete).toBe(false);
    expect(body.requirements.missingProfileFields).toEqual(["fullName", "dateOfBirth", "province"]);
  });

  it("applies a hard capability restriction that a lower layer cannot override", async () => {
    await seedRestriction(members.allGood!, "BET_BLOCKED", "admin");
    const body = await readinessFor("allGood");
    const bet = body.capabilities.find((c: { capability: string }) => c.capability === "BET");
    expect(bet.outcome).toBe("DENY");
    expect(bet.reasonCodes).toContain("CAPABILITY_BLOCKED");
    // Deny-first: the same Member is still allowed a non-restricted capability.
    const deposit = body.capabilities.find((c: { capability: string }) => c.capability === "DEPOSIT");
    expect(deposit.outcome).toBe("ALLOW");
  });

  it("requires an Idempotency-Key and replays an Admin restriction set exactly once", async () => {
    const admin = await createAdminSession("ADMIN");
    const target = members.allGood;
    const payload = {
      memberId: target,
      capability: "PROMOTION",
      reason: "promotion paused for integration",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    };

    const missingKey = await fetch(`${baseUrl}/api/v1/admin/member-capability-restrictions`, {
      method: "POST",
      headers: adminHeaders(admin.accessToken),
      body: JSON.stringify(payload),
    });
    expect(missingKey.status).toBe(400);
    expect((await missingKey.json()).code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const key = randomUUID();
    const first = await fetch(`${baseUrl}/api/v1/admin/member-capability-restrictions`, {
      method: "POST",
      headers: adminHeaders(admin.accessToken, key),
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const created = await first.json();
    expect(created.type).toBe("PROMOTION_BLOCKED");
    expect(created.source).toBe("admin");
    restrictionIds.push(created.id);

    const replay = await fetch(`${baseUrl}/api/v1/admin/member-capability-restrictions`, {
      method: "POST",
      headers: adminHeaders(admin.accessToken, key),
      body: JSON.stringify(payload),
    });
    expect(replay.status).toBe(201);
    expect((await replay.json()).id).toBe(created.id);

    const conflicting = await fetch(`${baseUrl}/api/v1/admin/member-capability-restrictions`, {
      method: "POST",
      headers: adminHeaders(admin.accessToken, key),
      body: JSON.stringify({ ...payload, reason: "different reason" }),
    });
    expect(conflicting.status).toBe(409);
    expect((await conflicting.json()).code).toBe("IDEMPOTENCY_CONFLICT");

    // The Admin-set restriction is reflected in readiness.
    const body = await readinessFor("allGood");
    const promotion = body.capabilities.find((c: { capability: string }) => c.capability === "PROMOTION");
    expect(promotion.outcome).toBe("DENY");
    expect(promotion.reasonCodes).toContain("CAPABILITY_BLOCKED");
  });

  it("clears a restriction through the Admin surface and audits both mutations", async () => {
    const admin = await createAdminSession("ADMIN");
    const clear = await fetch(
      `${baseUrl}/api/v1/admin/member-capability-restrictions/${restrictionIds[restrictionIds.length - 1]}`,
      {
        method: "DELETE",
        headers: adminHeaders(admin.accessToken, randomUUID()),
      },
    );
    expect(clear.status).toBe(200);
    const cleared = await clear.json();
    expect(cleared.removed).toBe(true);

    const body = await readinessFor("allGood");
    const promotion = body.capabilities.find((c: { capability: string }) => c.capability === "PROMOTION");
    expect(promotion.outcome).toBe("ALLOW");

    const audit = await prisma.auditRecord.findMany({
      where: { resourceType: "MEMBER_CAPABILITY_RESTRICTION", resourceId: { in: restrictionIds } },
    });
    expect(audit.some((row) => row.action === "MEMBER_CAPABILITY_RESTRICTION_SET")).toBe(true);
    expect(audit.some((row) => row.action === "MEMBER_CAPABILITY_RESTRICTION_CLEAR")).toBe(true);
  });

  it("refuses to clear a self-exclusion restriction through the normal Admin path", async () => {
    const admin = await createAdminSession("ADMIN");
    const selfExclusionId = await seedRestriction(members.noKyc!, "BET_BLOCKED", "self-exclusion");
    const denied = await fetch(
      `${baseUrl}/api/v1/admin/member-capability-restrictions/${selfExclusionId}`,
      {
        method: "DELETE",
        headers: adminHeaders(admin.accessToken, randomUUID()),
      },
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("SELF_EXCLUSION_NOT_REMOVABLE");
  });

  it("keeps the Admin restriction surface behind the Admin capability", async () => {
    const auditor = await createAdminSession("AUDITOR");
    const denied = await fetch(`${baseUrl}/api/v1/admin/member-capability-restrictions`, {
      method: "POST",
      headers: adminHeaders(auditor.accessToken, randomUUID()),
      body: JSON.stringify({
        memberId: members.allGood,
        capability: "BET",
        reason: "should be denied",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
      }),
    });
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("ACCESS_DENIED");
  });
});
