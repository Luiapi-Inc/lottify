import { describe, expect, it } from "vitest";
import { DepositMethodService } from "../../apps/api/src/deposit-method.service";

describe("DepositMethodService", () => {
  const service = new DepositMethodService();

  it("lists the deterministic THB deposit registry", () => {
    expect(service.list()).toEqual([
      { providerCode: "corridor", methodCode: "bank-transfer" },
      { providerCode: "corridor", methodCode: "promptpay" },
    ]);
  });

  it("describes one method with the v1 zero fee quote and instructions", () => {
    expect(service.describe("bank-transfer")).toMatchObject({
      providerCode: "corridor",
      methodCode: "bank-transfer",
      currency: "THB",
      feeMinor: 0n,
    });
    expect(service.describe("bank-transfer")?.instructions.length).toBeGreaterThan(0);
    expect(service.describe("missing")).toBeNull();
  });
});
