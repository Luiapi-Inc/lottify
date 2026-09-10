import { describe, expect, it } from "vitest";
import {
  assertEntitlementTransition,
  canTransitionEntitlement,
  decidePromotionEligibility,
  entitlementAllowedActions,
  entitlementExpiryFor,
  isEntitlementTerminal,
  remainingEntitlementBonusMinor,
  resolvePromotionStacking,
  type PromotionStackingCandidateFact,
} from "../../src/contexts/promotion/domain/entitlement-snapshot";
import { PromotionRuleError } from "../../src/contexts/promotion/domain/rule-error";
import { validTerms } from "../support/promotion-fixtures";

const NOW = new Date("2026-10-15T12:00:00.000Z");

function candidate(
  overrides: Partial<PromotionStackingCandidateFact> & { campaignVersionId: string },
): PromotionStackingCandidateFact {
  return {
    campaignCode: `CODE-${overrides.campaignVersionId}`,
    campaignVersion: 1,
    mode: "STACKABLE",
    priority: 0,
    compatibilityGroup: null,
    expiresAt: null,
    ...overrides,
  };
}

describe("Promotion stacking resolution", () => {
  it("resolves conflicts deterministically by priority, expiry, code, version then id", () => {
    const candidates = [
      candidate({ campaignVersionId: "b", campaignCode: "B", priority: 5, expiresAt: new Date("2026-12-01T00:00:00.000Z") }),
      candidate({ campaignVersionId: "a", campaignCode: "A", priority: 5, expiresAt: new Date("2026-11-01T00:00:00.000Z") }),
      candidate({ campaignVersionId: "c", campaignCode: "C", priority: 9 }),
    ];
    const forward = resolvePromotionStacking(candidates);
    const reversed = resolvePromotionStacking([...candidates].reverse());
    expect(forward.granted.map((entry) => entry.campaignVersionId)).toEqual(["c"]);
    // Only one ungrouped stackable Campaign may be held; the input order must not
    // change which one wins.
    expect(reversed.granted.map((entry) => entry.campaignVersionId)).toEqual(["c"]);
    expect(forward.suppressed.map((entry) => entry.campaignVersionId)).toEqual(
      reversed.suppressed.map((entry) => entry.campaignVersionId),
    );
  });

  it("lets an exclusive Campaign suppress every lower-ranked Campaign", () => {
    const decision = resolvePromotionStacking([
      candidate({
        campaignVersionId: "exclusive",
        campaignCode: "A-EXCL",
        mode: "EXCLUSIVE",
        priority: 10,
      }),
      candidate({
        campaignVersionId: "stackable",
        campaignCode: "B-STACK",
        priority: 5,
        compatibilityGroup: "welcome",
      }),
    ]);
    expect(decision.granted.map((entry) => entry.campaignVersionId)).toEqual(["exclusive"]);
    expect(decision.suppressed).toEqual([
      {
        campaignVersionId: "stackable",
        campaignCode: "B-STACK",
        reason: "SUPPRESSED_BY_EXCLUSIVE",
        holderCampaignVersionId: "exclusive",
      },
    ]);
  });

  it("combines stackable Campaigns only within one explicit compatibility group", () => {
    const decision = resolvePromotionStacking([
      candidate({ campaignVersionId: "g1", campaignCode: "A", compatibilityGroup: "group-1" }),
      candidate({ campaignVersionId: "g2", campaignCode: "B", compatibilityGroup: "group-1" }),
      candidate({ campaignVersionId: "g3", campaignCode: "C", compatibilityGroup: "group-2" }),
      candidate({ campaignVersionId: "loose", campaignCode: "D", compatibilityGroup: null }),
    ]);
    expect(decision.granted.map((entry) => entry.campaignVersionId)).toEqual(["g1", "g3", "loose"]);
    expect(decision.suppressed).toEqual([
      {
        campaignVersionId: "g2",
        campaignCode: "B",
        reason: "STACKABLE_GROUP_CONFLICT",
        holderCampaignVersionId: "g1",
      },
    ]);
  });

  it("never grants a second ungrouped stackable Campaign", () => {
    const decision = resolvePromotionStacking([
      candidate({ campaignVersionId: "a", campaignCode: "A" }),
      candidate({ campaignVersionId: "b", campaignCode: "B" }),
    ]);
    expect(decision.granted.map((entry) => entry.campaignVersionId)).toEqual(["a"]);
    expect(decision.suppressed[0]?.reason).toBe("STACKABLE_REQUIRES_COMPATIBILITY_GROUP");
  });
});

