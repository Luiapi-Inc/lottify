import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import { OnboardingRuleError } from "../domain/onboarding-error";
import {
  MANDATORY_PROFILE_FIELDS,
  missingMandatoryProfileFields,
  normalizeProfilePatch,
  toDateOnlyString,
  type MandatoryProfileField,
  type MemberProfileSnapshot,
  type RawMemberProfilePatch,
} from "../domain/profile-fields";

/**
 * Member profile (Ticket 06 mandatory profile fields, Ticket 11 profile step).
 *
 * The Member reads and edits only its own profile. `phone` is the login identity
 * owned by Identity & Access and is exposed here read-only; `status`, KYC state
 * and Terms state are server-owned and can never be asserted by a client, so a
 * PATCH carrying them is rejected rather than silently ignored.
 */
export interface MemberProfileView {
  readonly memberId: string;
  readonly phone: string;
  readonly fullName: string | null;
  readonly dateOfBirth: string | null;
  readonly province: string | null;
  readonly profileUpdatedAt: Date | null;
  readonly mandatoryFields: readonly MandatoryProfileField[];
  readonly missingMandatoryFields: readonly MandatoryProfileField[];
  readonly profileComplete: boolean;
}

@Injectable()
export class ProfileService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getProfile(memberId: string): Promise<MemberProfileView> {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        phone: true,
        fullName: true,
        dateOfBirth: true,
        province: true,
        profileUpdatedAt: true,
      },
    });
    if (!member) {
      throw new OnboardingRuleError("NOT_FOUND", "Member not found", { memberId });
    }
    return toProfileView(member);
  }

  async updateProfile(
    memberId: string,
    patch: RawMemberProfilePatch,
    at: Date = new Date(),
  ): Promise<MemberProfileView> {
    const normalized = normalizeProfilePatch(patch, at);

    const updated = await this.prisma.member.update({
      where: { id: memberId },
      data: {
        ...(normalized.fullName !== undefined ? { fullName: normalized.fullName } : {}),
        ...(normalized.dateOfBirth !== undefined ? { dateOfBirth: normalized.dateOfBirth } : {}),
        ...(normalized.province !== undefined ? { province: normalized.province } : {}),
        profileUpdatedAt: at,
      },
      select: {
        id: true,
        phone: true,
        fullName: true,
        dateOfBirth: true,
        province: true,
        profileUpdatedAt: true,
      },
    });
    return toProfileView(updated);
  }
}

export function toProfileView(member: {
  id: string;
  phone: string;
  fullName: string | null;
  dateOfBirth: Date | null;
  province: string | null;
  profileUpdatedAt: Date | null;
}): MemberProfileView {
  const snapshot: MemberProfileSnapshot = {
    fullName: member.fullName,
    dateOfBirth: member.dateOfBirth,
    province: member.province,
  };
  const missing = missingMandatoryProfileFields(snapshot);
  return {
    memberId: member.id,
    phone: member.phone,
    fullName: member.fullName,
    dateOfBirth: toDateOnlyString(member.dateOfBirth),
    province: member.province,
    profileUpdatedAt: member.profileUpdatedAt,
    mandatoryFields: MANDATORY_PROFILE_FIELDS,
    missingMandatoryFields: missing,
    profileComplete: missing.length === 0,
  };
}
