import { describe, expect, it } from "vitest";
import { isCapabilityBlocked } from "../../src/contexts/member/domain/capability-restriction";
import {
  createSelfExclusionBetRestriction,
  normalAdminRemovalDisposition,
} from "../../src/contexts/member/domain/self-exclusion";
import { resolveEligibilityDecision } from "../../src/contexts/kyc-risk/domain/eligibility-policy";
import { evaluateSelfExclusionPolicy } from "../../src/contexts/kyc-risk/domain/self-exclusion-policy";

const ACTIVATED_AT = new Date("2026-09-06T11:00:00.000Z");
const VALID_UNTIL = new Date("2026-09-06T11:05:00.000Z");

function selfExclusion(effectiveUntil: Date | null = null) {
  return createSelfExclusionBetRestriction({
    activatedAt: ACTIVATED_AT,
    effectiveUntil,
    reason: "member self-exclusion",
    actorOrPolicyRef: "self-exclusion:case-1",
  });
}

describe("responsible-gaming self-exclusion enforcement", () => {
  it("blocks betting immediately at the self-exclusion activation instant", () => {
    const restriction = selfExclusion();

    expect(restriction).toEqual(
      expect.objectContaining({
        type: "BET_BLOCKED",
        source: "self-exclusion",
        effectiveFrom: ACTIVATED_AT,
        actorOrPolicyRef: "self-exclusion:case-1",
      }),
    );
    expect(isCapabilityBlocked("BET", [restriction], ACTIVATED_AT)).toBe(true);
  });

  it("uses explicit half-open expiry semantics for a time-bounded self-exclusion", () => {
    const expiry = new Date("2026-09-07T11:00:00.000Z");
    const restriction = selfExclusion(expiry);

    expect(
      isCapabilityBlocked(
        "BET",
        [restriction],
        new Date("2026-09-07T10:59:59.999Z"),
      ),
    ).toBe(true);
    expect(isCapabilityBlocked("BET", [restriction], expiry)).toBe(false);
  });

  it("does not turn self-exclusion into an automatic withdrawal block", () => {
    const restriction = selfExclusion();

    expect(isCapabilityBlocked("BET", [restriction], ACTIVATED_AT)).toBe(true);
    expect(isCapabilityBlocked("WITHDRAWAL", [restriction], ACTIVATED_AT)).toBe(false);
  });

  it("denies removal through the normal Admin restriction path", () => {
    expect(normalAdminRemovalDisposition(selfExclusion())).toBe(
      "DENY_SELF_EXCLUSION",
    );
  });

  it("keeps active self-exclusion authoritative over lower-priority eligibility layers", () => {
    const selfExclusionLayer = evaluateSelfExclusionPolicy({
      active: true,
      evidenceRefs: ["self-exclusion:case-1"],
    });

    const decision = resolveEligibilityDecision({
      capability: "BET",
      policyVersion: "bet-eligibility:v5",
      evaluatedAt: ACTIVATED_AT,
      validUntil: VALID_UNTIL,
      layers: {
        HARD_RESTRICTION_OR_SELF_EXCLUSION: selfExclusionLayer,
        COMPLIANCE: {
          outcome: "ALLOW",
          reasonCodes: [],
          evidenceRefs: [],
        },
        RISK: {
          outcome: "ALLOW",
          reasonCodes: [],
          evidenceRefs: [],
        },
        CAPABILITY_POLICY: {
          outcome: "ALLOW",
          reasonCodes: [],
          evidenceRefs: [],
        },
      },
    });

    expect(decision).toEqual(
      expect.objectContaining({
        capability: "BET",
        outcome: "DENY",
        reasonCodes: ["SELF_EXCLUSION"],
        evidenceRefs: ["self-exclusion:case-1"],
      }),
    );
  });

  it("requires traceable reason/evidence and rejects invalid expiry", () => {
    expect(() =>
      createSelfExclusionBetRestriction({
        activatedAt: ACTIVATED_AT,
        effectiveUntil: null,
        reason: "",
        actorOrPolicyRef: "self-exclusion:case-1",
      }),
    ).toThrow("requires a reason");

    expect(() =>
      createSelfExclusionBetRestriction({
        activatedAt: ACTIVATED_AT,
        effectiveUntil: null,
        reason: "member self-exclusion",
        actorOrPolicyRef: "",
      }),
    ).toThrow("requires a policy or evidence reference");

    expect(() => selfExclusion(ACTIVATED_AT)).toThrow(
      "expiry must be after activation",
    );
  });
});
