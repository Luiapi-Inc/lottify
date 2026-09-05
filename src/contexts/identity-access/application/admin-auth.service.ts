import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  getAdminMfaEncryptionKey,
  getEnvironment,
} from "../../../platform/config/env";
import {
  ADMIN_AUTH_REPOSITORY,
  type AdminAuthRepository,
  type AdminCapability,
  type AdminPrincipalRecord,
  type AdminReauthEvidenceRecord,
  type AdminRole,
} from "../domain/admin-auth.repository";
import {
  hashAdminPassword,
  verifyAdminPassword,
} from "../domain/admin-password";
import { capabilitiesForRole, parseAdminRole } from "../domain/admin-policy";
import {
  decryptAdminSecret,
  encryptAdminSecret,
} from "../domain/admin-secret-crypto";
import {
  buildTotpUri,
  generateTotpSecret,
  verifyTotp,
} from "../domain/totp";

type AdminTokenType = "access" | "mfa_setup" | "mfa_challenge";

interface AdminTokenClaims {
  sub?: string;
  sid?: string;
  actor?: string;
  type?: string;
}

export interface AdminRequestContext {
  adminId: string;
  sessionId: string;
  email: string;
  name: string;
  role: AdminRole;
  capabilities: readonly AdminCapability[];
  mfaVerifiedAt: Date;
}

export type AdminLoginResult =
  | { status: "MFA_SETUP_REQUIRED"; setupToken: string }
  | { status: "MFA_REQUIRED"; challengeToken: string };

export interface AdminAuthTokens {
  accessToken: string;
  refreshToken: string;
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(ADMIN_AUTH_REPOSITORY)
    private readonly repository: AdminAuthRepository,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<AdminLoginResult> {
    const env = getEnvironment();
    const normalizedEmail = email.trim().toLowerCase();
    const admin = await this.repository.findPrincipalByEmail(normalizedEmail);

    if (admin?.lockedUntil && admin.lockedUntil > new Date()) {
      throw new UnauthorizedException("Invalid admin credentials");
    }

    const passwordValid = admin
      ? await verifyAdminPassword(admin.passwordHash, password)
      : false;
    if (!admin) await hashAdminPassword(password);
    const valid =
      !!admin &&
      admin.status === "ACTIVE" &&
      parseAdminRole(admin.role) !== null &&
      passwordValid;

    if (!valid) {
      if (admin) {
        const attempts = admin.failedLoginAttempts + 1;
        const locked = attempts >= env.ADMIN_LOGIN_MAX_ATTEMPTS;
        await this.repository.recordLoginFailure({
          adminId: admin.id,
          failedLoginAttempts: locked ? 0 : attempts,
          lockedUntil: locked
            ? new Date(Date.now() + env.ADMIN_LOGIN_LOCKOUT_SECONDS * 1_000)
            : null,
        });
      }
      throw new UnauthorizedException("Invalid admin credentials");
    }

    await this.repository.recordLoginSuccess(admin.id);
    if (!admin.mfaEnabled || !admin.mfaSecretEncrypted) {
      return {
        status: "MFA_SETUP_REQUIRED",
        setupToken: await this.signTransient(
          admin.id,
          "mfa_setup",
          env.ADMIN_MFA_SETUP_TTL_SECONDS,
        ),
      };
    }

    return {
      status: "MFA_REQUIRED",
      challengeToken: await this.signTransient(
        admin.id,
        "mfa_challenge",
        env.ADMIN_MFA_CHALLENGE_TTL_SECONDS,
      ),
    };
  }

  async setupMfa(setupToken: string): Promise<{ secret: string; otpauthUrl: string }> {
    const claims = await this.verifyToken(setupToken, "mfa_setup");
    const admin = await this.requireActivePrincipal(claims.sub!);
    if (admin.mfaEnabled) throw new ConflictException("Admin MFA is already enabled");
    const secret = generateTotpSecret();
    return { secret, otpauthUrl: buildTotpUri(secret, admin.email) };
  }

