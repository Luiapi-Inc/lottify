# Lottify Member — UX Contract

## Authority

The backend is authoritative for session, readiness, terms/profile/KYC facts, product/draw/bet availability, quote, order confirmation/cancellation, receipt/settlement, wallet, deposits, payout destinations, withdrawals and promotion entitlement state.

A passing build alone is not acceptance. For every material change use:

`Requirement -> Plan -> Implementation -> Test -> Actual Result`

## Primary information architecture

Exactly five primary areas:

1. `หน้าแรก` → `/`
2. `ซื้อหวย` → `/buy`
3. `โพยของฉัน` → `/slips`
4. `กระเป๋า` → `/wallet`
5. `บัญชี` → `/account`

Promotions and notifications are contextual, not additional primary tabs.

## Navigation behavior

- Desktop: floating five-area dock. No persistent desktop sidebar.
- Mobile: bottom navigation with the same five destinations and ordering.
- Current destination uses `aria-current="page"`.
- Direct navigation/refresh must preserve the intended screen or explicit error/recovery state.
- Sticky/fixed chrome must not obscure focus or final actionable content.

## Authentication

- Protected pages render loading/authenticated/signed-out/API-unavailable honestly.
- Do not fabricate a logged-in identity.
- Auth-shell links to guarded member routes must not prefetch a redirect that strands a newly authenticated member.
- Password/OTP/session behavior remains owned by the shared Member API/session layer.

## Betting journey

Canonical sequence:

`Product -> Draw -> Bet Type -> Numbers & Amount -> Review Lines -> Quote -> Confirm -> Receipt`

- Preserve leading zeroes and canonical bet lines.
- Server decides eligibility, payout, restrictions and quote validity.
- Material quote change/expiry requires explicit recovery; never auto-confirm changed terms.
- Receipt renders accepted API facts, never stale client quote reconstruction.

## Wallet and money-moving states

- Never optimistically show financial success.
- Deposit, payout destination and withdrawal status must be re-fetched from the authoritative API.
- Withdrawal preflight runs immediately before final confirmation where required.
- `RECONCILING` is unresolved/reconciling, not success and not balance restoration.
- Preserve the same idempotency key when retrying the same logical mutation.

## Async and error behavior

Every material async surface supports:

- stable loading state;
- authoritative ready state;
- Thai failure guidance;
- correlation ID when appropriate for support;
- explicit retry/recovery where the action is safe;
- no raw stack traces, provider payloads, ledger internals or risk internals.

Home degrades section-by-section when optional reads fail rather than fabricating content or blanking unrelated authoritative sections.

## Forms and sensitive values

- Product forms own validation and preserve entered values on correction.
- Raw bank-account details are not persisted after submission beyond what the form requires.
- Masked API values are used for subsequent display.
- Disable duplicate submit while mutations are in flight.
- Use app-owned confirmation for destructive/security-sensitive actions rather than browser `confirm()`.

## Feedback

- A success message never replaces authoritative state.
- Status language is consistent for the same wire state across screens.
- Dangerous actions remain visually and spatially distinct from safe primary actions.

## Accessibility and responsive acceptance

- WCAG 2.2 AA target.
- Native semantics and visible keyboard focus.
- Interactive targets at least 44 px where touch is expected.
- No body horizontal overflow at supported mobile widths.
- Fixed bottom navigation never covers the final interactive element.
- Reduced motion is respected.

## Release evidence

Before a Member Web candidate is considered accepted, record candidate-bound evidence for:

- typecheck/build;
- unit/contract tests;
- current Member API binding coverage;
- approved route inventory;
- desktop + mobile critical workflow E2E;
- layout assertions (overflow, nav presence, tap target, fixed-nav overlap);
- visual review when the visual-review transport is available, or explicitly record that it was skipped/unavailable.
