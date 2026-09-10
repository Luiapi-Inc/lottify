import { OnboardingRuleError } from "./onboarding-error";

/**
 * Mandatory Member profile data (Ticket 06: capability readiness is derived from
 * explicit requirements — "mandatory profile fields" is one of them — rather
 * than one `onboardingCompleted` flag; Ticket 11: `OTP → Terms → profile`).
 *
 * The locked source does not enumerate the mandatory field set, so this
 * implementation decision is recorded in
 * `docs/implementation/member-onboarding-decisions.md`: the three fields the
 * locked Member prototype collects (name, date of birth, province). Age and
 * jurisdiction *eligibility* is a separate requirement evaluated by the
 * capability-readiness slice (Issue 64 item 5) — this module only validates the
 * data itself and never invents an age threshold.
 *
 * `phone` is the Member's login identity owned by Identity & Access: it is
 * readable here, but it is never a profile field a client may assert.
 */
export const MANDATORY_PROFILE_FIELDS = ["fullName", "dateOfBirth", "province"] as const;
export type MandatoryProfileField = (typeof MANDATORY_PROFILE_FIELDS)[number];

export const FULL_NAME_MAX_LENGTH = 200;
export const PROVINCE_MAX_LENGTH = 100;

/**
 * Sanity bound for the stored birth date, not an eligibility threshold: it
 * rejects obviously malformed input (typos, month/day swaps) without inventing
 * an age policy that Ticket 06 leaves to the eligibility slice.
 */
export const MIN_PLAUSIBLE_BIRTH_DATE = "1900-01-01";

/**
 * Fields a client may never assert. They are either Identity & Access state
 * (`phone`, `status`), Terms state (`termsAccepted`) or derived/trusted facts.
 * A PATCH carrying any of them is a client error, never a silent no-op.
 */
export const SERVER_OWNED_PROFILE_FIELDS = [
  "id",
  "memberId",
  "phone",
  "status",
  "role",
  "kycStatus",
  "kycTier",
  "verifiedPhone",
  "onboardingCompleted",
  "termsAccepted",
  "termsAcceptedAt",
  "profileUpdatedAt",
  "createdAt",
  "updatedAt",
] as const;

export interface MemberProfileSnapshot {
  readonly fullName: string | null;
  readonly dateOfBirth: Date | null;
  readonly province: string | null;
}

export interface MemberProfilePatch {
  readonly fullName?: string | null;
  readonly dateOfBirth?: Date | null;
  readonly province?: string | null;
}

export interface RawMemberProfilePatch {
  readonly fullName?: string | null;
  readonly dateOfBirth?: string | null;
  readonly province?: string | null;
}

export function missingMandatoryProfileFields(
  profile: MemberProfileSnapshot,
): MandatoryProfileField[] {
  const missing: MandatoryProfileField[] = [];
  if (!profile.fullName?.trim()) missing.push("fullName");
  if (!profile.dateOfBirth) missing.push("dateOfBirth");
  if (!profile.province?.trim()) missing.push("province");
  return missing;
}

/**
 * Validates and normalizes a profile patch. `null` (or an all-whitespace string)
 * clears a field, which is allowed here and reported as missing by
 * `missingMandatoryProfileFields` — clearing never fabricates completeness.
 */
export function normalizeProfilePatch(
  patch: RawMemberProfilePatch,
  now: Date = new Date(),
): MemberProfilePatch {
  const normalized: {
    fullName?: string | null;
    dateOfBirth?: Date | null;
    province?: string | null;
  } = {};

  if (patch.fullName !== undefined) {
    normalized.fullName = normalizeText(
      patch.fullName,
      "fullName",
      FULL_NAME_MAX_LENGTH,
    );
  }
  if (patch.province !== undefined) {
    normalized.province = normalizeText(
      patch.province,
      "province",
      PROVINCE_MAX_LENGTH,
    );
  }
  if (patch.dateOfBirth !== undefined) {
    normalized.dateOfBirth =
      patch.dateOfBirth === null || patch.dateOfBirth.trim() === ""
        ? null
        : parseBirthDate(patch.dateOfBirth, now);
  }

  if (Object.keys(normalized).length === 0) {
    throw new OnboardingRuleError(
      "VALIDATION_ERROR",
      "At least one profile field must be provided",
      { field: "body" },
    );
  }
  return normalized;
}

/** Rejects a patch that tries to assert a server-owned/trusted fact. */
export function assertNoServerOwnedProfileFields(input: Record<string, unknown>): void {
  const asserted = SERVER_OWNED_PROFILE_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(input, field),
  );
  if (asserted.length > 0) {
    throw new OnboardingRuleError(
      "VALIDATION_ERROR",
      "Server-owned Member facts cannot be set through the Member profile",
      { fields: asserted },
    );
  }
}

export function parseBirthDate(value: string, now: Date = new Date()): Date {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new OnboardingRuleError(
      "VALIDATION_ERROR",
      "dateOfBirth must be a calendar date in YYYY-MM-DD form",
      { field: "dateOfBirth" },
    );
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new OnboardingRuleError(
      "VALIDATION_ERROR",
      "dateOfBirth must be a real calendar date",
      { field: "dateOfBirth" },
    );
  }
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (parsed.getTime() > today.getTime()) {
    throw new OnboardingRuleError("VALIDATION_ERROR", "dateOfBirth cannot be in the future", {
      field: "dateOfBirth",
    });
  }
  if (parsed.getTime() < new Date(`${MIN_PLAUSIBLE_BIRTH_DATE}T00:00:00.000Z`).getTime()) {
    throw new OnboardingRuleError(
      "VALIDATION_ERROR",
      `dateOfBirth cannot be earlier than ${MIN_PLAUSIBLE_BIRTH_DATE}`,
      { field: "dateOfBirth" },
    );
  }
  return parsed;
}

/** Date-only projection (`YYYY-MM-DD`) — a birth date is a calendar fact. */
export function toDateOnlyString(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

function normalizeText(value: string | null, field: string, maxLength: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new OnboardingRuleError("VALIDATION_ERROR", `${field} must be a string`, { field });
  }
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > maxLength) {
    throw new OnboardingRuleError(
      "VALIDATION_ERROR",
      `${field} must be at most ${maxLength} characters`,
      { field },
    );
  }
  return trimmed;
}
