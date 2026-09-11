import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const demoMarkers = [
  "02:00:34",
  "05:14:00",
  "QT-20260910",
  "ORD-20260910",
  "ทดสอบสถานะ Quote",
  "จำลองคืนเงินสำเร็จ",
];

describe("Member buy web live-data contract", () => {
  const buy = source("apps/member-web/app/buy/page.tsx");
  const bet = source("apps/member-web/app/buy/bet/bet-editor.tsx");
  const quote = source("apps/member-web/app/buy/quote/quote-review.tsx");
  const receipt = source("apps/member-web/app/buy/receipt/receipt-view.tsx");
  const criticalSources = [buy, bet, quote, receipt];

  it("does not ship the diagnosed demo fixtures in the critical purchase path", () => {
    for (const marker of demoMarkers) {
      for (const content of criticalSources) {
        expect(content).not.toContain(marker);
      }
    }
  });

  it("binds every critical purchase stage to the Member API", () => {
    expect(buy).toContain("memberApi.listProducts");
    expect(buy).toContain("memberApi.listProductDraws");
    expect(bet).toContain("memberApi.getDraw");
    expect(bet).toContain("memberApi.createQuote");
    expect(quote).toContain("memberApi.getQuote");
    expect(quote).toContain("memberApi.createOrder");
    expect(quote).toContain("memberApi.confirmOrder");
    expect(receipt).toContain("memberApi.getOrder");
    expect(receipt).toContain("memberApi.getReceipt");
    expect(receipt).toContain("memberApi.cancelOrder");
  });
});
