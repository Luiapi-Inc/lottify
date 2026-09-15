/**
 * Withdrawal dual-control approval threshold (G2 `system_settings.
 * withdrawal.dual_control_threshold`, cutover decision D11).
 *
 * G2 decided `payment_withdrawals.requires_approval` from `amount >=
 * dual_control_threshold` (50,000.00 THB). G3 has no settings table, so the
 * value now travels as configuration (`WITHDRAWAL_APPROVAL_THRESHOLD_MINOR`) and
 * this is the pure comparison the Payments application layer applies when it
 * assembles the already-evaluated review signal for the eligibility decision —
 * the domain resolver itself still invents no threshold.
 *
 * The decision is deliberately a *creation-time gate*: it routes the Withdrawal
 * to the `APPROVAL` queue instead of fast-pathing it to `APPROVED`. It is not
 * re-applied on the pre-payout recheck, where a `REVIEW_REQUIRED` verdict is
 * terminal and would reject a Withdrawal an Admin has already approved.
 */
export const DUAL_CONTROL_APPROVAL_REASON_CODE = "APPROVAL_THRESHOLD";

export const DUAL_CONTROL_APPROVAL_EVIDENCE_REF =
  "policy:withdrawal.dual-control-threshold";

/** True when the amount meets or exceeds the configured dual-control threshold. */
export function requiresDualControlApproval(
  amountMinor: bigint,
  thresholdMinor: bigint,
): boolean {
  return amountMinor >= thresholdMinor;
}
