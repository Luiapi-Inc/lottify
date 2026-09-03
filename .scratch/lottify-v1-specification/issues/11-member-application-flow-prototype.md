# Prototype the Member application workflows

Type: prototype
Status: resolved
Blocked by: 02, 05, 06, 07, 10

## Question

What interaction model and screen flow lets a Thai-first Member complete onboarding, deposit, Product/Draw selection, assisted number entry, Quote review, Confirm, receipt/history, promotion/turnover review, withdrawal, security self-service, and correction visibility with the approved policy and failure states understandable before implementation?

## Comments

### Member UX round 1 — confirmed

- Main navigation is mobile-first and Thai-first with five primary areas: `หน้าแรก`, `ซื้อหวย`, `โพยของฉัน`, `กระเป๋า`, and `บัญชี`. Promotions and notifications enter contextually from Home and relevant flows rather than adding more primary navigation tabs.
- Registration/onboarding follows `phone → OTP → account created → required Terms acceptance → mandatory profile data → eligibility evaluation → Home`. Registration does not require KYC unless the effective policy requires it. Missing requirements block only the affected capability and are explained in action-specific language rather than locking the whole application.
- Home prioritizes actionable Member information: CASH/BONUS wallet summary, currently open Product/Draw entries with cutoff countdown, recent/continue-bet access, active Promotion/turnover progress, and important verification/payment/result/correction alerts. Internal operational states are hidden unless they materially help the Member understand an action or delay.
- The canonical betting interaction is `Product → Draw → Bet Type → Numbers & Amount → Review Lines → Quote → Confirm → Receipt`. Before Quote, the Member can see cutoff, baseline payout/stake rules and immediate restriction feedback. Quote review shows canonicalized/aggregated lines, resolved payout and restrictions, total stake, funding source allocation, and quote-expiry countdown before Confirm is enabled.
- Number entry is assisted rather than technical. Bet-Type-specific inputs can support multi-number entry, bulk paste, reverse/permutation/run helpers, and apply-amount-to-all. Helpers always expand into the exact canonical Bet Lines before Quote, duplicate-equivalent lines are visibly merged, and leading zeroes remain semantically preserved according to Bet Type rules.

### Member UX round 2 — confirmed

- Quote/Confirm failures are translated into clear next actions rather than raw API codes. Expired Quotes offer requote, closed Draws stop confirmation and return the Member to Draw selection, changed payout/exposure requires explicit review of the new terms, insufficient funds shows the shortfall and funding path, and eligibility/restriction failures explain the required next step. The client never auto-confirms after material Quote changes.
- Successful Confirm produces an immutable Member Receipt showing Order/receipt reference, Product, Draw, Bet Type, accepted Bet Lines, stake, accepted payout, CASH/BONUS source allocation, confirmed time, cutoff, and current settlement/cancellation status. `โพยของฉัน` supports filters and exposes settlement, refund, cancellation, and correction history without leaking internal workflow details.
- Deposit UX is `Wallet → Deposit → Method → Amount/Fee → Confirm → Provider Instructions → Pending/Completed`. Pending state can update through realtime or polling without creating a new Deposit; duplicate callbacks cannot create duplicate visible credits. Review/reconciliation states use plain-language “กำลังตรวจสอบ” messaging plus a durable reference rather than raw provider errors.
- Withdrawal UX is `Wallet → Withdraw → Payout Destination → Amount/Fee → Eligibility/KYC Check → Review → Confirm → Status`. Before confirmation, the Member sees withdrawable CASH, non-withdrawable BONUS, fee, applicable limits, destination, and current processing expectations. If verification/review is required, the UI routes to that requirement while preserving only safe draft context.
- Wallet presentation distinguishes CASH, BONUS, reserved/held value, and currently withdrawable value. Transaction history uses Member-facing business labels such as deposit, bet purchase, refund, winnings, bonus, and withdrawal, with drill-down references/status while hiding debit/credit accounting internals.

### Member UX round 3 — confirmed

- Promotion/turnover UX presents each Entitlement in Member language with remaining BONUS, turnover target/progress, eligible Products/Bet Types, expiry, winnings treatment, and lifecycle state. Provisional contribution is visually distinguished from finalized turnover, and the UI clearly explains that BONUS is not directly withdrawable until the applicable conversion conditions are satisfied.
- Security self-service lives under `บัญชี → ความปลอดภัย` and supports session/device review, per-device revoke, logout-all, OTP/re-auth-protected sensitive self-service, and account-recovery entry. New/anomalous-device alerts are understandable to the Member without exposing internal risk scores or policy implementation.
- Result/Settlement corrections remain visible as an ordered Member-facing timeline: original result/outcome, correction notice, reversal/compensation effect, recalculation, and current authoritative outcome. Historical Receipt/Settlement facts are preserved rather than overwritten, while Ledger debit/credit mechanics remain hidden.
- Realtime is an enhancement, not a source of truth. Missed/disconnected updates recover through REST refresh/polling; critical Quote/Confirm/Withdrawal actions re-read authoritative state before mutation; stale versions require refresh/review; and money/state-critical operations never show optimistic success before server confirmation.
- Thai is the primary UX language. Money is displayed with explicit baht semantics, Product-local time/cutoff is clear while server time remains authoritative, statuses combine text with visual cues rather than color alone, critical confirmations restate amount/payout/fee/destination, and only support-useful references are exposed to Members.

## Answer

Lottify v1 Member App uses a Thai-first, mobile-first interaction model centered on five primary areas: `หน้าแรก`, `ซื้อหวย`, `โพยของฉัน`, `กระเป๋า`, and `บัญชี`.

1. Registration uses phone + OTP, then required Terms/profile steps and capability-specific eligibility; KYC is requested only when the effective policy requires it.
2. Home prioritizes wallet balances, open Draws/cutoff, recent betting, promotion/turnover progress, and actionable alerts.
3. Betting follows `Product → Draw → Bet Type → Numbers & Amount → Review Lines → Quote → Confirm → Receipt`, with assisted number entry and fully expanded canonical Bet Lines before Quote.
4. Quote/Confirm failures always explain the Member's next action; material changes require explicit re-review and never auto-confirm.
5. Receipt/history preserves accepted payout, source funding allocation, state, settlement/refund/cancellation/correction trail, and support references.
6. Deposit and Withdrawal flows expose fees, eligibility, destination, pending/review states, and authoritative completion without leaking provider internals.
7. Wallet separates CASH, BONUS, held/reserved, and withdrawable value using Member-facing transaction labels rather than accounting terminology.
8. Promotion views expose exact Entitlement terms and distinguish provisional versus finalized turnover; BONUS withdrawal restrictions are explicit.
9. Security self-service includes session/device management, protected sensitive actions, and account recovery without exposing risk internals.
10. Result corrections are shown transparently as history-preserving timelines rather than silently replacing prior outcomes.
11. Realtime never replaces REST authority; stale or disconnected clients recover deterministically and critical financial actions wait for server-confirmed success.
12. Thai-first copy, explicit money/time semantics, non-color-only status communication, and clear critical confirmations define the accessibility/clarity baseline.

These flows make onboarding, betting, wallet/payment, promotion, security, and correction behavior understandable before implementation while remaining aligned with the locked domain, policy, financial, and API contracts.
