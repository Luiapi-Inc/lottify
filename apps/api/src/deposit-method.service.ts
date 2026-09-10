import { Injectable } from "@nestjs/common";
import { createPaymentFeeQuote } from "../../../src/contexts/payments/domain/payment-fee-policy";
import { DEPOSIT_METHODS, type DepositMethodConfig } from "./deposit-methods.config";

export interface DepositMethodSummary {
  providerCode: string;
  methodCode: string;
}

export interface DepositMethodDescription extends DepositMethodSummary {
  currency: "THB";
  feeMinor: bigint;
  instructions: readonly string[];
}

@Injectable()
export class DepositMethodService {
  list(): readonly DepositMethodSummary[] {
    return DEPOSIT_METHODS.map(({ providerCode, methodCode }) => ({ providerCode, methodCode }));
  }

  describe(code: string): DepositMethodDescription | null {
    const method = this.find(code);
    if (!method) return null;
    const fee = createPaymentFeeQuote({
      operation: "DEPOSIT",
      providerCode: method.providerCode,
      methodCode: method.methodCode,
      amountMinor: 1n,
    });
    return {
      providerCode: method.providerCode,
      methodCode: method.methodCode,
      currency: method.currency,
      feeMinor: fee.feeMinor,
      instructions: [...method.instructions],
    };
  }

  private find(code: string): DepositMethodConfig | undefined {
    const normalized = code.trim();
    return DEPOSIT_METHODS.find(
      (method) => method.methodCode === normalized || `${method.providerCode}/${method.methodCode}` === normalized,
    );
  }
}
