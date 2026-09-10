# Member readiness + KYC eligibility implementation decisions (Issue 66)

Source of truth: Wayfinder Tickets 01, 06, 09, 10, 11 and 16. This record does
not redefine those requirements. It records the concrete implementation
decisions taken to wire the previously-merged Ticket 06 domain rules into
persistence and a Member read surface — the role
`docs/implementation/member-onboarding-decisions.md` played for Terms/profile.
It builds on the onboarding facts produced by Issue 64 (Terms acceptance and
mandatory profile completeness).

## Scope

- persistence for capability restrictions, verification records and normalized
  KYC state,
- a KYC/Risk application service that resolves an eligibility decision per
  capability through the locked deny-first layer precedence,
- a Member readiness read surface (`GET /api/v1/member/readiness`),
- a minimum Admin surface to set/clear a capability restriction.

Out of scope (Issue 66 explicitly): withdrawal preflight + deposit
method/fee/instructions, OTP RECOVERY, full account recovery, duplicate-account
manual resolution UI, the production KYC provider integration (deterministic
fake only), frontend binding. No monetary effect.

## Decision 1 — Persistence

Three additive tables (migration `20260911140000_member_readiness_kyc`):

- `member_capability_restrictions` — one independent per-capability control per
  row (`BET_BLOCKED`/`WITHDRAWAL_BLOCKED`/`DEPOSIT_BLOCKED`/`LOGIN_BLOCKED`/
  `PROMOTION_BLOCKED`), each with `source`, `reason`, effective period and an
  `actor_or_policy_ref`. One overloaded account status is never used; the locked
  capability→restriction mapping (`restrictionTypeForCapability` in
  `member/domain/capability-restriction.ts`) maps the capability to its control.
  A CHECK constraint locks the type vocabulary and requires a non-empty
  `source`/`reason`/`actor_or_policy_ref` and a valid effective window.
- `member_verification_records` — explicit per-type freshness: `type`
  (`KYC`/`PHONE`/`DEVICE`/`PAYOUT_DESTINATION`), `verified_at`, `source`,
  `evidence_refs`, optional `expires_at` and optional `reverification_policy_ref`.
  A CHECK constraint locks the type vocabulary and requires `expires_at` after
  `verified_at`. An expired verification is never treated as valid by the
  decision service.
- `member_kyc_status` — one canonical, provider-independent outcome per Member
  (`VERIFIED`/`REJECTED`/`REVIEW_REQUIRED`/`MORE_INFO_REQUIRED`, never a vendor
  status), plus `policy_version`, `evidence_refs`, `source` and `evaluated_at`.
  A CHECK constraint locks the outcome vocabulary.

`evidence_refs` are opaque references; the Member read surface never exposes
their contents.

## Decision 2 — The readiness application service lives in KYC/Risk, reading Member facts through ports

`EligibilityService` (`src/contexts/kyc-risk/application/eligibility.service.ts`)
resolves an `EligibilityDecision` per capability by calling the locked
`resolveEligibilityDecision` (deny-first: hard restriction/self-exclusion →
compliance → risk → capability policy) with the four layer results. Lower
layers can never override an earlier non-allow.

The Member-owned facts it needs are resolved through cross-context ports, so
KYC/Risk never re-derives or re-implements another context's rules:

- `CAPABILITY_RESTRICTION_PORT` → `CapabilityRestrictionAdapter`
  (`src/platform/integration/`) reads persisted restrictions and applies the
  Member-context domain rules (`getEffectiveCapabilityRestrictions`,
  `isSelfExclusionRestriction`).
- `MEMBER_READINESS_FACTS_PORT` → `MemberReadinessFactsAdapter` resolves the
  Issue 64 facts (`TermsService.getMemberTerms().satisfied`,
  `ProfileService.getProfile().profileComplete`).

Verification records and normalized KYC state are this context's own
persistence and are read directly.

Decisions are point-in-time (`policyVersion = capability-readiness-policy-v1`,
`evaluatedAt`, and a bounded `validUntil = evaluatedAt + 5 minutes`). An ALLOW
is never fabricated — every layer is an evaluated input — and never permanently
valid.

## Decision 3 — Which capabilities require KYC

The source locks that KYC requirements are per-capability (Ticket 06 round 2:
betting/withdrawal can require KYC while deposit may be allowed before it) but
not the exact set. This implementation uses an explicit, easy-to-change constant
(`CAPABILITY_KYC_REQUIREMENTS` in `eligibility.service.ts`):

| capability | KYC required |
|---|---|
| `BET` | yes |
| `WITHDRAWAL` | yes |
| `DEPOSIT` | no (by default) |
| `PROMOTION` | no (by default) |

A `LOGIN` capability is deliberately not evaluated on the authenticated
readiness surface: reaching `GET /member/readiness` already proves the Member
can log in. `LOGIN` is instead evaluated at the pre-auth login boundary — see
Decision 6.

## Decision 4 — Readiness read model

