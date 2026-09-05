import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import type {
  AdminReauthEvidenceCreateInput,
  AdminAuthRepository,
  AdminAuthSessionRecord,
  AdminPrincipalRecord,
  AdminReauthEvidenceRecord,
} from "../domain/admin-auth.repository";

@Injectable()
export class PrismaAdminAuthRepository implements AdminAuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findPrincipalByEmail(email: string): Promise<AdminPrincipalRecord | null> {
    return this.prisma.adminUser.findUnique({ where: { email } });
  }

  findPrincipalById(id: string): Promise<AdminPrincipalRecord | null> {
    return this.prisma.adminUser.findUnique({ where: { id } });
  }

  async recordLoginFailure(input: {
    adminId: string;
    failedLoginAttempts: number;
    lockedUntil: Date | null;
  }): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id: input.adminId },
      data: {
        failedLoginAttempts: input.failedLoginAttempts,
        lockedUntil: input.lockedUntil,
      },
    });
  }

  async recordLoginSuccess(adminId: string, loggedInAt?: Date): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        ...(loggedInAt ? { lastLoginAt: loggedInAt } : {}),
      },
    });
  }

  async enableMfa(adminId: string, encryptedSecret: string): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { mfaEnabled: true, mfaSecretEncrypted: encryptedSecret },
    });
  }

  createSession(input: {
    adminUserId: string;
    refreshTokenHash: string;
    familyId: string;
    expiresAt: Date;
    mfaVerifiedAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AdminAuthSessionRecord> {
    return this.prisma.adminAuthSession.create({ data: input });
  }

  findSessionById(id: string): Promise<AdminAuthSessionRecord | null> {
    return this.prisma.adminAuthSession.findUnique({ where: { id } });
  }

  findSessionByRefreshHash(
    refreshTokenHash: string,
  ): Promise<AdminAuthSessionRecord | null> {
    return this.prisma.adminAuthSession.findUnique({
      where: { refreshTokenHash },
    });
  }

  rotateSession(input: {
    currentSessionId: string;
    expectedRefreshTokenHash: string;
    nextRefreshTokenHash: string;
    nextExpiresAt: Date;
    nextSessionId: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AdminAuthSessionRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.adminAuthSession.findUnique({
        where: { id: input.currentSessionId },
      });
      if (!current) return null;

      const now = new Date();
      const rotated = await tx.adminAuthSession.updateMany({
        where: {
          id: current.id,
          refreshTokenHash: input.expectedRefreshTokenHash,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          revokedAt: now,
          replacedById: input.nextSessionId,
          lastUsedAt: now,
        },
      });
      if (rotated.count !== 1) return null;

      return tx.adminAuthSession.create({
        data: {
          id: input.nextSessionId,
          adminUserId: current.adminUserId,
          refreshTokenHash: input.nextRefreshTokenHash,
          familyId: current.familyId,
          expiresAt: input.nextExpiresAt,
          mfaVerifiedAt: current.mfaVerifiedAt,
          ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
          ...(input.userAgent ? { userAgent: input.userAgent } : {}),
        },
      });
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.adminAuthSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForAdmin(adminId: string): Promise<void> {
    await this.prisma.adminAuthSession.updateMany({
      where: { adminUserId: adminId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  createReauthEvidence(
    input: AdminReauthEvidenceCreateInput,
  ): Promise<AdminReauthEvidenceRecord> {
    return this.prisma.adminReauthEvidence.create({ data: input });
  }

  findReauthEvidence(
    sessionId: string,
    actionClass: string,
  ): Promise<AdminReauthEvidenceRecord | null> {
    return this.prisma.adminReauthEvidence.findFirst({
      where: { sessionId, actionClass },
      orderBy: [{ verifiedAt: "desc" }, { id: "desc" }],
    });
  }
}
