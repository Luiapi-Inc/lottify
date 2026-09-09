import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import type { AuthSessionRecord, SessionRepository } from "../domain/session.repository";

@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: {
    memberId: string;
    deviceId?: string;
    familyId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<AuthSessionRecord> {
    return this.prisma.authSession.create({
      data: {
        memberId: input.memberId,
        familyId: input.familyId,
        ...(input.deviceId ? { deviceId: input.deviceId } : {}),
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
      },
    });
  }

  findById(id: string): Promise<AuthSessionRecord | null> {
    return this.prisma.authSession.findUnique({ where: { id } });
  }

  findByRefreshHash(refreshTokenHash: string): Promise<AuthSessionRecord | null> {
    return this.prisma.authSession.findFirst({ where: { refreshTokenHash } });
  }

  listActiveForMember(memberId: string): Promise<AuthSessionRecord[]> {
    return this.prisma.authSession.findMany({
      where: {
        memberId,
        revokedAt: null,
        replacedById: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async rotate(input: {
    id: string;
    expectedHash: string;
    newHash: string;
    newExpiresAt: Date;
    nextId: string;
  }): Promise<AuthSessionRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.authSession.findUnique({
        where: { id: input.id },
      });
      if (!current) return null;

      const now = new Date();
      // Guard against concurrent rotation: only a still-current, unrevoked,
      // unreplaced head row whose hash still matches can advance the lineage.
      const revoked = await tx.authSession.updateMany({
        where: {
          id: current.id,
          refreshTokenHash: input.expectedHash,
          revokedAt: null,
          replacedById: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now, replacedById: input.nextId },
      });
      if (revoked.count !== 1) return null;

      return tx.authSession.create({
        data: {
          id: input.nextId,
          memberId: current.memberId,
          deviceId: current.deviceId,
          familyId: current.familyId,
          refreshTokenHash: input.newHash,
          expiresAt: input.newExpiresAt,
        },
      });
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeByDevice(memberId: string, deviceId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { memberId, deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForMember(memberId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { memberId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
