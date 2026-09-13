import { describe, expect, it } from "vitest";
import { BettingQuoteService } from "../../src/contexts/betting/application/betting-quote.service";
import { BettingOrderService } from "../../src/contexts/betting/application/betting-order.service";
import { denyBetEligibility } from "../support/betting-eligibility.fake";

const NOW = new Date("2026-09-11T12:00:00.000Z");

describe("Betting eligibility execution gates", () => {
  it("denies Quote creation before Draw resolution when current BET eligibility is not ALLOW", async () => {
    const prisma = {
      bettingQuote: { findFirst: async () => null },
    };
    const drawSource = {
      loadEffectiveDraw: async () => {
        throw new Error("DRAW_SHOULD_NOT_BE_READ_BEFORE_ELIGIBILITY");
      },
    };
    const quotes = new (BettingQuoteService as any)(prisma, drawSource, denyBetEligibility);

    await expect(
      quotes.createQuote({
        memberId: "member-1",
        drawId: "draw-1",
        lines: [{ betTypeCode: "TWO_DIGIT", canonicalNumber: "42", stakeMinor: 100n }],
        currency: "THB",
        idempotencyKey: "quote-key-1",
        now: NOW,
      }),
    ).rejects.toMatchObject({
      code: "MEMBER_NOT_ELIGIBLE",
      status: 403,
      details: {
        outcome: "DENY",
        reasonCodes: ["KYC_REQUIRED"],
        policyVersion: "capability-readiness-policy-v1",
      },
    });
  });

  it("denies Confirm before Draw or Wallet work when current BET eligibility is not ALLOW", async () => {
    const drawSource = {
      loadEffectiveDraw: async () => {
        throw new Error("DRAW_SHOULD_NOT_BE_READ_BEFORE_ELIGIBILITY");
      },
    };
    const wallet = {
      commitStake: async () => {
        throw new Error("WALLET_SHOULD_NOT_BE_TOUCHED_BEFORE_ELIGIBILITY");
      },
    };
    const orders = new (BettingOrderService as any)(
      {},
      drawSource,
      wallet,
      denyBetEligibility,
    );

    const denial = await (orders as any).confirmDenial(
      {
        memberId: "member-1",
        drawId: "draw-1",
        quoteExpiresAt: new Date("2026-09-11T12:05:00.000Z"),
      },
      NOW,
    );

    expect(denial).toBe("MEMBER_NOT_ELIGIBLE");
  });
});
