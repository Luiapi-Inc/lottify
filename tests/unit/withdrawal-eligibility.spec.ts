import { describe, expect, it } from "vitest";
import {
  WITHDRAWAL_ELIGIBILITY_POLICY_VERSION,
  isWithdrawalEligibilityFresh,
  resolveWithdrawalEligibility,
  type WithdrawalEligibilityInput,
} from "../../src/contexts/payments/domain/withdrawal-eligibility";

const evaluatedAt = new Date("2026-09-10T10:00:00.000Z");
const validUntil = new Date("2026-09-10T10:05:00.000Z");

function input(overrides: Partial<WithdrawalEligibilityInput> = {}): WithdrawalEligibilityInput {
  return {
    policyVersion: WITHDRAWAL_ELIGIBILITY_POLICY_VERSION,
    evaluatedAt,
    validUntil,
    destination: { present: true, ownedByMember: true, verified: true, disabled: false },
    capability: { withdrawalBlocked: false },
    additionalReview: { required: false },
    ...overrides,
  };
}

describe("Withdrawal eligibility resolution", () => {
  it("allows an eligible withdrawal against a verified, owned destination", () => {
    const decision = resolveWithdrawalEligibility(input());
    expect(decision.outcome).toBe("ALLOW");
    expect(decision.reasonCodes).toEqual(["ELIGIBLE"]);
    expect(decision.policyVersion).toBe(WITHDRAWAL_ELIGIBILITY_POLICY_VERSION);
  });

  it("denies an unverified payout destination before any Reservation exists", () => {
    const decision = resolveWithdrawalEligibility(
      input({
        destination: { present: true, ownedByMember: true, verified: false, disabled: false },
      }),
    );
    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCodes).toContain("PAYOUT_DESTINATION_NOT_VERIFIED");
  });

  it("denies a destination the Member does not own or that is disabled", () => {
    expect(
      resolveWithdrawalEligibility(
        input({
          destination: { present: true, ownedByMember: false, verified: true, disabled: false },
        }),
      ).reasonCodes,
    ).toContain("PAYOUT_DESTINATION_UNAVAILABLE");
    expect(
      resolveWithdrawalEligibility(
        input({
          destination: { present: true, ownedByMember: true, verified: true, disabled: true },
        }),
      ).outcome,
    ).toBe("DENY");
    expect(
      resolveWithdrawalEligibility(
        input({
          destination: { present: false, ownedByMember: false, verified: false, disabled: false },
        }),
      ).outcome,
    ).toBe("DENY");
  });

  it("lets a withdrawal capability restriction outrank review and allow", () => {
    const decision = resolveWithdrawalEligibility(
      input({
        capability: { withdrawalBlocked: true, evidenceRefs: ["restriction:withdrawal-blocked"] },
        additionalReview: { required: true },
      }),
    );
    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCodes).toContain("CAPABILITY_RESTRICTION");
    expect(decision.evidenceRefs).toContain("restriction:withdrawal-blocked");
  });

  it("routes to review without denying when only additional review is required", () => {
    const decision = resolveWithdrawalEligibility(
      input({
        additionalReview: { required: true, reasonCodes: ["APPROVAL_THRESHOLD"] },
      }),
    );
    expect(decision.outcome).toBe("REVIEW_REQUIRED");
    expect(decision.reasonCodes).toContain("REVIEW_REQUIRED");
  });

  it("refuses a freshness window that does not end after evaluation", () => {
    expect(() =>
      resolveWithdrawalEligibility(input({ validUntil: evaluatedAt })),
    ).toThrow(/freshness window/);
  });

  it("evaluates decision freshness independently", () => {
    const decision = resolveWithdrawalEligibility(input());
    expect(isWithdrawalEligibilityFresh(decision, new Date("2026-09-10T10:04:59.000Z"))).toBe(true);
    expect(isWithdrawalEligibilityFresh(decision, new Date("2026-09-10T10:05:00.000Z"))).toBe(false);
  });
});
