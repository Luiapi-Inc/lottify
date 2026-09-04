import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "node:crypto";
import { getEnvironment } from "../../../platform/config/env";
import { SESSION_REPOSITORY, type SessionRepository } from "../domain/session.repository";

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    private readonly jwt: JwtService,
  ) {}

  async issue(memberId: string, deviceId?: string): Promise<{
    sessionId: string;
    accessToken: string;
    refreshToken: string;
  }> {
    const env = getEnvironment();
    const refreshToken = newRefreshToken();
    const session = await this.sessions.create({
      memberId,
      ...(deviceId ? { deviceId } : {}),
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1_000),
    });

    return {
      sessionId: session.id,
      accessToken: await this.signAccess(memberId, session.id),
      refreshToken,
    };
  }

  async rotate(sessionId: string, currentRefreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const env = getEnvironment();
    const nextRefreshToken = newRefreshToken();
    const rotated = await this.sessions.rotate({
      id: sessionId,
      expectedHash: hashRefreshToken(currentRefreshToken),
      newHash: hashRefreshToken(nextRefreshToken),
      newExpiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1_000),
    });
    if (!rotated) {
      throw new UnauthorizedException("Refresh token is invalid, expired, reused, or revoked");
    }

    const session = await this.sessions.findById(sessionId);
    if (!session || session.revokedAt) {
      throw new UnauthorizedException("Session is not active");
    }

    return {
      accessToken: await this.signAccess(session.memberId, session.id),
      refreshToken: nextRefreshToken,
    };
  }

  async listForMember(memberId: string): Promise<
    Array<{
      sessionId: string;
      deviceId: string | null;
      expiresAt: Date;
    }>
  > {
    const sessions = await this.sessions.listActiveForMember(memberId);
    return sessions.map((session) => ({
      sessionId: session.id,
      deviceId: session.deviceId,
      expiresAt: session.expiresAt,
    }));
  }

  revoke(memberId: string, sessionId: string): Promise<void> {
    return this.sessions.revokeForMember(memberId, sessionId);
  }

  revokeByDevice(memberId: string, deviceId: string): Promise<void> {
    return this.sessions.revokeByDevice(memberId, deviceId);
  }

  revokeAllForMember(memberId: string): Promise<void> {
    return this.sessions.revokeAllForMember(memberId);
  }

  private signAccess(memberId: string, sessionId: string): Promise<string> {
    const env = getEnvironment();
    return this.jwt.signAsync(
      { sub: memberId, sid: sessionId },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: env.JWT_ACCESS_TTL_SECONDS },
    );
  }
}
