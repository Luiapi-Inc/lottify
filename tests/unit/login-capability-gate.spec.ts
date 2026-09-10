import { describe, expect, it } from "vitest";
import type { MemberCapabilityRestriction } from "../../src/contexts/member/domain/capability-restriction";
import { createSelfExclusionBetRestriction } from "../../src/contexts/member/domain/self-exclusion";
import { evaluateLoginCapability } from "../../src/platform/integration/pre-auth-login-capability.adapter";

const NOW = new Date("2026-09-04T04:30:00.000Z");

function restriction(
  overrides: Partial<MemberCapabilityRestriction> = {},
): MemberCapabilityRestriction {
  return {
    type: "LOGIN_BLOCKED",
    source: "admin",
    reason: "operator suspension",
    effectiveFrom: new Date("2026-09-04T04:00:00.000Z"),
    effectiveUntil: null,
    actorOrPolicyRef: "admin:case-1",
    ...overrides,
  };
}

describe("pre-auth login capability gate", () => {
  it("allows login when the Member has no restriction", () => {
    expect(evaluateLoginCapability([], NOW)).toEqual({
      allowed: true,
      reasonCode: null,
      evidenceRefs: [],
    });
  });

  it("denies login for an effective LOGIN_BLOCKED restriction with a coded reason", () => {
    expect(evaluateLoginCapability([restriction()], NOW)).toEqual({
      allowed: false,
      reasonCode: "CAPABILITY_BLOCKED",
      evidenceRefs: ["admin:case-1"],
    });
  });

  it("never gates login on another capability's restriction", () => {
    const restrictions: MemberCapabilityRestriction[] = [
      restriction({ type: "BET_BLOCKED" }),
      restriction({ type: "WITHDRAWAL_BLOCKED" }),
      restriction({ type: "DEPOSIT_BLOCKED" }),
      restriction({ type: "PROMOTION_BLOCKED" }),
    ];

    expect(evaluateLoginCapability(restrictions, NOW).allowed).toBe(true);
  });

  it("does not gate login on a responsible-gaming self-exclusion, which blocks betting", () => {
    const selfExclusion = createSelfExclusionBetRestriction({
      activatedAt: new Date("2026-09-04T04:00:00.000Z"),
      effectiveUntil: null,
      reason: "member requested self-exclusion",
      actorOrPolicyRef: "self-exclusion:case-1",
    });

    expect(selfExclusion.type).toBe("BET_BLOCKED");
    expect(evaluateLoginCapability([selfExclusion], NOW).allowed).toBe(true);
  });

  it("reports SELF_EXCLUSION when the LOGIN restriction itself came from self-exclusion", () => {
    const decision = evaluateLoginCapability(
      [restriction({ source: "self-exclusion" })],
      NOW,
    );

    expect(decision).toEqual({
      allowed: false,
      reasonCode: "SELF_EXCLUSION",
      evidenceRefs: ["admin:case-1"],
    });
  });

  it("honours the effective period: not yet effective and expired restrictions do not gate", () => {
    expect(
      evaluateLoginCapability(
        [restriction({ effectiveFrom: new Date("2026-09-04T05:00:00.000Z") })],
        NOW,
      ).allowed,
    ).toBe(true);
    expect(
      evaluateLoginCapability(
        [restriction({ effectiveUntil: new Date("2026-09-04T04:15:00.000Z") })],
        NOW,
      ).allowed,
    ).toBe(true);
  });

  it("treats the effective window as half-open at its end instant", () => {
    expect(
      evaluateLoginCapability(
        [restriction({ effectiveUntil: NOW })],
        NOW,
      ).allowed,
    ).toBe(true);
  });
});
