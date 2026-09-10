import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getEnvironment } from "../../../platform/config/env";
import { SESSION_REPOSITORY, type SessionRepository } from "../domain/session.repository";
import {
  MEMBER_LOGIN_CAPABILITY_PORT,
  type MemberLoginCapabilityPort,
} from "./pre-auth-login-capability.port";

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
    // Explicit @Inject on every parameter: the tsx-run tooling (the OpenAPI
    // generator) does not emit `design:paramtypes`, so an undecorated parameter
    // is injected as `undefined` (a decorated param after it makes Nest throw
    // `UndefinedDependencyException`).
    @Inject(JwtService) private readonly jwt: JwtService,
    // The effective `LOGIN_BLOCKED` restriction also denies an in-flight Member
    // session (refresh rotation and access-token use), not only new logins. The
    // rule is consumed from the merged Member-context module through the same
    // cross-context port as the pre-auth boundary — never re-implemented here.
    @Inject(MEMBER_LOGIN_CAPABILITY_PORT)
    private readonly loginCapability: MemberLoginCapabilityPort,
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
      familyId: randomUUID(),
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

  // Ticket 10 refresh rotation with server-enforced reuse/revocation. A valid
  // refresh credential advances its family lineage; a replayed or rotated-away
  // credential is a reuse signal that revokes the entire family so the reused
  // credential can never keep a live session alive.
  async refresh(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const session = await this.sessions.findByRefreshHash(
      hashRefreshToken(refreshToken),
    );
    if (!session) {
      throw new UnauthorizedException("Refresh session is invalid, expired, or revoked");
    }

    const now = new Date();
    if (session.revokedAt || session.expiresAt <= now) {
      // A rotated-away row is revoked AND replaced: presenting that old token
      // is a replay, so kill the whole family (including the live successor).
      if (session.replacedById) {
        await this.sessions.revokeFamily(session.familyId);
      }
      throw new UnauthorizedException("Refresh session is invalid, expired, or revoked");
    }

    // An effective `LOGIN_BLOCKED` denies refresh rotation, so a restricted
    // Member cannot keep an in-flight session alive past its access-token TTL.
    // Point-in-time against the restriction's effective window; the session is
    // NOT revoked, so once the restriction clears the same credential resumes.
    await this.assertLoginAllowed(session.memberId, now);

    return this.rotate(session.id, refreshToken);
  }

  async rotate(
    sessionId: string,
    currentRefreshToken: string,
  ): Promise<{
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
      nextId: randomUUID(),
    });
    if (!rotated) {
      // Rotation could not advance the lineage: the session is revoked/expired
      // or the credential was already rotated away (concurrent reuse). In the
      // reuse case the current successor must not survive, so revoke the whole
      // family. Killing an already-revoked family is a harmless no-op.
      const current = await this.sessions.findById(sessionId);
      if (current) {
        await this.sessions.revokeFamily(current.familyId);
      }
      throw new UnauthorizedException("Refresh token is invalid, expired, reused, or revoked");
    }

    return {
      accessToken: await this.signAccess(rotated.memberId, rotated.id),
      refreshToken: nextRefreshToken,
    };
  }

  async findSessionForRefreshToken(refreshToken: string): Promise<{
    sessionId: string;
    memberId: string;
    deviceId: string | null;
    expiresAt: Date;
    revokedAt: Date | null;
  } | null> {
    const session = await this.sessions.findByRefreshHash(
      hashRefreshToken(refreshToken),
    );
    if (!session) return null;
    return {
      sessionId: session.id,
      memberId: session.memberId,
      deviceId: session.deviceId,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
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

  // Revoking a session revokes its whole family lineage so the session cannot
  // be resurrected through a rotated successor.
  async revoke(memberId: string, sessionId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (session && session.memberId === memberId) {
      await this.sessions.revokeFamily(session.familyId);
    }
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
      { sub: memberId, sid: sessionId, actor: "member", type: "access" },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: env.JWT_ACCESS_TTL_SECONDS },
    );
  }

  async authenticateAccess(token: string): Promise<{
    memberId: string;
    sessionId: string;
    deviceId: string | null;
  }> {
    const env = getEnvironment();
    let claims: { sub?: string; sid?: string; actor?: string; type?: string };
    try {
      claims = await this.jwt.verifyAsync<{
        sub?: string;
        sid?: string;
        actor?: string;
        type?: string;
      }>(token, { secret: env.JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException("Invalid member access token");
    }
    if (
      claims.actor !== "member" ||
      claims.type !== "access" ||
      typeof claims.sub !== "string" ||
      typeof claims.sid !== "string"
    ) {
      throw new UnauthorizedException("Invalid member access token");
    }
    const session = await this.sessions.findById(claims.sid);
    const now = new Date();
    if (
      !session ||
      session.memberId !== claims.sub ||
      session.revokedAt ||
      session.expiresAt <= now
    ) {
      throw new UnauthorizedException("Member session expired or revoked");
    }

    // A Member restricted by an effective `LOGIN_BLOCKED` cannot use an already
    // issued access token: the guard's per-request authentication now also
    // consults the capability port, point-in-time, so a restriction applied
    // after login takes effect immediately (not only on the next login).
    await this.assertLoginAllowed(session.memberId, now);

    return {
      memberId: session.memberId,
      sessionId: session.id,
      deviceId: session.deviceId,
    };
  }

  /** Denies session use/refresh for an effective `LOGIN_BLOCKED` restriction. */
  private async assertLoginAllowed(memberId: string, at: Date): Promise<void> {
    const decision = await this.loginCapability.evaluateLoginCapability(
      memberId,
      at,
    );
    if (!decision.allowed) {
      throw new UnauthorizedException({
        code: decision.reasonCode ?? "CAPABILITY_BLOCKED",
        message: "This Member is not permitted to use their session",
        details: {},
      });
    }
  }
}
