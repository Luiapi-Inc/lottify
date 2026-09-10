import { describe, expect, it } from "vitest";
import { OnboardingRuleError } from "../../src/contexts/member/domain/onboarding-error";
import {
  assertNoServerOwnedProfileFields,
  MANDATORY_PROFILE_FIELDS,
  missingMandatoryProfileFields,
  normalizeProfilePatch,
  parseBirthDate,
  toDateOnlyString,
} from "../../src/contexts/member/domain/profile-fields";

/**
 * Requirements traced here:
 * - Ticket 06: "mandatory profile fields" is an explicit readiness requirement,
 *   so which fields are missing must be derivable and never assumed complete.
 * - Ticket 06: a Member readiness decision is capability-based, so this module
 *   validates profile DATA only and never invents an age/jurisdiction threshold.
 * - Ticket 11: `phone` is the login identity, verified by OTP; it is not a
 *   profile field a client may assert.
 */
describe("Member profile fields", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");

  it("reports exactly the mandatory fields that have no stored value", () => {
    expect(missingMandatoryProfileFields({ fullName: null, dateOfBirth: null, province: null })).toEqual([
      ...MANDATORY_PROFILE_FIELDS,
    ]);
    expect(
      missingMandatoryProfileFields({
        fullName: "  ",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        province: "กรุงเทพมหานคร",
      }),
    ).toEqual(["fullName"]);
    expect(
      missingMandatoryProfileFields({
        fullName: "คุณ สมาชิก",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        province: "กรุงเทพมหานคร",
      }),
    ).toEqual([]);
  });

  it("normalizes a patch, trims text and treats blank input as clearing the field", () => {
    expect(normalizeProfilePatch({ fullName: "  คุณ สมาชิก  " }, now)).toEqual({
      fullName: "คุณ สมาชิก",
    });
    expect(normalizeProfilePatch({ province: "   " }, now)).toEqual({ province: null });
    expect(normalizeProfilePatch({ fullName: null }, now)).toEqual({ fullName: null });
    expect(normalizeProfilePatch({ dateOfBirth: "1990-01-01" }, now)).toEqual({
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
    });
    expect(normalizeProfilePatch({ dateOfBirth: "" }, now)).toEqual({ dateOfBirth: null });
  });

  it("refuses a patch with no editable field and out-of-range text", () => {
    expect(() => normalizeProfilePatch({}, now)).toThrow(OnboardingRuleError);
    expect(() => normalizeProfilePatch({ fullName: "x".repeat(201) }, now)).toThrow(
      OnboardingRuleError,
    );
  });

  it("validates the birth date as a real calendar date without inventing an age policy", () => {
    expect(toDateOnlyString(parseBirthDate("1990-02-28", now))).toBe("1990-02-28");
    // Today is allowed; anything after it is not.
    expect(() => parseBirthDate("2026-09-11", now)).toThrow(OnboardingRuleError);
    expect(toDateOnlyString(parseBirthDate("2026-09-10", now))).toBe("2026-09-10");
    expect(() => parseBirthDate("2026-02-30", now)).toThrow(OnboardingRuleError);
    expect(() => parseBirthDate("01/01/1990", now)).toThrow(OnboardingRuleError);
    expect(() => parseBirthDate("1899-12-31", now)).toThrow(OnboardingRuleError);
    expect(toDateOnlyString(null)).toBeNull();
  });

  it("never accepts a client-asserted trusted fact as profile data", () => {
    expect(() => assertNoServerOwnedProfileFields({ fullName: "ok" })).not.toThrow();
    for (const field of ["phone", "status", "kycStatus", "termsAccepted", "memberId", "id"]) {
      expect(() => assertNoServerOwnedProfileFields({ [field]: "anything" })).toThrow(
        OnboardingRuleError,
      );
    }
    try {
      assertNoServerOwnedProfileFields({ phone: "+66812345678", status: "ACTIVE" });
    } catch (error) {
      expect((error as OnboardingRuleError).details.fields).toEqual(["phone", "status"]);
    }
  });
});
