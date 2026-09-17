import { MemberOtpPurpose } from "./identity-otp-policy";

export type MemberStatus = "ACTIVE" | "DISABLED";

export interface MemberRecord {
  id: string;
  phone: string;
  status: MemberStatus;
  /**
   * Encoded credential hash (CR #141) or `null` for a Member that has not
   * enrolled a password yet. A null value is the enrollment signal: such a
   * Member cannot use the password login channel until they set one.
   * Never returned by the API and never logged.
   */
  passwordHash: string | null;
  passwordUpdatedAt: Date | null;
  /**
   * Bounded brute-force state for the password login channel. A lock is not an
   * account status change; it expires by itself and never disables the Member.
   */
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberDeviceRecord {
  id: string;
  memberId: string;
  name: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface MemberOtpChallengeRecord {
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
}

export interface OtpRequestWindowFact {
  recentRequestCountInWindow: number;
  windowStartsAt: Date;
  latestCooldownUntil: Date | null;
}

export interface MemberAuthRepository {
  findByPhone(phone: string): Promise<MemberRecord | null>;
  findById(id: string): Promise<MemberRecord | null>;
  createMember(input: {
    phone: string;
    passwordHash?: string | null;
    passwordUpdatedAt?: Date | null;
  }): Promise<MemberRecord>;
  /**
   * Sets/replaces the Member credential (CR #141). Returns the updated Member,
   * or `null` when the Member no longer exists — the caller must treat that as
   * a failed credential change rather than assuming a write happened.
   */
  setMemberPassword(input: {
    memberId: string;
    passwordHash: string;
    updatedAt: Date;
  }): Promise<MemberRecord | null>;
  /** Records a failed password login and the resulting lock state. */
  recordLoginFailure(input: {
    memberId: string;
    failedLoginAttempts: number;
    lockedUntil: Date | null;
  }): Promise<void>;
  /** Records a successful authentication and clears the failure counter. */
  recordLoginSuccess(memberId: string, at: Date): Promise<void>;
  countOtpRequestsInWindow(input: {
    phone: string;
    purpose: MemberOtpPurpose;
    windowStart: Date;
  }): Promise<OtpRequestWindowFact>;
  createOtpChallenge(input: {
    phone: string;
    purpose: MemberOtpPurpose;
    memberId: string | null;
    codeHash: string;
    expiresAt: Date;
    cooldownUntil: Date;
  }): Promise<MemberOtpChallengeRecord>;
  findLatestActiveChallenge(input: {
    phone: string;
    purpose: MemberOtpPurpose;
  }): Promise<MemberOtpChallengeRecord | null>;
  findChallengeById(id: string): Promise<MemberOtpChallengeRecord | null>;
  recordChallengeAttempt(id: string, attemptsUsed: number): Promise<void>;
  // Atomically marks a challenge consumed only if it is still unconsumed.
  // Returns true when this caller won the single-use claim.
  consumeChallenge(id: string, memberId: string | null, consumedAt: Date): Promise<boolean>;
  upsertDevice(input: {
    memberId: string;
    deviceId: string;
    name: string | null;
  }): Promise<MemberDeviceRecord>;
  touchDevice(deviceId: string, at: Date): Promise<void>;
  listDevicesForMember(memberId: string): Promise<MemberDeviceRecord[]>;
}

export const MEMBER_AUTH_REPOSITORY = Symbol("MEMBER_AUTH_REPOSITORY");
