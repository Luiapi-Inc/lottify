import { describe, expect, it } from "vitest";
import {
  createEligibilityDecision,
  ELIGIBILITY_DECISION_OUTCOMES,
  isEligibilityDecisionFresh,
} from "../../src/contexts/kyc-risk/domain/eligibility-decision";

const EVALUATED_AT = new Date("2026-09-04T04:30:00.000Z");
const VALID_UNTIL = new Date("2026-09-04T04:35:00.000Z");

describe("eligibility decision", () => {
  it("uses the locked machine-readable outcomes", () => {
    expect(ELIGIBILITY_DECISION_OUTCOMES).toEqual([
      "ALLOW",
      "DENY",
      "REVIEW_REQUIRED",
      "CHALLENGE/REAUTH_REQUIRED",
    ]);
  });

  it("retains capability, reasons, policy version, evidence and evaluation window", () => {
    const decision = createEligibilityDecision({
      capability: "BET",
      outcome: "DENY",
      reasonCodes: ["SELF_EXCLUSION"],
      policyVersion: "eligibility-policy:v7",
      evidenceRefs: ["restriction:self-exclusion-123"],
      evaluatedAt: EVALUATED_AT,
      validUntil: VALID_UNTIL,
    });

    expect(decision).toEqual({
      capability: "BET",
      outcome: "DENY",
      reasonCodes: ["SELF_EXCLUSION"],
      policyVersion: "eligibility-policy:v7",
      evidenceRefs: ["restriction:self-exclusion-123"],
      evaluatedAt: EVALUATED_AT,
      validUntil: VALID_UNTIL,
    });
  });

  it("is fresh only inside its bounded point-in-time decision window", () => {
    const decision = createEligibilityDecision({
      capability: "WITHDRAW",
      outcome: "REVIEW_REQUIRED",
      policyVersion: "withdrawal-policy:v3",
      evaluatedAt: EVALUATED_AT,
      validUntil: VALID_UNTIL,
    });

    expect(
      isEligibilityDecisionFresh(
        decision,
        new Date("2026-09-04T04:32:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isEligibilityDecisionFresh(
        decision,
        new Date("2026-09-04T04:29:59.999Z"),
      ),
    ).toBe(false);
    expect(isEligibilityDecisionFresh(decision, VALID_UNTIL)).toBe(false);
  });

  it("rejects an unbounded-by-time decision window", () => {
    expect(() =>
      createEligibilityDecision({
        capability: "DEPOSIT",
        outcome: "ALLOW",
        policyVersion: "deposit-policy:v2",
        evaluatedAt: EVALUATED_AT,
        validUntil: EVALUATED_AT,
      }),
    ).toThrow("freshness window");
  });
});
