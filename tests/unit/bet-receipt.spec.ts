import { describe, expect, it } from "vitest";
import {
  buildBetReceipt,
  InvalidBetReceiptError,
  type BetReceipt,
  type BuildBetReceiptInput,
} from "../../src/contexts/betting/domain/bet-receipt";

const terms = {
  productId: "product-1",
  productVersionId: "product-version-1",
  drawReference: "draw-42",
  drawCutoffAt: "2026-09-05T12:00:00.000Z",
  currency: "THB",
  totalStakeMinor: "3500",
  acceptedAt: "2026-09-05T11:59:00.000Z",
  lines: [
    {
      betTypeCode: "TWO_DIGIT",
      betTypeVersionId: "btv-1",
      canonicalNumber: "42",
      stakeMinor: "3500",
      resolvedPayout: { kind: "FIXED", amountMinor: "90000" },
    },
  ],
  acceptedRestrictions: ["MAX_AMOUNT:100000"],
};

function baseInput(overrides: Partial<BuildBetReceiptInput> = {}): BuildBetReceiptInput {
  return {
    orderId: "order-1",
    orderState: "CONFIRMED",
    orderVersion: 3,
    memberId: "member-1",
    terms,
    ...overrides,
  };
}

describe("Bet Receipt", () => {
  it("issues an immutable receipt for a CONFIRMED Order with the accepted terms", () => {
    const receipt = buildBetReceipt(baseInput());
    expect(receipt.id).toBe("order-1");
    expect(receipt.orderId).toBe("order-1");
    expect(receipt.memberId).toBe("member-1");
    expect(receipt.orderVersion).toBe(3);
    expect(receipt.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.terms.totalStakeMinor).toBe("3500");
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.terms)).toBe(true);
  });

  it("produces a stable digest for identical accepted terms", () => {
    const a = buildBetReceipt(baseInput());
    const b = buildBetReceipt(baseInput());
    expect(a.contentDigest).toBe(b.contentDigest);
  });

  it("changes the digest when accepted terms differ (immutability detectability)", () => {
    const a = buildBetReceipt(baseInput());
    const changed = buildBetReceipt(
      baseInput({
        terms: { ...terms, totalStakeMinor: "4000" },
      }),
    );
    expect(changed.contentDigest).not.toBe(a.contentDigest);
  });

  it("rejects a receipt for an Order that is not CONFIRMED", () => {
    expect(() => buildBetReceipt(baseInput({ orderState: "CONFIRMING" }))).toThrow(
      InvalidBetReceiptError,
    );
  });

  it("rejects a receipt for an Order with no accepted lines", () => {
    expect(() =>
      buildBetReceipt(
        baseInput({ terms: { ...terms, lines: [] } }),
      ),
    ).toThrow(/at least one line/);
  });

  it("rejects a negative or non-numeric stake", () => {
    expect(() =>
      buildBetReceipt(
        baseInput({
          terms: {
            ...terms,
            totalStakeMinor: "-3500",
          },
        }),
      ),
    ).toThrow(/non-negative integer minor-unit/);
  });

  it("rejects an invalid acceptedAt instant", () => {
    expect(() =>
      buildBetReceipt(baseInput({ terms: { ...terms, acceptedAt: "not-a-date" } })),
    ).toThrow(/valid instant/);
  });

  it("defends against mutation of the terms passed in by the caller", () => {
    const mutableTerms = {
      ...terms,
      lines: terms.lines.map((line) => ({ ...line })),
    };
    const receipt: BetReceipt = buildBetReceipt(
      baseInput({ terms: mutableTerms as typeof terms }),
    );
    mutableTerms.totalStakeMinor = "999999999";
    expect(receipt.terms.totalStakeMinor).toBe("3500");
  });
});
