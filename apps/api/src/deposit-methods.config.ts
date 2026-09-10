export interface DepositMethodConfig {
  providerCode: string;
  methodCode: string;
  currency: "THB";
  instructions: readonly string[];
}

export const DEPOSIT_METHODS: readonly DepositMethodConfig[] = [
  {
    providerCode: "corridor",
    methodCode: "bank-transfer",
    currency: "THB",
    instructions: [
      "Create a deposit request before transferring funds.",
      "Transfer the exact requested amount to the account shown by the payment provider.",
      "Keep the transfer reference until the deposit reaches a terminal status.",
    ],
  },
  {
    providerCode: "corridor",
    methodCode: "promptpay",
    currency: "THB",
    instructions: [
      "Create a deposit request before making payment.",
      "Pay the PromptPay instruction returned by the payment provider for the exact amount.",
      "Keep the payment reference until the deposit reaches a terminal status.",
    ],
  },
] as const;
