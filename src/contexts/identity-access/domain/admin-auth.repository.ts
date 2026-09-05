export const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "AUDITOR"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_CAPABILITIES = ["accounting-period.read"] as const;
export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

export interface AdminPrincipalRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: string;
  status: string;
  mfaEnabled: boolean;
  mfaSecretEncrypted: string | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
}

export interface AdminAuthSessionRecord {
  id: string;
  adminUserId: string;
  refreshTokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  mfaVerifiedAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AdminReauthEvidenceRecord {
  adminUserId: string;
  sessionId: string;
  actionClass: string;
  verifiedAt: Date;
  expiresAt: Date;
}

export interface AdminAuthRepository {
  findPrincipalByEmail(email: string): Promise<AdminPrincipalRecord | null>;
  findPrincipalById(id: string): Promise<AdminPrincipalRecord | null>;
  recordLoginFailure(input: {
    adminId: string;
    failedLoginAttempts: number;
    lockedUntil: Date | null;
  }): Promise<void>;
  recordLoginSuccess(adminId: string, loggedInAt?: Date): Promise<void>;
  enableMfa(adminId: string, encryptedSecret: string): Promise<void>;
  createSession(input: {
    adminUserId: string;
    refreshTokenHash: string;
    familyId: string;
    expiresAt: Date;
    mfaVerifiedAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AdminAuthSessionRecord>;
  findSessionById(id: string): Promise<AdminAuthSessionRecord | null>;
  findSessionByRefreshHash(refreshTokenHash: string): Promise<AdminAuthSessionRecord | null>;
  rotateSession(input: {
    currentSessionId: string;
    expectedRefreshTokenHash: string;
    nextRefreshTokenHash: string;
    nextExpiresAt: Date;
    nextSessionId: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AdminAuthSessionRecord | null>;
  revokeFamily(familyId: string): Promise<void>;
  revokeAllForAdmin(adminId: string): Promise<void>;
  upsertReauthEvidence(input: AdminReauthEvidenceRecord): Promise<AdminReauthEvidenceRecord>;
  findReauthEvidence(
    sessionId: string,
    actionClass: string,
  ): Promise<AdminReauthEvidenceRecord | null>;
}

export const ADMIN_AUTH_REPOSITORY = Symbol("IDENTITY_ACCESS_ADMIN_AUTH_REPOSITORY");