describe("Promotion eligibility decisions", () => {
  const version = {
    id: "version-1",
    state: "PUBLISHED" as const,
    effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
    effectiveUntil: null,
  };

  it("is eligible only for an effective Campaign, a matching Member and no prior grant", () => {
    const decision = decidePromotionEligibility({
      version,
      terms: validTerms(),
      facts: { memberId: "member-1", status: "ACTIVE" },
      heldCampaignVersionIds: [],
      at: NOW,
    });
    expect(decision).toEqual({ eligible: true, reasons: [] });
  });

  it("reports every independent reason a Member cannot claim", () => {
    const decision = decidePromotionEligibility({
      version: { ...version, state: "VALIDATED" as const },
      terms: validTerms({
        eligibility: { requiredMemberStatus: "ACTIVE", excludedMemberIds: ["member-1"] },
      }),
      facts: { memberId: "member-1", status: "SUSPENDED" },
      heldCampaignVersionIds: ["version-1"],
      at: NOW,
    });
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toEqual([
      "CAMPAIGN_NOT_EFFECTIVE",
      "MEMBER_STATUS_MISMATCH",
      "MEMBER_EXCLUDED",
      "CAMPAIGN_VERSION_ALREADY_GRANTED",
    ]);
  });
});

describe("Promotion Entitlement lifecycle", () => {
  it("locks the ACTIVE → RELEASE_PENDING → COMPLETED transition path", () => {
    expect(canTransitionEntitlement("ACTIVE", "RELEASE_PENDING")).toBe(true);
    expect(canTransitionEntitlement("RELEASE_PENDING", "COMPLETED")).toBe(true);
    // Completion cannot be reached without passing through the release state.
    expect(canTransitionEntitlement("ACTIVE", "COMPLETED")).toBe(false);
    expect(canTransitionEntitlement("COMPLETED", "ACTIVE")).toBe(false);
    expect(canTransitionEntitlement("EXPIRED", "COMPLETED")).toBe(false);
    expect(() => assertEntitlementTransition("ACTIVE", "COMPLETED")).toThrow(PromotionRuleError);
    expect(entitlementAllowedActions("ACTIVE")).toEqual(["RELEASE_PENDING", "EXPIRED", "REVOKED"]);
    expect(entitlementAllowedActions("COMPLETED")).toEqual([]);
    expect(isEntitlementTerminal("COMPLETED")).toBe(true);
    expect(isEntitlementTerminal("ACTIVE")).toBe(false);
  });

  it("derives the expiry instant from the snapshotted grant time and expiry window", () => {
    const grantedAt = new Date("2026-10-15T00:00:00.000Z");
    expect(entitlementExpiryFor(validTerms({ expiryDaysAfterGrant: 30 }), grantedAt).toISOString()).toBe(
      "2026-11-14T00:00:00.000Z",
    );
  });

  it("tracks only the value still traceable to the Entitlement", () => {
    expect(
      remainingEntitlementBonusMinor({ rewardMinor: 50_000n, releasedMinor: 20_000n, expiredMinor: 0n }),
    ).toBe(30_000n);
    expect(
      remainingEntitlementBonusMinor({ rewardMinor: 50_000n, releasedMinor: 50_000n, expiredMinor: 0n }),
    ).toBe(0n);
    expect(
      remainingEntitlementBonusMinor({ rewardMinor: 50_000n, releasedMinor: 60_000n, expiredMinor: 0n }),
    ).toBe(0n);
  });
});