  async confirmMfa(
    setupToken: string,
    secret: string,
    code: string,
  ): Promise<{ enabled: true }> {
    const claims = await this.verifyToken(setupToken, "mfa_setup");
    const admin = await this.requireActivePrincipal(claims.sub!);
    if (admin.mfaEnabled) throw new ConflictException("Admin MFA is already enabled");
    if (!verifyTotp(secret, code)) throw new UnauthorizedException("Invalid MFA code");
    await this.repository.enableMfa(
      admin.id,
      encryptAdminSecret(secret, getAdminMfaEncryptionKey()),
    );
    return { enabled: true };
  }

  async verifyMfa(
    challengeToken: string,
    code: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AdminAuthTokens> {
    const claims = await this.verifyToken(challengeToken, "mfa_challenge");
    const admin = await this.requireActivePrincipal(claims.sub!);
    const secret = this.adminTotpSecret(admin);
    if (!verifyTotp(secret, code)) throw new UnauthorizedException("Invalid MFA code");

    const env = getEnvironment();
    const now = new Date();
    const refreshToken = newRefreshToken();
    const session = await this.repository.createSession({
      adminUserId: admin.id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      familyId: randomUUID(),
      expiresAt: new Date(now.getTime() + env.REFRESH_TOKEN_TTL_SECONDS * 1_000),
      mfaVerifiedAt: now,
      ...(ipAddress ? { ipAddress } : {}),
      ...(userAgent ? { userAgent } : {}),
    });
    await this.repository.recordLoginSuccess(admin.id, now);
    return {
      accessToken: await this.signAccess(admin.id, session.id),
      refreshToken,
    };
  }

  async refresh(
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AdminAuthTokens> {
    const env = getEnvironment();
    const refreshHash = hashRefreshToken(refreshToken);
    const current = await this.repository.findSessionByRefreshHash(refreshHash);
    if (!current) throw new UnauthorizedException("Invalid admin refresh session");

    const now = new Date();
    if (current.revokedAt || current.expiresAt <= now || !current.mfaVerifiedAt) {
      if (current.replacedById) await this.repository.revokeFamily(current.familyId);
      throw new UnauthorizedException("Admin refresh session expired or revoked");
    }
    await this.requireActivePrincipal(current.adminUserId);

    const nextRefreshToken = newRefreshToken();
    const nextSession = await this.repository.rotateSession({
      currentSessionId: current.id,
      expectedRefreshTokenHash: refreshHash,
      nextRefreshTokenHash: hashRefreshToken(nextRefreshToken),
      nextExpiresAt: new Date(now.getTime() + env.REFRESH_TOKEN_TTL_SECONDS * 1_000),
      nextSessionId: randomUUID(),
      ...(ipAddress ? { ipAddress } : {}),
      ...(userAgent ? { userAgent } : {}),
    });
    if (!nextSession) {
      await this.repository.revokeFamily(current.familyId);
      throw new UnauthorizedException("Admin refresh token reuse detected");
    }

    return {
      accessToken: await this.signAccess(current.adminUserId, nextSession.id),
      refreshToken: nextRefreshToken,
    };
  }

  async logout(refreshToken: string | undefined): Promise<{ revoked: true }> {
    if (refreshToken) {
      const session = await this.repository.findSessionByRefreshHash(
        hashRefreshToken(refreshToken),
      );
      if (session) await this.repository.revokeFamily(session.familyId);
    }
    return { revoked: true };
  }

  async revokeAll(adminId: string): Promise<{ revoked: true }> {
    await this.repository.revokeAllForAdmin(adminId);
    return { revoked: true };
  }

  async authenticateAccess(token: string): Promise<AdminRequestContext> {
    const claims = await this.verifyToken(token, "access");
    if (!claims.sid) throw new UnauthorizedException("Invalid admin access token");
    const session = await this.repository.findSessionById(claims.sid);
    const now = new Date();
    if (
      !session ||
      session.adminUserId !== claims.sub ||
      session.revokedAt ||
      session.expiresAt <= now ||
      !session.mfaVerifiedAt
    ) {
      throw new UnauthorizedException("Admin session expired or revoked");
    }
    const admin = await this.requireActivePrincipal(claims.sub!);
    const role = parseAdminRole(admin.role)!;
    return {
      adminId: admin.id,
      sessionId: session.id,
      email: admin.email,
      name: admin.name,
      role,
      capabilities: capabilitiesForRole(role),
      mfaVerifiedAt: session.mfaVerifiedAt,
    };
  }

  me(context: AdminRequestContext): {
    id: string;
    email: string;
    name: string;
    role: AdminRole;
    capabilities: readonly AdminCapability[];
  } {
    return {
      id: context.adminId,
      email: context.email,
      name: context.name,
      role: context.role,
      capabilities: context.capabilities,
    };
  }

  async reauthenticate(
    context: AdminRequestContext,
    actionClass: string,
    code: string,
  ): Promise<{ actionClass: string; verifiedAt: Date; expiresAt: Date }> {
    const admin = await this.requireActivePrincipal(context.adminId);
    if (!verifyTotp(this.adminTotpSecret(admin), code)) {
      throw new UnauthorizedException("Invalid MFA code");
    }
    const verifiedAt = new Date();
    const expiresAt = new Date(
      verifiedAt.getTime() + getEnvironment().ADMIN_MFA_REAUTH_TTL_SECONDS * 1_000,
    );
    await this.repository.createReauthEvidence({
      adminUserId: context.adminId,
      sessionId: context.sessionId,
      actionClass,
      verifiedAt,
      expiresAt,
    });
    return { actionClass, verifiedAt, expiresAt };
  }

  async requireFreshMfa(
    context: AdminRequestContext,
    actionClass: string,
  ): Promise<AdminReauthEvidenceRecord> {
    const evidence = await this.repository.findReauthEvidence(
      context.sessionId,
      actionClass,
    );
    if (
      !evidence ||
      evidence.adminUserId !== context.adminId ||
      evidence.expiresAt <= new Date()
    ) {
      throw new ForbiddenException("Fresh MFA verification required");
    }
    return evidence;
  }

  private async requireActivePrincipal(id: string): Promise<AdminPrincipalRecord> {
    const admin = await this.repository.findPrincipalById(id);
    if (!admin || admin.status !== "ACTIVE" || !parseAdminRole(admin.role)) {
      throw new UnauthorizedException("Admin account unavailable");
    }
    return admin;
  }

  private adminTotpSecret(admin: AdminPrincipalRecord): string {
    if (!admin.mfaEnabled || !admin.mfaSecretEncrypted) {
      throw new UnauthorizedException("Admin MFA is not enabled");
    }
    try {
      return decryptAdminSecret(
        admin.mfaSecretEncrypted,
        getAdminMfaEncryptionKey(),
      );
    } catch {
      throw new UnauthorizedException("Admin MFA is unavailable");
    }
  }

  private signAccess(adminId: string, sessionId: string): Promise<string> {
    return this.sign(adminId, "access", getEnvironment().JWT_ACCESS_TTL_SECONDS, sessionId);
  }

  private signTransient(
    adminId: string,
    type: Exclude<AdminTokenType, "access">,
    ttlSeconds: number,
  ): Promise<string> {
    return this.sign(adminId, type, ttlSeconds);
  }

  private sign(
    adminId: string,
    type: AdminTokenType,
    ttlSeconds: number,
    sessionId?: string,
  ): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: adminId,
        actor: "admin",
        type,
        ...(sessionId ? { sid: sessionId } : {}),
      },
      {
        secret: getEnvironment().JWT_ACCESS_SECRET,
        expiresIn: ttlSeconds,
      },
    );
  }

  private async verifyToken(
    token: string,
    expectedType: AdminTokenType,
  ): Promise<AdminTokenClaims> {
    let claims: AdminTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AdminTokenClaims>(token, {
        secret: getEnvironment().JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException("Invalid admin token");
    }
    if (
      claims.actor !== "admin" ||
      claims.type !== expectedType ||
      typeof claims.sub !== "string" ||
      (expectedType === "access" && typeof claims.sid !== "string")
    ) {
      throw new UnauthorizedException("Invalid admin token");
    }
    return claims;
  }
}