`GET /api/v1/member/readiness` returns, per capability, the decision
(`outcome`, `reasonCodes`, `policyVersion`, `evaluatedAt`, `validUntil`) plus the
outstanding explicit requirements (`termsSatisfied`, `profileComplete`,
`missingProfileFields`, a `kyc` block, and coded `outstandingRequirements`) so
the client can render onboarding/blocked states without inventing data.

## Decision 5 — Admin capability-restriction surface (minimum)

- `POST /api/v1/admin/member-capability-restrictions` sets one restriction with
  `source = "admin"`, an Admin-supplied `reason`, an effective window and an
  `actorOrPolicyRef` (defaults to the acting Admin id). Governed by the
  `member-readiness.manage` capability, Idempotency-Key required, audited.
- `DELETE /api/v1/admin/member-capability-restrictions/{id}` clears it.
  A self-exclusion restriction cannot be removed through this normal Admin path
  (`SELF_EXCLUSION_NOT_REMOVABLE`, 403), enforced by the locked
  `normalAdminRemovalDisposition` rule.
- Two new Admin capabilities were added: `member-readiness.read` (AUDITOR,
  ADMIN, SUPER_ADMIN) and `member-readiness.manage` (ADMIN, SUPER_ADMIN).

KYC state and verification records have no Admin write path in this slice (the
production KYC provider adapter contract is out of scope); their persistence is
exercised deterministically by seeding in the integration suite.

## Decision 6 — The pre-auth login boundary enforces LOGIN_BLOCKED

`LOGIN_BLOCKED` is enforced where the capability becomes relevant: the pre-auth
Member login / OTP-verification boundary.

- Identity & Access declares `MEMBER_LOGIN_CAPABILITY_PORT`
  (`identity-access/application/pre-auth-login-capability.port.ts`); the
  `PreAuthLoginCapabilityAdapter` (`src/platform/integration/`) resolves the
  Member-owned persisted restrictions and applies the locked Ticket 06 rules
  (`getEffectiveCapabilityRestrictions("LOGIN", ...)` plus the
  `SELF_EXCLUSION_RESTRICTION_SOURCE` check) — the same seam pattern as
  `CAPABILITY_RESTRICTION_PORT`. Nothing is re-implemented or duplicated, and
  Identity & Access never reads Member storage directly.
- `MemberAuthService.verifyOtp` evaluates the gate at the same pre-session point
  as the account-status check, after OTP verification and before the challenge
  is consumed, so a denied attempt establishes no session, device or refresh
  credential. The decision is point-in-time against the restriction's effective
  window (not yet effective, expired, or half-open end instant → no gate).
- **Only `LOGIN_BLOCKED` gates login.** `BET_BLOCKED` — including the
  responsible-gaming self-exclusion the Member context models as `BET_BLOCKED` —
  and the withdrawal/deposit/promotion controls never block login (the same
  independence the readiness surface keeps). A `LOGIN_BLOCKED` row whose
  `source` is `self-exclusion` reports `SELF_EXCLUSION` rather than
  `CAPABILITY_BLOCKED`; no normal path creates that row (the self-exclusion
  factory is `BET_BLOCKED`).
- **Response shape.** The denial is the existing Member login error contract: a
  `401` with `{ code: "CAPABILITY_BLOCKED", message, details: {} }` (`code`
  never exposes the restriction's evidence references). It is raised at
  OTP/verify, i.e. exactly where the login contract already distinguishes
  `MEMBER_NOT_REGISTERED`/`ACCOUNT_DISABLED`, so nothing new is leaked at
  OTP/request time: issuance stays identical for blocked and unblocked phones
  (anti-enumeration untouched). No `/api/v1` request or response shape changed.
- Known limitation: an already-issued session/refresh credential is not revoked
  when a restriction is applied; enforcement happens at session establishment
  (login). Refresh-time enforcement and session revocation on restriction are
  filed as a separate follow-up.

## Verification

- Domain/unit: `tests/unit/eligibility.service.spec.ts` (allow, deny, deny-first
  precedence, self-exclusion, review-required, expiry, missing requirements,
  per-capability KYC), `tests/unit/admin-auth-security.spec.ts` (capability
  mapping), `tests/unit/member-capability-restriction.spec.ts`,
  `tests/unit/login-capability-gate.spec.ts` (pre-auth gate: allow, deny, other
  capabilities never gate, effective period), `tests/unit/member-auth.service.spec.ts`
  (denied login establishes no session).
- Contract: `tests/contract/member-readiness-api.contract.spec.ts` (declared
  success schemas, no persistence leakage, capability gating, Idempotency-Key on
  every critical Admin mutation).
- Deterministic integration evidence (allow / deny / review precedence / expiry
  / missing requirements / Admin set-clear-audit / self-exclusion protection /
  capability gating): `tests/integration/member-readiness.integration.spec.ts`
  against Postgres; pre-auth enforcement (effective `LOGIN_BLOCKED` denies with
  no session, only that type gates, effective period, cleared restriction,
  anti-enumeration at OTP request, self-exclusion protection):
  `tests/integration/member-login-capability.integration.spec.ts`.
- `pnpm check` must pass.

This is an implementation checkpoint. It is not Ticket 16 acceptance of the
Identity / Eligibility milestone, and it does not claim monetary correctness or
production GO.
