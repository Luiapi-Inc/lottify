import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AdminMemberTermsController } from "../../apps/api/src/admin-member-terms.controller";
import { MemberProfileController } from "../../apps/api/src/member-profile.controller";
import { MemberTermsController } from "../../apps/api/src/member-terms.controller";
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
import { ProfileService } from "../../src/contexts/member/application/profile.service";
import { TermsService } from "../../src/contexts/member/application/terms.service";
import { MEMBER_TERMS_PUBLISH_ACTION_CLASS } from "../../src/contexts/member/domain/terms-document";
import { getAdminMfaEncryptionKey, resetEnvironmentForTests } from "../../src/platform/config/env";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const emailPrefix = "member-terms-integration+";
const phonePrefix = "094";

/**
 * Member Terms acceptance + Member profile over the real HTTP boundary and a
 * real Postgres, per Ticket 16 (deterministic evidence) and Ticket 06:
 *   - a required Terms version can be published and is exposed to the Member,
 *   - acceptance is persisted once per Member + version, idempotent, immutable,
 *   - a version that is not currently required is denied,
 *   - the profile reports and completes only the mandatory fields, and never
 *     accepts a client-asserted trusted fact.
 */
describe.runIf(runIntegration)("Member Terms acceptance + profile vertical", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAuth: AdminAuthService;
  let baseUrl: string;

  let activeMemberId: string;
  let inactiveMemberId: string;

  const adminIds: string[] = [];
  const documentIds: string[] = [];
  const mfaSecrets = new Map<string, string>();

  beforeAll(async () => {
    resetEnvironmentForTests();
    prisma = new PrismaService();
    await prisma.$connect();
    adminAuth = new AdminAuthService(new PrismaAdminAuthRepository(prisma), new JwtService());

    const terms = new TermsService(prisma);
    const profiles = new ProfileService(prisma);

    const sessions = {
      async authenticateAccess(token: string) {
        const memberId = token === "inactive" ? inactiveMemberId : activeMemberId;
        return { memberId, sessionId: "integration-session", deviceId: null };
      },
    };

    @Module({
      controllers: [MemberTermsController, MemberProfileController, AdminMemberTermsController],
      providers: [
        Reflector,
        MemberAuthGuard,
        AdminAuthGuard,
        AdminCapabilityGuard,
        { provide: SessionService, useValue: sessions },
        { provide: AdminAuthService, useValue: adminAuth },
        { provide: TermsService, useValue: terms },
        { provide: ProfileService, useValue: profiles },
      ],
    })
    class MemberOnboardingApiModule {}

    app = await NestFactory.create(MemberOnboardingApiModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();

    activeMemberId = await createMember("ACTIVE");
    inactiveMemberId = await createMember("DISABLED");
  });

  afterAll(async () => {
    try {
      const memberIds = [activeMemberId, inactiveMemberId];
      // Acceptance evidence is immutable by trigger; the only path that removes
      // it is test cleanup, which disables the guard explicitly.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'ALTER TABLE "member_terms_acceptances" DISABLE TRIGGER "member_terms_acceptances_immutable"',
        );
        await tx.memberTermsAcceptance.deleteMany({ where: { memberId: { in: memberIds } } });
        await tx.$executeRawUnsafe(
          'ALTER TABLE "member_terms_acceptances" ENABLE TRIGGER "member_terms_acceptances_immutable"',
        );
      });
      await prisma.memberTermsDocument.deleteMany({ where: { id: { in: documentIds } } });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'ALTER TABLE "audit_records" DISABLE TRIGGER "audit_records_immutable"',
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE "admin_approval_evidence" DISABLE TRIGGER "admin_approval_evidence_immutable"',
        );
        await tx.auditRecord.deleteMany({ where: { resourceId: { in: documentIds } } });
        await tx.adminApprovalEvidence.deleteMany({ where: { resourceId: { in: documentIds } } });
        await tx.$executeRawUnsafe(
          'ALTER TABLE "admin_approval_evidence" ENABLE TRIGGER "admin_approval_evidence_immutable"',
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE "audit_records" ENABLE TRIGGER "audit_records_immutable"',
        );
      });
      await prisma.idempotencyRecord.deleteMany({
        where: {
          OR: [
            ...adminIds.map((id) => ({ scope: { startsWith: `admin:${id}:member-terms:` } })),
            { scope: { in: memberIds.map((id) => `MEMBER_TERMS_ACCEPT:${id}`) } },
          ],
        },
      });
      await prisma.adminReauthEvidence.deleteMany({ where: { adminUserId: { in: adminIds } } });
      await prisma.adminAuthSession.deleteMany({ where: { adminUserId: { in: adminIds } } });
      await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
      await prisma.member.deleteMany({ where: { id: { in: memberIds } } });
    } finally {
      try {
        await app?.close();
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  async function createMember(status: string): Promise<string> {
    const phone = `${phonePrefix}${randomUUID().replace(/\D/g, "").slice(0, 7)}`;
    const member = await prisma.member.create({ data: { phone, status } });
    return member.id;
  }

  async function createAdminSession(role: AdminRole): Promise<{ id: string; accessToken: string }> {
    const id = randomUUID();
    const password = "Member terms integration password 123!";
    const secret = generateTotpSecret();
    const email = `${emailPrefix}${role.toLowerCase()}-${id}@example.com`;
    await prisma.adminUser.create({
      data: {
        id,
        email,
        name: `Member Terms ${role}`,
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
      "member-terms-integration",
    );
    mfaSecrets.set(tokens.accessToken, secret);
    return { id, accessToken: tokens.accessToken };
  }

  async function reauthPublish(accessToken: string): Promise<void> {
    const context = await adminAuth.authenticateAccess(accessToken);
    await adminAuth.reauthenticate(
      context,
      MEMBER_TERMS_PUBLISH_ACTION_CLASS,
      generateTotpCode(mfaSecrets.get(accessToken)!),
    );
  }

  const adminHeaders = (accessToken: string, key?: string) => ({
    Authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    ...(key ? { "Idempotency-Key": key } : {}),
  });

  const memberHeaders = (token = "active", key?: string) => ({
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
    ...(key ? { "Idempotency-Key": key } : {}),
  });

  const versionPayload = (version: number, overrides: Record<string, unknown> = {}) => ({
    code: "MEMBER_TERMS",
    version,
    title: `ข้อตกลงการใช้งาน v${version}`,
    body: `การยอมรับข้อตกลงฉบับที่ ${version}`,
    policyVersion: "member-terms-policy-v1",
    effectiveFrom: "2020-01-01T00:00:00.000Z",
    reason: "integration fixture",
    ...overrides,
  });

  let author: { id: string; accessToken: string };
  let approver: { id: string; accessToken: string };
  let versionOneId = "";
  let versionTwoId = "";
  let publishedDocumentId = "";

  it("refuses unauthenticated Member access to Terms and profile", async () => {
    const terms = await fetch(`${baseUrl}/api/v1/member/terms`);
    expect(terms.status).toBe(401);
    const profile = await fetch(`${baseUrl}/api/v1/member/profile`);
    expect(profile.status).toBe(401);
  });

  it("requires an Idempotency-Key and replays an Admin Terms command exactly once", async () => {
    author = await createAdminSession("ADMIN");
    const payload = versionPayload(1);

    const missingKey = await fetch(`${baseUrl}/api/v1/admin/member-terms`, {
      method: "POST",
      headers: adminHeaders(author.accessToken),
      body: JSON.stringify(payload),
    });
    expect(missingKey.status).toBe(400);
    expect((await missingKey.json()).code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const key = randomUUID();
    const first = await fetch(`${baseUrl}/api/v1/admin/member-terms`, {
      method: "POST",
      headers: adminHeaders(author.accessToken, key),
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const created = await first.json();
    expect(created.state).toBe("DRAFT");
    expect(created.revision).toBe(1);
    expect(created.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    versionOneId = created.id;
    documentIds.push(created.id);

    const replay = await fetch(`${baseUrl}/api/v1/admin/member-terms`, {
      method: "POST",
      headers: adminHeaders(author.accessToken, key),
      body: JSON.stringify(payload),
    });
    expect(replay.status).toBe(201);
    expect((await replay.json()).id).toBe(versionOneId);

    const conflicting = await fetch(`${baseUrl}/api/v1/admin/member-terms`, {
      method: "POST",
      headers: adminHeaders(author.accessToken, key),
      body: JSON.stringify(versionPayload(99)),
    });
    expect(conflicting.status).toBe(409);
    expect((await conflicting.json()).code).toBe("IDEMPOTENCY_CONFLICT");

    // A code+version can never be reused.
    const duplicate = await fetch(`${baseUrl}/api/v1/admin/member-terms`, {
      method: "POST",
      headers: adminHeaders(author.accessToken, randomUUID()),
      body: JSON.stringify(payload),
    });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).code).toBe("STATE_CONFLICT");
  });

  it("denies publication without fresh MFA and by the version's own author", async () => {
    const withoutMfa = await fetch(`${baseUrl}/api/v1/admin/member-terms/${versionOneId}/publish`, {
      method: "POST",
      headers: adminHeaders(author.accessToken, randomUUID()),
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    expect(withoutMfa.status).toBe(403);

    await reauthPublish(author.accessToken);
    const selfApproval = await fetch(
      `${baseUrl}/api/v1/admin/member-terms/${versionOneId}/publish`,
      {
        method: "POST",
        headers: adminHeaders(author.accessToken, randomUUID()),
        body: JSON.stringify({ expectedRevision: 1 }),
      },
    );
    expect(selfApproval.status).toBe(403);
    expect((await selfApproval.json()).code).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("publishes a required Terms version through a different Admin and denies an overlapping window", async () => {
    approver = await createAdminSession("ADMIN");
    // A second version so the overlap rule can be exercised against the live one.
    const createdSecond = await fetch(`${baseUrl}/api/v1/admin/member-terms`, {
      method: "POST",
      headers: adminHeaders(approver.accessToken, randomUUID()),
      body: JSON.stringify(versionPayload(2)),
    });
    expect(createdSecond.status).toBe(201);
    versionTwoId = (await createdSecond.json()).id;
    documentIds.push(versionTwoId);

    // Maker-checker: the approver (not the author of version 1) publishes it.
    await reauthPublish(approver.accessToken);
    const published = await fetch(`${baseUrl}/api/v1/admin/member-terms/${versionOneId}/publish`, {
      method: "POST",
      headers: adminHeaders(approver.accessToken, randomUUID()),
      body: JSON.stringify({ expectedRevision: 1, reason: "publish integration fixture" }),
    });
    expect(published.status).toBe(200);
    const body = await published.json();
    expect(body.state).toBe("PUBLISHED");
    expect(body.revision).toBe(2);
    expect(body.publishedAt).not.toBeNull();
    expect(body.approvalEvidenceRef).not.toBeNull();
    publishedDocumentId = body.id;

    // The author of version 2 may now approve it, but its window overlaps the
    // live version and must be refused rather than shadowing required Terms.
    const overlap = await fetch(`${baseUrl}/api/v1/admin/member-terms/${versionTwoId}/publish`, {
      method: "POST",
      headers: adminHeaders(author.accessToken, randomUUID()),
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    expect(overlap.status).toBe(409);
    expect((await overlap.json()).code).toBe("OVERLAPPING_PUBLISHED_VERSION");
  });

  it("exposes the required Terms version to the Member without fabricating acceptance", async () => {
    const response = await fetch(`${baseUrl}/api/v1/member/terms`, {
      headers: memberHeaders(),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.memberId).toBe(activeMemberId);
    const required = body.required.find(
      (entry: { documentId: string }) => entry.documentId === publishedDocumentId,
    );
    expect(required).toBeDefined();
    expect(required.code).toBe("MEMBER_TERMS");
    expect(required.version).toBe(1);
    expect(required.body).toContain("การยอมรับข้อตกลงฉบับที่ 1");
    expect(required.accepted).toBe(false);
    expect(required.acceptedAt).toBeNull();
    expect(required.acceptanceId).toBeNull();
    expect(body.acceptances).toEqual([]);
    expect(body.satisfied).toBe(false);
  });

  it("records acceptance once per Member + version with immutable evidence", async () => {
    const key = randomUUID();
    const accepted = await fetch(`${baseUrl}/api/v1/member/terms/accept`, {
      method: "POST",
      headers: memberHeaders("active", key),
      body: JSON.stringify({ documentId: publishedDocumentId }),
    });
    expect(accepted.status).toBe(200);
    const body = await accepted.json();
    expect(body.alreadyAccepted).toBe(false);
    expect(body.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(body.source).toBe("MEMBER_SELF_SERVICE");
    const acceptanceId = body.acceptanceId;

    // Same Idempotency-Key + same payload replays the durable prior result.
    const replay = await fetch(`${baseUrl}/api/v1/member/terms/accept`, {
      method: "POST",
      headers: memberHeaders("active", key),
      body: JSON.stringify({ documentId: publishedDocumentId }),
    });
    expect(replay.status).toBe(200);
    const replayed = await replay.json();
    expect(replayed.acceptanceId).toBe(acceptanceId);
    expect(replayed.alreadyAccepted).toBe(false);

    // A fresh key for an already-accepted version returns the existing evidence.
    const again = await fetch(`${baseUrl}/api/v1/member/terms/accept`, {
      method: "POST",
      headers: memberHeaders("active", randomUUID()),
      body: JSON.stringify({ documentId: publishedDocumentId }),
    });
    expect(again.status).toBe(200);
    const repeated = await again.json();
    expect(repeated.acceptanceId).toBe(acceptanceId);
    expect(repeated.alreadyAccepted).toBe(true);

    const rows = await prisma.memberTermsAcceptance.findMany({
      where: { memberId: activeMemberId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.documentVersion).toBe(1);
    expect(Object.keys(rows[0]!.evidence as Record<string, unknown>).sort()).toEqual([
      "ipAddress",
      "userAgent",
    ]);

    // Acceptance evidence is immutable at the database level, not only by
    // convention: no code path may rewrite or remove what the Member accepted.
    await expect(
      prisma.memberTermsAcceptance.update({
        where: { id: acceptanceId },
        data: { source: "REWRITTEN" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.memberTermsAcceptance.delete({ where: { id: acceptanceId } }),
    ).rejects.toThrow();
    const unchanged = await prisma.memberTermsAcceptance.findUniqueOrThrow({
      where: { id: acceptanceId },
    });
    expect(unchanged.source).toBe("MEMBER_SELF_SERVICE");
  });

  it("reports the Member's acceptance as satisfied and reproducible", async () => {
    const response = await fetch(`${baseUrl}/api/v1/member/terms`, {
      headers: memberHeaders(),
    });
    const body = await response.json();
    const required = body.required.find(
      (entry: { documentId: string }) => entry.documentId === publishedDocumentId,
    );
    expect(required.accepted).toBe(true);
    expect(required.acceptedAt).not.toBeNull();
    expect(body.satisfied).toBe(true);
    expect(body.acceptances).toHaveLength(1);
    expect(body.acceptances[0].documentId).toBe(publishedDocumentId);
    expect(body.acceptances[0].contentDigest).toBe(required.contentDigest);
  });

  it("denies accepting a Terms version that is not currently required", async () => {
    const missingKey = await fetch(`${baseUrl}/api/v1/member/terms/accept`, {
      method: "POST",
      headers: memberHeaders(),
      body: JSON.stringify({ documentId: versionTwoId }),
    });
    expect(missingKey.status).toBe(400);
    expect((await missingKey.json()).code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    // versionTwoId is still DRAFT: the Member was never subject to it.
    const draft = await fetch(`${baseUrl}/api/v1/member/terms/accept`, {
      method: "POST",
      headers: memberHeaders("active", randomUUID()),
      body: JSON.stringify({ documentId: versionTwoId }),
    });
    expect(draft.status).toBe(409);
    expect((await draft.json()).code).toBe("TERMS_VERSION_NOT_REQUIRED");

    const unknown = await fetch(`${baseUrl}/api/v1/member/terms/accept`, {
      method: "POST",
      headers: memberHeaders("active", randomUUID()),
      body: JSON.stringify({ documentId: randomUUID() }),
    });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).code).toBe("NOT_FOUND");

    const inactive = await fetch(`${baseUrl}/api/v1/member/terms/accept`, {
      method: "POST",
      headers: memberHeaders("inactive", randomUUID()),
      body: JSON.stringify({ documentId: publishedDocumentId }),
    });
    expect(inactive.status).toBe(403);
    expect((await inactive.json()).code).toBe("MEMBER_NOT_ACTIVE");

    const invalid = await fetch(`${baseUrl}/api/v1/member/terms/accept`, {
      method: "POST",
      headers: memberHeaders("active", randomUUID()),
      body: JSON.stringify({}),
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe("VALIDATION_ERROR");
  });

  it("reports and completes only the mandatory Member profile fields", async () => {
    const initial = await fetch(`${baseUrl}/api/v1/member/profile`, { headers: memberHeaders() });
    expect(initial.status).toBe(200);
    const initialBody = await initial.json();
    expect(initialBody.memberId).toBe(activeMemberId);
    expect(initialBody.mandatoryFields).toEqual(["fullName", "dateOfBirth", "province"]);
    expect(initialBody.missingMandatoryFields).toEqual(["fullName", "dateOfBirth", "province"]);
    expect(initialBody.profileComplete).toBe(false);

    const partial = await fetch(`${baseUrl}/api/v1/member/profile`, {
      method: "PATCH",
      headers: memberHeaders(),
      body: JSON.stringify({ fullName: "  คุณ สมาชิก  " }),
    });
    expect(partial.status).toBe(200);
    const partialBody = await partial.json();
    expect(partialBody.fullName).toBe("คุณ สมาชิก");
    expect(partialBody.missingMandatoryFields).toEqual(["dateOfBirth", "province"]);

    const before = await prisma.member.findUniqueOrThrow({ where: { id: activeMemberId } });

    const future = await fetch(`${baseUrl}/api/v1/member/profile`, {
      method: "PATCH",
      headers: memberHeaders(),
      body: JSON.stringify({ dateOfBirth: "2099-01-01" }),
    });
    expect(future.status).toBe(400);
    expect((await future.json()).code).toBe("VALIDATION_ERROR");

    // A client-asserted trusted fact is refused, never silently ignored.
    for (const body of [{ phone: "+66812345678" }, { status: "ACTIVE" }, { kycStatus: "VERIFIED" }, { nickname: "x" }]) {
      const denied = await fetch(`${baseUrl}/api/v1/member/profile`, {
        method: "PATCH",
        headers: memberHeaders(),
        body: JSON.stringify(body),
      });
      expect(denied.status).toBe(400);
      expect((await denied.json()).code).toBe("VALIDATION_ERROR");
    }

    const stored = await prisma.member.findUniqueOrThrow({ where: { id: activeMemberId } });
    expect(stored.phone).toBe(before.phone);
    expect(stored.status).toBe("ACTIVE");
    expect(stored.fullName).toBe("คุณ สมาชิก");

    const completed = await fetch(`${baseUrl}/api/v1/member/profile`, {
      method: "PATCH",
      headers: memberHeaders(),
      body: JSON.stringify({ dateOfBirth: "1990-01-01", province: "กรุงเทพมหานคร" }),
    });
    expect(completed.status).toBe(200);
    const completedBody = await completed.json();
    expect(completedBody.missingMandatoryFields).toEqual([]);
    expect(completedBody.profileComplete).toBe(true);
    expect(completedBody.dateOfBirth).toBe("1990-01-01");
    expect(completedBody.profileUpdatedAt).not.toBeNull();

    const reread = await fetch(`${baseUrl}/api/v1/member/profile`, { headers: memberHeaders() });
    const rereadBody = await reread.json();
    expect(rereadBody.province).toBe("กรุงเทพมหานคร");
    expect(rereadBody.profileComplete).toBe(true);
  });

  it("keeps Terms governance behind Admin capabilities", async () => {
    const auditor = await createAdminSession("AUDITOR");
    const readable = await fetch(`${baseUrl}/api/v1/admin/member-terms`, {
      headers: { Authorization: `Bearer ${auditor.accessToken}` },
    });
    expect(readable.status).toBe(200);
    const page = await readable.json();
    expect(page.items.some((item: { id: string }) => item.id === publishedDocumentId)).toBe(true);

    const denied = await fetch(`${baseUrl}/api/v1/admin/member-terms`, {
      method: "POST",
      headers: adminHeaders(auditor.accessToken, randomUUID()),
      body: JSON.stringify(versionPayload(7)),
    });
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("ACCESS_DENIED");
  });
});
