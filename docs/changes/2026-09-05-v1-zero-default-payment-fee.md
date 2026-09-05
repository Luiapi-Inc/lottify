# Change Request: v1 payment fee default is zero

Status: approved by product owner on 2026-09-05

## Change

Q114 remains unchanged: Deposit and Withdrawal fees are configurable by provider, payment method, and amount and are shown to the Member before confirmation.

For v1, when Payments configuration does not resolve a non-zero fee, the authoritative fee is `0` minor units for both Deposit and Withdrawal.

## Financial effect

- `feeMinor = 0` creates no separate fee Ledger posting obligation.
- A future configured `feeMinor > 0` must still use explicit traceable Ledger postings as required by Ticket 04.
- This change does **not** decide whether a future non-zero fee is Member-paid or operator/provider-paid.
- This change does **not** decide whether Deposit/Withdrawal business amounts are gross or net of a future non-zero fee, or whether a Withdrawal Reservation includes that fee.

## Implementation boundary

Payments owns provider/method/amount-specific fee configuration and resolution. The current v1 domain seam accepts the fee resolved by that configuration and defaults it to zero when none is resolved. No fee configuration persistence, Admin API, or Member/Withdrawal orchestration is introduced before the Payments vertical defines those contracts.
