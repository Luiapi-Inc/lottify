import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import type { AuthSessionRecord, SessionRepository } from "../domain/session.repository";

@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: {
    memberId: string;
    deviceId?: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<AuthSessionRecord> {
    return this.prisma.authSession.create({ data: input });
  }

  findById(id: string): Promise<AuthSessionRecord | null> {
    return this.prisma.authSession.findUnique({ where: { id } });
  }

  async rotate(input: { id: string; expectedHash: string; newHash: string; newExpiresAt: Date }): Promise<boolean> {
    const result = await this.prisma.authSession.updateMany({
      where: {
        id: input.id,
        refreshTokenHash: input.expectedHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        refreshTokenHash: input.newHash,
        expiresAt: input.newExpiresAt,
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id, revokedAt: null },
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
