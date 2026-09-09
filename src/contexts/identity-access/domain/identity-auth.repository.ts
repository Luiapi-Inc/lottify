import { MemberOtpPurpose } from "./identity-otp-policy";

export type MemberStatus = "ACTIVE" | "DISABLED";

export interface MemberRecord {
  id: string;
  phone: string;
  status: MemberStatus;
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
  createMember(input: { phone: string }): Promise<MemberRecord>;
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
  consumeChallenge(id: string, memberId: string, consumedAt: Date): Promise<boolean>;
  recordMemberLogin(id: string, at: Date): Promise<void>;
  upsertDevice(input: {
    memberId: string;
    deviceId: string;
    name: string | null;
  }): Promise<MemberDeviceRecord>;
  touchDevice(deviceId: string, at: Date): Promise<void>;
  listDevicesForMember(memberId: string): Promise<MemberDeviceRecord[]>;
}

export const MEMBER_AUTH_REPOSITORY = Symbol("MEMBER_AUTH_REPOSITORY");
