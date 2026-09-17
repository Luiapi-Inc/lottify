import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import type {
  MemberAuthRepository,
  MemberDeviceRecord,
  MemberOtpChallengeRecord,
  MemberRecord,
  OtpRequestWindowFact,
} from "../domain/identity-auth.repository";
import type { MemberOtpPurpose } from "../domain/identity-otp-policy";

@Injectable()
export class PrismaMemberAuthRepository implements MemberAuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByPhone(phone: string): Promise<MemberRecord | null> {
    const member = await this.prisma.member.findUnique({ where: { phone } });
    return member ? toMemberRecord(member) : null;
  }

  async findById(id: string): Promise<MemberRecord | null> {
    const member = await this.prisma.member.findUnique({ where: { id } });
    return member ? toMemberRecord(member) : null;
  }

  async createMember(input: {
    phone: string;
    passwordHash?: string | null;
    passwordUpdatedAt?: Date | null;
  }): Promise<MemberRecord> {
    try {
      const member = await this.prisma.member.create({
        data: {
          phone: input.phone,
          passwordHash: input.passwordHash ?? null,
          passwordUpdatedAt: input.passwordUpdatedAt ?? null,
        },
      });
      return toMemberRecord(member);
    } catch (error) {
      // The phone is the Member login identity and is unique. A concurrent
      // REGISTER for the same phone is the same account, never a duplicate.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.prisma.member.findUnique({
          where: { phone: input.phone },
        });
        if (existing) return toMemberRecord(existing);
      }
      throw error;
    }
  }

  // A credential change is a single guarded update: it writes only when the
  // Member row still exists, so a caller that reads `null` knows nothing was
  // persisted instead of assuming success.
  async setMemberPassword(input: {
    memberId: string;
    passwordHash: string;
    updatedAt: Date;
  }): Promise<MemberRecord | null> {
    const updated = await this.prisma.member.updateMany({
      where: { id: input.memberId },
      data: {
        passwordHash: input.passwordHash,
        passwordUpdatedAt: input.updatedAt,
        // A credential change clears any standing lockout state: the new
        // credential is not the one that accumulated failures.
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    if (updated.count !== 1) return null;
    return this.findById(input.memberId);
  }

  async recordLoginFailure(input: {
    memberId: string;
    failedLoginAttempts: number;
    lockedUntil: Date | null;
  }): Promise<void> {
    await this.prisma.member.updateMany({
      where: { id: input.memberId },
      data: {
        failedLoginAttempts: input.failedLoginAttempts,
        lockedUntil: input.lockedUntil,
      },
    });
  }

  async recordLoginSuccess(memberId: string, _at: Date): Promise<void> {
    await this.prisma.member.updateMany({
      where: { id: memberId },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      },
    });
  }

  async countOtpRequestsInWindow(input: {
    phone: string;
    purpose: MemberOtpPurpose;
    windowStart: Date;
  }): Promise<OtpRequestWindowFact> {
    const [challenges, oldest, latest] = await this.prisma.$transaction([
      this.prisma.memberOtpChallenge.count({
        where: {
          phone: input.phone,
          purpose: input.purpose,
          createdAt: { gte: input.windowStart },
        },
      }),
      this.prisma.memberOtpChallenge.findFirst({
        where: {
          phone: input.phone,
          purpose: input.purpose,
          createdAt: { gte: input.windowStart },
        },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      this.prisma.memberOtpChallenge.findFirst({
        where: {
          phone: input.phone,
          purpose: input.purpose,
        },
        orderBy: { createdAt: "desc" },
        select: { cooldownUntil: true },
      }),
    ]);
    return {
      recentRequestCountInWindow: challenges,
      windowStartsAt: oldest?.createdAt ?? input.windowStart,
      latestCooldownUntil: latest?.cooldownUntil ?? null,
    };
  }

  async createOtpChallenge(input: {
    phone: string;
    purpose: MemberOtpPurpose;
    memberId: string | null;
    codeHash: string;
    expiresAt: Date;
    cooldownUntil: Date;
  }): Promise<MemberOtpChallengeRecord> {
    const challenge = await this.prisma.memberOtpChallenge.create({
      data: {
        phone: input.phone,
        purpose: input.purpose,
        memberId: input.memberId,
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        cooldownUntil: input.cooldownUntil,
      },
    });
    return toOtpRecord(challenge);
  }

  async findLatestActiveChallenge(input: {
    phone: string;
    purpose: MemberOtpPurpose;
  }): Promise<MemberOtpChallengeRecord | null> {
    const challenge = await this.prisma.memberOtpChallenge.findFirst({
      where: {
        phone: input.phone,
        purpose: input.purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    return challenge ? toOtpRecord(challenge) : null;
  }

  async findChallengeById(id: string): Promise<MemberOtpChallengeRecord | null> {
    const challenge = await this.prisma.memberOtpChallenge.findUnique({
      where: { id },
    });
    return challenge ? toOtpRecord(challenge) : null;
  }

  async recordChallengeAttempt(id: string, attemptsUsed: number): Promise<void> {
    await this.prisma.memberOtpChallenge.update({
      where: { id },
      data: { attemptsUsed },
    });
  }

  async consumeChallenge(
    id: string,
    memberId: string | null,
    consumedAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.memberOtpChallenge.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt, memberId },
    });
    return result.count === 1;
  }

  async upsertDevice(input: {
    memberId: string;
    deviceId: string;
    name: string | null;
  }): Promise<MemberDeviceRecord> {
    const device = await this.prisma.memberDevice.upsert({
      where: { id: input.deviceId },
      create: {
        id: input.deviceId,
        memberId: input.memberId,
        name: input.name,
        lastUsedAt: new Date(),
      },
      update: { memberId: input.memberId, name: input.name, lastUsedAt: new Date() },
    });
    return toDeviceRecord(device);
  }

  async touchDevice(deviceId: string, at: Date): Promise<void> {
    await this.prisma.memberDevice.updateMany({
      where: { id: deviceId },
      data: { lastUsedAt: at },
    });
  }

  async listDevicesForMember(memberId: string): Promise<MemberDeviceRecord[]> {
    const devices = await this.prisma.memberDevice.findMany({
      where: { memberId },
      orderBy: { createdAt: "desc" },
    });
    return devices.map(toDeviceRecord);
  }
}

type PrismaMember = {
  id: string;
  phone: string;
  status: string;
  passwordHash: string | null;
  passwordUpdatedAt: Date | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toMemberRecord(member: PrismaMember): MemberRecord {
  if (member.status !== "ACTIVE" && member.status !== "DISABLED") {
    throw new Error("Unknown Member status persisted");
  }
  return {
    id: member.id,
    phone: member.phone,
    status: member.status,
    // The encoded credential stays inside the persistence boundary: it is
    // returned here so the auth service can verify it, and it is never mapped
    // into an API response or a log record.
    passwordHash: member.passwordHash,
    passwordUpdatedAt: member.passwordUpdatedAt,
    failedLoginAttempts: member.failedLoginAttempts,
    lockedUntil: member.lockedUntil,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}

type PrismaOtpChallenge = {
  id: string;
  phone: string;
  purpose: string;
  memberId: string | null;
  codeHash: string;
  attemptsUsed: number;
  expiresAt: Date;
  cooldownUntil: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

function toOtpRecord(challenge: PrismaOtpChallenge): MemberOtpChallengeRecord {
  return {
    id: challenge.id,
    phone: challenge.phone,
    purpose: challenge.purpose,
    memberId: challenge.memberId,
    codeHash: challenge.codeHash,
    attemptsUsed: challenge.attemptsUsed,
    expiresAt: challenge.expiresAt,
    cooldownUntil: challenge.cooldownUntil,
    consumedAt: challenge.consumedAt,
    createdAt: challenge.createdAt,
  };
}

function toDeviceRecord(device: {
  id: string;
  memberId: string;
  name: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}): MemberDeviceRecord {
  return {
    id: device.id,
    memberId: device.memberId,
    name: device.name,
    createdAt: device.createdAt,
    lastUsedAt: device.lastUsedAt,
  };
}
