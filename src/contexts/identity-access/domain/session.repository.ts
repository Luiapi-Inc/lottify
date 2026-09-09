export interface AuthSessionRecord {
  id: string;
  memberId: string;
  deviceId: string | null;
  // A refresh lineage is a "family". The current (latest) row of a family holds
  // the live refresh-token hash; every rotated-away row keeps its own hash and
  // is marked replacedById so a replayed token stays findable and its whole
  // family can be revoked (Ticket 10 reuse containment).
  familyId: string;
  refreshTokenHash: string;
  version: number;
  replacedById: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface SessionRepository {
  create(input: {
    memberId: string;
    deviceId?: string;
    familyId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<AuthSessionRecord>;
  findById(id: string): Promise<AuthSessionRecord | null>;
  findByRefreshHash(refreshTokenHash: string): Promise<AuthSessionRecord | null>;
  listActiveForMember(memberId: string): Promise<AuthSessionRecord[]>;
  /**
   * Atomically rotate a refresh lineage: revoke the current head row (marking
   * it replacedById) and create its successor in the same family. Returns the
   * successor row, or null when the head is not rotatable (already revoked,
   * already replaced, expired, or the presented hash no longer matches) which
   * is the reuse/race signal the caller must treat as containment.
   */
  rotate(input: {
    id: string;
    expectedHash: string;
    newHash: string;
    newExpiresAt: Date;
    nextId: string;
  }): Promise<AuthSessionRecord | null>;
  revokeFamily(familyId: string): Promise<void>;
  revokeByDevice(memberId: string, deviceId: string): Promise<void>;
  revokeAllForMember(memberId: string): Promise<void>;
}

export const SESSION_REPOSITORY = Symbol("IDENTITY_ACCESS_SESSION_REPOSITORY");
