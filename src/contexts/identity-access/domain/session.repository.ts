export interface AuthSessionRecord {
  id: string;
  memberId: string;
  deviceId: string | null;
  refreshTokenHash: string;
  version: number;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface SessionRepository {
  create(input: {
    memberId: string;
    deviceId?: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<AuthSessionRecord>;
  findById(id: string): Promise<AuthSessionRecord | null>;
  listActiveForMember(memberId: string): Promise<AuthSessionRecord[]>;
  rotate(input: { id: string; expectedHash: string; newHash: string; newExpiresAt: Date }): Promise<boolean>;
  revokeForMember(memberId: string, id: string): Promise<void>;
  revokeByDevice(memberId: string, deviceId: string): Promise<void>;
  revokeAllForMember(memberId: string): Promise<void>;
}

export const SESSION_REPOSITORY = Symbol("IDENTITY_ACCESS_SESSION_REPOSITORY");
