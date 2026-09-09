import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  hashRefreshToken,
  SessionService,
} from "../../src/contexts/identity-access/application/session.service";
import type {
  AuthSessionRecord,
  SessionRepository,
} from "../../src/contexts/identity-access/domain/session.repository";
import { resetEnvironmentForTests } from "../../src/platform/config/env";

type StoredSession = AuthSessionRecord & { deviceId: string | null };

class InMemorySessionRepository implements SessionRepository {
  private readonly records = new Map<string, StoredSession>();

  async create(input: {
    memberId: string;
    deviceId?: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<AuthSessionRecord> {
    const record: StoredSession = {
      id: randomUUID(),
      memberId: input.memberId,
      deviceId: input.deviceId ?? null,
      refreshTokenHash: input.refreshTokenHash,
      version: 1,
      expiresAt: input.expiresAt,
      revokedAt: null,
    };
    this.records.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<AuthSessionRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findByRefreshHash(refreshTokenHash: string): Promise<AuthSessionRecord | null> {
    for (const record of this.records.values()) {
      if (record.refreshTokenHash === refreshTokenHash) return record;
    }
    return null;
  }

  async listActiveForMember(memberId: string): Promise<AuthSessionRecord[]> {
    const now = new Date();
    return [...this.records.values()].filter(
      (record) => record.memberId === memberId && !record.revokedAt && record.expiresAt > now,
    );
  }

  async rotate(input: {
    id: string;
    expectedHash: string;
    newHash: string;
    newExpiresAt: Date;
  }): Promise<boolean> {
    const record = this.records.get(input.id);
    if (
      !record ||
      record.refreshTokenHash !== input.expectedHash ||
      record.revokedAt ||
      record.expiresAt <= new Date()
    ) {
      return false;
    }
    record.refreshTokenHash = input.newHash;
    record.expiresAt = input.newExpiresAt;
    record.version += 1;
    return true;
  }

  async revokeForMember(memberId: string, id: string): Promise<void> {
    const record = this.records.get(id);
    if (record?.memberId === memberId && !record.revokedAt) record.revokedAt = new Date();
  }

  async revokeByDevice(memberId: string, deviceId: string): Promise<void> {
    for (const record of this.records.values()) {
      if (record.memberId === memberId && record.deviceId === deviceId && !record.revokedAt) {
        record.revokedAt = new Date();
      }
    }
  }

  async revokeAllForMember(memberId: string): Promise<void> {
    for (const record of this.records.values()) {
      if (record.memberId === memberId && !record.revokedAt) record.revokedAt = new Date();
    }
  }
}

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/lottify";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.JWT_ACCESS_SECRET = "01234567890123456789012345678901";
  resetEnvironmentForTests();
});

describe("refresh token hashing", () => {
  it("is deterministic without retaining the plaintext token", () => {
    const token = "high-entropy-refresh-token";
    const hash = hashRefreshToken(token);
    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).not.toContain(token);
    expect(hash).toHaveLength(64);
  });
});

describe("session revocation", () => {
  it("lists only active sessions owned by the selected member without exposing refresh-token state", async () => {
    const sessions = new SessionService(new InMemorySessionRepository(), new JwtService());
    const memberId = randomUUID();
    const otherMemberId = randomUUID();
    const phone = await sessions.issue(memberId, "phone");
    const tablet = await sessions.issue(memberId, "tablet");
    await sessions.issue(otherMemberId, "phone");

    await sessions.revoke(memberId, phone.sessionId);
    const active = await sessions.listForMember(memberId);

    expect(active).toEqual([
      expect.objectContaining({ sessionId: tablet.sessionId, deviceId: "tablet" }),
    ]);
    expect(active).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sessionId: phone.sessionId })]),
    );
    expect(active.every((session) => !("refreshTokenHash" in session))).toBe(true);
  });

  it("does not allow a member to revoke another member's session by id", async () => {
    const sessions = new SessionService(new InMemorySessionRepository(), new JwtService());
    const memberId = randomUUID();
    const otherMemberId = randomUUID();
    const otherMember = await sessions.issue(otherMemberId, "phone");

    await sessions.revoke(memberId, otherMember.sessionId);

    await expect(sessions.rotate(otherMember.sessionId, otherMember.refreshToken)).resolves.toBeDefined();
  });

  it("revokes only sessions for the selected member device", async () => {
    const sessions = new SessionService(new InMemorySessionRepository(), new JwtService());
    const memberId = randomUUID();
    const otherMemberId = randomUUID();
    const selected = await sessions.issue(memberId, "phone");
    const otherDevice = await sessions.issue(memberId, "tablet");
    const otherMember = await sessions.issue(otherMemberId, "phone");

    await sessions.revokeByDevice(memberId, "phone");

    await expect(sessions.rotate(selected.sessionId, selected.refreshToken)).rejects.toThrow();
    await expect(sessions.rotate(otherDevice.sessionId, otherDevice.refreshToken)).resolves.toBeDefined();
    await expect(sessions.rotate(otherMember.sessionId, otherMember.refreshToken)).resolves.toBeDefined();
  });

  it("revokes all sessions for one member without revoking another member", async () => {
    const sessions = new SessionService(new InMemorySessionRepository(), new JwtService());
    const memberId = randomUUID();
    const otherMemberId = randomUUID();
    const first = await sessions.issue(memberId, "phone");
    const second = await sessions.issue(memberId, "tablet");
    const otherMember = await sessions.issue(otherMemberId, "phone");

    await sessions.revokeAllForMember(memberId);

    await expect(sessions.rotate(first.sessionId, first.refreshToken)).rejects.toThrow();
    await expect(sessions.rotate(second.sessionId, second.refreshToken)).rejects.toThrow();
    await expect(sessions.rotate(otherMember.sessionId, otherMember.refreshToken)).resolves.toBeDefined();
  });
});
