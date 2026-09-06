import { describe, expect, it } from "vitest";
import {
  createPublishedBetTypeVersion,
  createPublishedLotteryProductVersion,
  type PublishedBetTypeVersion,
} from "../../src/contexts/lottery/domain/configuration-version";
import {
  createDrawConfigurationSnapshot,
  DrawConfigurationSnapshotMismatchError,
} from "../../src/contexts/lottery/domain/draw-configuration-snapshot";

interface PayoutTerms {
  readonly multiplier: number;
  readonly currency: string;
}

const EFFECTIVE_FROM = new Date("2026-09-07T00:00:00.000Z");

function betTypeVersion(
  input: {
    readonly id: string;
    readonly betTypeId: string;
    readonly code: string;
    readonly payout: PayoutTerms;
    readonly minStakeMinor?: bigint;
    readonly maxStakeMinor?: bigint;
  },
): PublishedBetTypeVersion<PayoutTerms> {
  return createPublishedBetTypeVersion({
    id: input.id,
    betType: { id: input.betTypeId, code: input.code },
    canonicalNumberFormat: "NNN",
    validationPattern: "^[0-9]{3}$",
    defaultPayout: input.payout,
    minStakeMinor: input.minStakeMinor ?? 100n,
    maxStakeMinor: input.maxStakeMinor ?? 10_000n,
    limitPolicyRef: `limit:${input.id}`,
    restrictionPolicyRef: `restriction:${input.id}`,
    settlementRuleVersionRef: `settlement:${input.id}`,
  });
}

function productVersion(input: {
  readonly id: string;
  readonly enabledBetTypes: readonly {
    readonly betTypeId: string;
    readonly betTypeVersionId: string;
  }[];
  readonly timezone?: string;
}) {
  return createPublishedLotteryProductVersion({
    id: input.id,
    productId: "product:thai-government",
    timezone: input.timezone ?? "Asia/Bangkok",
    enabledBetTypes: input.enabledBetTypes,
    scheduleTemplateRef: `schedule:${input.id}`,
    resultSchemaVersionRef: `result-schema:${input.id}`,
    settlementRuleVersionRef: `settlement-product:${input.id}`,
    defaultPayoutPolicyRef: `payout-policy:${input.id}`,
    defaultLimitPolicyRef: `limit-policy:${input.id}`,
    defaultRestrictionPolicyRef: `restriction-policy:${input.id}`,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveUntil: null,
  });
}

