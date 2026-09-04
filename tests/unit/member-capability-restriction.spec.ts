import { describe, expect, it } from "vitest";
import {
  getEffectiveCapabilityRestrictions,
  isCapabilityBlocked,
  type MemberCapabilityRestriction,
  type MemberCapabilityRestrictionType,
} from "../../src/contexts/member/domain/capability-restriction";

const NOW = new Date("2026-09-04T04:30:00.000Z");

function restriction(
  type: MemberCapabilityRestrictionType,
  overrides: Partial<MemberCapabilityRestriction> = {},
): MemberCapabilityRestriction {
  return {
    type,
    source: "policy",
    reason: "test reason",
    effectiveFrom: new Date("2026-09-04T04:00:00.000Z"),
    effectiveUntil: null,
    actorOrPolicyRef: "policy:v1",
    ...overrides,
  };
}

describe("member capability restrictions", () => {
  it.each([
    ["BET", "BET_BLOCKED"],
    ["WITHDRAWAL", "WITHDRAWAL_BLOCKED"],
    ["DEPOSIT", "DEPOSIT_BLOCKED"],
    ["LOGIN", "LOGIN_BLOCKED"],
    ["PROMOTION", "PROMOTION_BLOCKED"],
  ] as const)("maps %s only to %s", (capability, restrictionType) => {
    const restrictions = [restriction(restrictionType)];

    expect(isCapabilityBlocked(capability, restrictions, NOW)).toBe(true);
  });

  it("keeps capability restrictions independent instead of using one account-wide status", () => {
    const restrictions = [restriction("BET_BLOCKED")];

    expect(isCapabilityBlocked("BET", restrictions, NOW)).toBe(true);
    expect(isCapabilityBlocked("WITHDRAWAL", restrictions, NOW)).toBe(false);
    expect(isCapabilityBlocked("DEPOSIT", restrictions, NOW)).toBe(false);
    expect(isCapabilityBlocked("LOGIN", restrictions, NOW)).toBe(false);
    expect(isCapabilityBlocked("PROMOTION", restrictions, NOW)).toBe(false);
  });

  it("ignores restrictions outside their effective period", () => {
    const restrictions = [
      restriction("BET_BLOCKED", {
        effectiveFrom: new Date("2026-09-04T05:00:00.000Z"),
      }),
      restriction("BET_BLOCKED", {
        effectiveUntil: new Date("2026-09-04T04:15:00.000Z"),
      }),
    ];

    expect(isCapabilityBlocked("BET", restrictions, NOW)).toBe(false);
  });

  it("preserves every active matching restriction and its policy evidence", () => {
    const restrictions = [
      restriction("BET_BLOCKED", {
        source: "self-exclusion",
        reason: "member self-exclusion",
        actorOrPolicyRef: "self-exclusion:case-1",
      }),
      restriction("BET_BLOCKED", {
        source: "risk-policy",
        reason: "hard risk restriction",
        actorOrPolicyRef: "risk-policy:v3",
      }),
      restriction("WITHDRAWAL_BLOCKED"),
    ];

    expect(getEffectiveCapabilityRestrictions("BET", restrictions, NOW)).toEqual([
      expect.objectContaining({
        source: "self-exclusion",
        reason: "member self-exclusion",
        actorOrPolicyRef: "self-exclusion:case-1",
      }),
      expect.objectContaining({
        source: "risk-policy",
        reason: "hard risk restriction",
        actorOrPolicyRef: "risk-policy:v3",
      }),
    ]);
  });
});
