# Lottify Member iOS Mockup — Working Context

Use this file as the resume checkpoint. Read it plus Ticket 11 and the applicable policy/domain ticket before changing the mockup. Do not reload long chat history unless a missing decision cannot be resolved from source-of-truth or current code.

## Source of truth

- `.scratch/lottify-v1-specification/issues/11-member-application-flow-prototype.md`
- Identity/KYC/Payout Destination: issue `06`.
- Promotion/turnover: issue `07`.
- Related workflow/verification/roadmap docs: issues `02`, `16`, `19`.
- Primary areas: หน้าแรก / ซื้อหวย / โพยของฉัน / กระเป๋า / บัญชี.
- Purchase flow: Product → Draw → Bet Type → Numbers & Amount → Review Lines → Quote → Confirm → Receipt.

## Current state

- Mockup: `docs/mockups/member-frontend-ios/` — 25 linked static HTML pages, isolated from `apps/member-web`.
- Public review base: `http://43.208.0.145/ios/`.
- Visual direction: Thai-first, mobile-first, iOS/iPadOS-inspired, Anuphan typography.
- `bet.html` supports keypad 0–9, clear/backspace, keyboard input, bulk multi-number entry, reverse/permutation/run helpers, apply-amount-to-all, duplicate merge visibility, and leading-zero preservation.
- User-requested sample `312` is removed from the active buy/bet page. Do not globally rewrite historical samples unless required by the active task.

## Integrated functional checkpoint

- Onboarding follows `Phone → OTP → Terms → Profile → Eligibility → Home`.
  - OTP requires all 6 digits before submit and records phone-verification state.
  - Terms cannot be accepted before phone verification and records acceptance separately from KYC.
  - Profile completion is tracked separately.
  - Eligibility reads the actual prerequisite states and blocks only the affected capability.
- KYC is capability-specific rather than a global account gate. Canonical mock states include `VERIFIED`, `REJECTED`, `REVIEW_REQUIRED`, `MORE_INFO_REQUIRED`, submitted/review states, and persisted Member-facing status.
- Account summary reflects persisted KYC status; BET/DEPOSIT remain independently evaluated while Withdraw follows its KYC requirement in this mockup.
- Payout Destination verification remains separate from KYC. Bank change flow is `re-auth/OTP → enter new destination → review/verification → verified current destination`; OTP completion alone never approves the new destination.
- Quote/Confirm failure UX covers expired Quote, closed Draw, changed payout/exposure, insufficient funds, and eligibility/restriction. Material changes require explicit re-review and never auto-confirm.
- Cancellation keeps the immutable receipt/history, moves through cancelling/refund-pending, and reaches cancelled only after refund completion in the mockup.
- Payment recovery covers pending, `review_required`, reconciling, stale/offline recovery and authoritative completion. Ambiguous withdrawal keeps the held amount until outcome is known.
- Promotion/turnover shows provisional vs finalized contribution, eligible Product/Bet Type scope, expiry, winnings treatment snapshot, cancellation/refund removal, correction adjustments, and authoritative BONUS → CASH completion semantics.
- Result correction history shows ordered `original outcome → correction notice → reversal/compensation → recalculation → current authoritative outcome`; historical facts remain visible and internal Ledger mechanics stay hidden.
- Security self-service covers device/session review, per-device revoke, logout-all, OTP/re-auth, anomalous-device alert and account recovery.
- Referral/member invite and editable Member profile are integrated.

## Verification evidence — functional/static

Final integrated check on 2026-09-10:

- 25 HTML pages validated.
- Internal links, anchors, duplicate IDs, referenced local assets and placeholder `href="#"`: 0 errors.
- All 5 JavaScript files under `assets/` pass `node --check`.
- Public/local parity: 35 HTML/JS/CSS files checked by SHA-256, 0 mismatches.
- Runtime selector defect found during browser QA was fixed: multi-element operations now use the collection selector where required, preventing `setupOnboardingFlow()` from aborting before later page initialization.
- After the runtime fix, persisted KYC `REJECTED` state is reflected on `account.html` as Member-facing `ไม่ผ่าน` status.
- Direct Eligibility access with no onboarding state shows Phone/Terms/Profile as incomplete and routes all affected capabilities to the first missing requirement.
- Direct Terms access before phone verification disables acceptance and points back to registration.
- Bank change rejection path shows `กรอกรหัส OTP ให้ครบ 6 หลักเพื่อยืนยันซ้ำ` when re-auth input is incomplete.

## Verification evidence — mobile visual / browser

- Browser viewport verified at 390×844.
- High-risk pages checked: `promotions.html`, `withdraw-status.html?state=reconciling&connection=offline`, `kyc.html`, `bank-account.html`, `slip-detail.html`, `terms.html`, and `eligibility.html`.
- No horizontal overflow was found on Promotions, Withdrawal recovery, KYC, Bank change, or Slip detail at 390px width.
- Mobile navigation uses safe-area-aware bottom padding and ≥54px link height in the active responsive rules.
- Withdrawal recovery presents offline/stale meaning in text, preserves the 3,000.00-baht held amount while outcome is ambiguous, and exposes an explicit status-refresh action.
- KYC `REJECTED` state is conveyed by text and persists across navigation into Account summary.
- Correction history remains readable as an ordered timeline and its filters expose pressed state for accessibility.
- OTP final mobile evidence: 390×844 screenshot, 6 numeric inputs, 4 prefilled mock digits, submit disabled until all 6 digits are present.

## Scope limits / unresolved source decisions

The mockup deliberately does not invent production values that are not locked by source-of-truth, including the final Terms document/version, exact mandatory-profile contract, age/jurisdiction thresholds, provider-specific KYC evidence rules, or other production policy values. These are source/contract decisions, not remaining mockup implementation substitutes.

## Current checkpoint

The previously listed mockup gaps for onboarding gating, authoritative payment recovery, promotion turnover semantics, correction history, KYC/account state continuity, and payout-destination change flow are implemented and covered by the evidence above.

No production deploy or `apps/member-web` implementation is part of this mockup checkpoint.

## Guardrails / resume protocol

- Before change: Source of Truth → Intended Result → Current State → Gap → Implementation.
- After change: Requirement → Plan → Implementation → Test → Actual Result.
- Preserve the existing five-area navigation and canonical purchase-flow contract.
- Do not modify production/member app code from this mockup task.
- Do not claim production readiness from this static mockup checkpoint; production implementation and its own acceptance evidence remain separate work.