describe("Lottery Product / Bet Type versions and Draw snapshot", () => {
  it("keeps Bet Type stable identity/code separate from immutable versioned configuration", () => {
    const v1 = betTypeVersion({
      id: "bet-type-version:3top:v1",
      betTypeId: "bet-type:3top",
      code: "3TOP",
      payout: { multiplier: 500, currency: "THB" },
    });
    const v2 = betTypeVersion({
      id: "bet-type-version:3top:v2",
      betTypeId: "bet-type:3top",
      code: "3TOP",
      payout: { multiplier: 550, currency: "THB" },
    });

    expect(v1.betType).toEqual(v2.betType);
    expect(v1.id).not.toBe(v2.id);
    expect(v1.defaultPayout).toEqual({ multiplier: 500, currency: "THB" });
    expect(v2.defaultPayout).toEqual({ multiplier: 550, currency: "THB" });
    expect(Object.isFrozen(v1.defaultPayout)).toBe(true);
    expect(Object.isFrozen(v1.betType)).toBe(true);
  });

  it("snapshots the exact Product and enabled Bet Type versions with payout, limits, restrictions, timezone and rule refs", () => {
    const threeTop = betTypeVersion({
      id: "bet-type-version:3top:v1",
      betTypeId: "bet-type:3top",
      code: "3TOP",
      payout: { multiplier: 500, currency: "THB" },
      minStakeMinor: 200n,
      maxStakeMinor: 5_000n,
    });
    const product = productVersion({
      id: "product-version:thai:v1",
      enabledBetTypes: [
        { betTypeId: threeTop.betType.id, betTypeVersionId: threeTop.id },
      ],
    });

    const snapshot = createDrawConfigurationSnapshot({
      productVersion: product,
      betTypeVersions: [threeTop],
    });

    expect(snapshot).toMatchObject({
      productId: "product:thai-government",
      productVersionId: "product-version:thai:v1",
      timezone: "Asia/Bangkok",
      scheduleTemplateRef: "schedule:product-version:thai:v1",
      resultSchemaVersionRef: "result-schema:product-version:thai:v1",
      settlementRuleVersionRef: "settlement-product:product-version:thai:v1",
      defaultPayoutPolicyRef: "payout-policy:product-version:thai:v1",
      defaultLimitPolicyRef: "limit-policy:product-version:thai:v1",
      defaultRestrictionPolicyRef: "restriction-policy:product-version:thai:v1",
    });
    expect(snapshot.betTypes).toEqual([
      expect.objectContaining({
        betTypeId: "bet-type:3top",
        betTypeCode: "3TOP",
        betTypeVersionId: "bet-type-version:3top:v1",
        payout: { multiplier: 500, currency: "THB" },
        minStakeMinor: 200n,
        maxStakeMinor: 5_000n,
        limitPolicyRef: "limit:bet-type-version:3top:v1",
        restrictionPolicyRef: "restriction:bet-type-version:3top:v1",
        settlementRuleVersionRef: "settlement:bet-type-version:3top:v1",
      }),
    ]);
    expect(Object.isFrozen(snapshot.betTypes)).toBe(true);
    expect(Object.isFrozen(snapshot.betTypes[0]?.payout)).toBe(true);
  });

  it("keeps an existing Draw snapshot unchanged when a later Product/Bet Type version changes payout and timezone", () => {
    const payoutV1 = { multiplier: 500, currency: "THB" };
    const betTypeV1 = betTypeVersion({
      id: "bet-type-version:3top:v1",
      betTypeId: "bet-type:3top",
      code: "3TOP",
      payout: payoutV1,
    });
    const productV1 = productVersion({
      id: "product-version:thai:v1",
      enabledBetTypes: [
        { betTypeId: betTypeV1.betType.id, betTypeVersionId: betTypeV1.id },
      ],
    });
    const existingDraw = createDrawConfigurationSnapshot({
      productVersion: productV1,
      betTypeVersions: [betTypeV1],
    });

    payoutV1.multiplier = 999;
    const betTypeV2 = betTypeVersion({
      id: "bet-type-version:3top:v2",
      betTypeId: "bet-type:3top",
      code: "3TOP",
      payout: { multiplier: 550, currency: "THB" },
    });
    const productV2 = productVersion({
      id: "product-version:thai:v2",
      timezone: "Asia/Ho_Chi_Minh",
      enabledBetTypes: [
        { betTypeId: betTypeV2.betType.id, betTypeVersionId: betTypeV2.id },
      ],
    });
    const futureDraw = createDrawConfigurationSnapshot({
      productVersion: productV2,
      betTypeVersions: [betTypeV2],
    });

    expect(existingDraw.productVersionId).toBe("product-version:thai:v1");
    expect(existingDraw.timezone).toBe("Asia/Bangkok");
    expect(existingDraw.betTypes[0]?.payout).toEqual({
      multiplier: 500,
      currency: "THB",
    });
    expect(futureDraw.productVersionId).toBe("product-version:thai:v2");
    expect(futureDraw.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(futureDraw.betTypes[0]?.payout).toEqual({
      multiplier: 550,
      currency: "THB",
    });
  });

  it("applies Bet Type disablement only to future Draw snapshots", () => {
    const threeTop = betTypeVersion({
      id: "bet-type-version:3top:v1",
      betTypeId: "bet-type:3top",
      code: "3TOP",
      payout: { multiplier: 500, currency: "THB" },
    });
    const twoTop = betTypeVersion({
      id: "bet-type-version:2top:v1",
      betTypeId: "bet-type:2top",
      code: "2TOP",
      payout: { multiplier: 90, currency: "THB" },
    });
    const productV1 = productVersion({
      id: "product-version:thai:v1",
      enabledBetTypes: [
        { betTypeId: threeTop.betType.id, betTypeVersionId: threeTop.id },
        { betTypeId: twoTop.betType.id, betTypeVersionId: twoTop.id },
      ],
    });
    const existingDraw = createDrawConfigurationSnapshot({
      productVersion: productV1,
      betTypeVersions: [threeTop, twoTop],
    });

    const productV2 = productVersion({
      id: "product-version:thai:v2",
      enabledBetTypes: [
        { betTypeId: threeTop.betType.id, betTypeVersionId: threeTop.id },
      ],
    });
    const futureDraw = createDrawConfigurationSnapshot({
      productVersion: productV2,
      betTypeVersions: [threeTop, twoTop],
    });

    expect(existingDraw.betTypes.map((betType) => betType.betTypeCode)).toEqual([
      "3TOP",
      "2TOP",
    ]);
    expect(futureDraw.betTypes.map((betType) => betType.betTypeCode)).toEqual([
      "3TOP",
    ]);
  });

  it("rejects a Draw snapshot when an enabled Bet Type cannot resolve its exact version", () => {
    const threeTopV1 = betTypeVersion({
      id: "bet-type-version:3top:v1",
      betTypeId: "bet-type:3top",
      code: "3TOP",
      payout: { multiplier: 500, currency: "THB" },
    });
    const threeTopV2 = betTypeVersion({
      id: "bet-type-version:3top:v2",
      betTypeId: "bet-type:3top",
      code: "3TOP",
      payout: { multiplier: 550, currency: "THB" },
    });
    const product = productVersion({
      id: "product-version:thai:v1",
      enabledBetTypes: [
        { betTypeId: threeTopV1.betType.id, betTypeVersionId: threeTopV1.id },
      ],
    });

    expect(() =>
      createDrawConfigurationSnapshot({
        productVersion: product,
        betTypeVersions: [threeTopV2],
      }),
    ).toThrow(DrawConfigurationSnapshotMismatchError);
  });

  it("rejects ambiguous duplicate enabled Bet Type references in one Product version", () => {
    expect(() =>
      productVersion({
        id: "product-version:thai:v1",
        enabledBetTypes: [
          {
            betTypeId: "bet-type:3top",
            betTypeVersionId: "bet-type-version:3top:v1",
          },
          {
            betTypeId: "bet-type:3top",
            betTypeVersionId: "bet-type-version:3top:v2",
          },
        ],
      }),
    ).toThrow("cannot enable Bet Type bet-type:3top more than once");
  });
});
