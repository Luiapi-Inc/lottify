import type {
  PayoutDestinationVerificationAdapter,
  PayoutDestinationVerificationOutcome,
  PayoutDestinationVerificationRequest,
  PayoutDestinationVerificationResult,
} from "../application/payout-destination-verification.adapter";

export interface DeterministicDestinationVerificationScenario {
  outcome?: PayoutDestinationVerificationOutcome;
}

/**
 * Deterministic Payout Destination verification (Ticket 06 deterministic
 * fake/sandbox). Scenarios are keyed by bank code; the default outcome is
 * `VERIFIED` so the vertical is operable end to end in v1, and tests inject
 * `REJECTED`/`PENDING` to drive the denial and pending paths. Verification is
 * independent of Member/KYC status and never sees the raw account reference:
 * only the opaque digest crosses this seam.
 */
export class DeterministicPayoutDestinationVerificationFake
  implements PayoutDestinationVerificationAdapter
{
  constructor(
    private readonly scenarios: Readonly<
      Record<string, DeterministicDestinationVerificationScenario>
    > = {},
  ) {}

  async verify(
    input: PayoutDestinationVerificationRequest,
  ): Promise<PayoutDestinationVerificationResult> {
    const scenario = this.scenarios[input.bankCode] ?? {};
    return {
      outcome: scenario.outcome ?? "VERIFIED",
      evidenceRef: `destination-verification:${input.accountDigest.slice(0, 32)}`,
      providerId: "destination-verification-fake",
    };
  }
}
