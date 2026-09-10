import { describe, expect, it } from "vitest";
import { OnboardingRuleError } from "../../src/contexts/member/domain/onboarding-error";
import {
  assertEffectiveWindow,
  assertExpectedRevision,
  assertTermsDocumentContentValid,
  assertTermsDocumentTransition,
  isTermsDocumentEffective,
  termsDocumentDigest,
} from "../../src/contexts/member/domain/terms-document";

/**
 * Requirements traced here:
 * - Ticket 06: required Terms acceptance is an explicit readiness requirement,
 *   so the required version must be determinable from the document state and
 *   effective window (not from a flag).
 * - Ticket 11: `OTP → required Terms acceptance → profile`; a Member accepts a
 *   specific version, so the accepted content must be reproducible later.
 * - Ticket 16: determinism — the same Terms content always produces the same
 *   digest, and an invalid lifecycle transition is refused, not tolerated.
 */
describe("Member Terms document domain", () => {
  const content = {
    code: "MEMBER_TERMS",
    version: 3,
    title: "ข้อตกลงการใช้งาน",
    body: "Members accept these terms.",
  };

  it("produces a stable sha-256 digest over the accepted content", () => {
    const digest = termsDocumentDigest(content);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(termsDocumentDigest({ ...content })).toBe(digest);
    // Field order must not change the digest.
    expect(
      termsDocumentDigest({ body: content.body, title: content.title, version: 3, code: content.code }),
    ).toBe(digest);
  });

  it("changes the digest when the accepted text, title, code or version changes", () => {
    const digest = termsDocumentDigest(content);
    expect(termsDocumentDigest({ ...content, body: `${content.body} ` })).not.toBe(digest);
    expect(termsDocumentDigest({ ...content, title: "อื่น" })).not.toBe(digest);
    expect(termsDocumentDigest({ ...content, version: 4 })).not.toBe(digest);
    expect(termsDocumentDigest({ ...content, code: "OTHER" })).not.toBe(digest);
  });

  it("refuses a Terms version without usable content", () => {
    expect(() => assertTermsDocumentContentValid({ ...content, title: "   " })).toThrow(
      OnboardingRuleError,
    );
    expect(() => assertTermsDocumentContentValid({ ...content, body: "" })).toThrow(
      OnboardingRuleError,
    );
    expect(() => assertTermsDocumentContentValid({ ...content, version: 0 })).toThrow(
      OnboardingRuleError,
    );
    expect(() => assertTermsDocumentContentValid({ ...content, code: " " })).toThrow(
      OnboardingRuleError,
    );
  });

  it("allows only DRAFT→PUBLISHED and PUBLISHED→RETIRED", () => {
    expect(() => assertTermsDocumentTransition("DRAFT", "PUBLISHED")).not.toThrow();
    expect(() => assertTermsDocumentTransition("PUBLISHED", "RETIRED")).not.toThrow();
    expect(() => assertTermsDocumentTransition("DRAFT", "RETIRED")).toThrow(OnboardingRuleError);
    expect(() => assertTermsDocumentTransition("PUBLISHED", "PUBLISHED")).toThrow(
      OnboardingRuleError,
    );
    expect(() => assertTermsDocumentTransition("RETIRED", "PUBLISHED")).toThrow(
      OnboardingRuleError,
    );
  });

  it("treats only a published version inside its effective window as required", () => {
    const at = new Date("2026-09-10T00:00:00.000Z");
    expect(
      isTermsDocumentEffective(
        { state: "PUBLISHED", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveUntil: null },
        at,
      ),
    ).toBe(true);
    expect(
      isTermsDocumentEffective(
        {
          state: "PUBLISHED",
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveUntil: new Date("2026-09-01T00:00:00.000Z"),
        },
        at,
      ),
    ).toBe(false);
    expect(
      isTermsDocumentEffective(
        {
          state: "PUBLISHED",
          effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
          effectiveUntil: null,
        },
        at,
      ),
    ).toBe(false);
    expect(
      isTermsDocumentEffective(
        {
          state: "DRAFT",
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveUntil: null,
        },
        at,
      ),
    ).toBe(false);
    expect(
      isTermsDocumentEffective(
        {
          state: "RETIRED",
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveUntil: null,
        },
        at,
      ),
    ).toBe(false);
  });

  it("rejects an inverted effective window and a stale expected revision", () => {
    expect(() =>
      assertEffectiveWindow(
        new Date("2026-10-01T00:00:00.000Z"),
        new Date("2026-10-01T00:00:00.000Z"),
      ),
    ).toThrow(OnboardingRuleError);
    expect(() => assertExpectedRevision(2, 2)).not.toThrow();
    expect(() => assertExpectedRevision(3, 2)).toThrow(OnboardingRuleError);
    try {
      assertExpectedRevision(3, 2);
    } catch (error) {
      expect((error as OnboardingRuleError).code).toBe("VERSION_CONFLICT");
    }
  });
});
