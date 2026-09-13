# Identity / Eligibility milestone implementation status

Source of truth: Wayfinder Tickets 01, 02, 06, 10, 11, 16, and 19. This record does not redefine those requirements.

## Member API identity vertical (Issue 31) checkpoint

The Member phone + OTP + registration + session/device flow is now implemented as
domain application services in `identity-access` and `/api/v1/member` REST on the
`main` branch. Concrete implementation decisions for the
previously-unlocked OTP/Device/session contracts are recorded in
`docs/implementation/member-identity-decisions.md`. The Member presentation
surface from PR #30 is also merged to `main`. These are implementation checkpoints,
not Identity / Eligibility milestone acceptance or Production GO.

## Implemented checkpoint

- Identity & Access has the rotating refresh-session foundation required by the approved security model.
- Session management is Member-scoped: active-session review returns only `sessionId`, `deviceId`, and `expiresAt`.
- Session revocation is constrained to the owning Member and supports single-session, per-device, and all-device scope.
- Refresh-token hashes remain persistence-only and are not exposed by the Member-facing application service.
- Member capability restrictions are modeled as independent `BET_BLOCKED`, `WITHDRAWAL_BLOCKED`, `DEPOSIT_BLOCKED`, `LOGIN_BLOCKED`, and `PROMOTION_BLOCKED` controls with source, reason, effective period, and actor-or-policy reference; one account-wide status is not used.
- KYC/Risk Eligibility Decisions now have the locked machine-readable outcomes plus capability, reason codes, policy version, evidence references, evaluation time, and bounded freshness window; the decision can be checked for freshness before a critical operation re-evaluates it.
- Eligibility policy resolution follows the locked deny-first layer order: hard restriction/self-exclusion, compliance, risk, capability/business policy, then allow. Every layer is required as an input, and a lower-priority layer cannot replace an earlier non-allow decision.
- Withdrawal eligibility has a dedicated policy resolver for the locked rule set: amount limit, daily aggregate, frequency, KYC tier, payout-destination verification, risk, capability restriction, and approval threshold. Every rule is required as evaluated input, the strictest result wins (`DENY` over `REVIEW_REQUIRED` over `ALLOW`), and the resulting `WITHDRAW` decision preserves policy version, reasons, evidence, evaluation time, and freshness without inventing concrete threshold values.
- Verification freshness is modeled independently for KYC, phone, device, and payout-destination verification with `verifiedAt`, source/evidence provenance, optional expiry, and an optional reverification-policy reference; explicit expiry is evaluated independently per verification type.
- Duplicate-account policy now evaluates the locked phone, KYC identity, payout-destination, device, IP/network, and behavior signal set into `ALLOW`, `REVIEW_REQUIRED`, or `BLOCK` without inventing numeric weights or thresholds. Device and IP/network evidence is explicitly non-authoritative for hard blocking, while stronger policy-evaluated signals may block; manual resolution evidence requires both a reason and an Audit reference.
- Responsible-gaming self-exclusion now produces an immediate Member-owned `BET_BLOCKED` restriction with explicit effective/expiry semantics and traceable policy/evidence reference. KYC/Risk evaluates active self-exclusion as the highest-priority hard eligibility denial, the normal Admin restriction-removal path is denied for self-exclusion, and the restriction does not automatically block an otherwise eligible Withdrawal.
- Member phone identity, OTP challenges, logical Device records, and Member session/device REST operations now have concrete implementation contracts recorded in `member-identity-decisions.md` and implemented by migrations/API code on `main`.
- Refresh-token reuse revokes the server-authoritative session family; OTP resend cooldown is enforced by the request gate.
- Member readiness and KYC capability eligibility now have a concrete checkpoint recorded in `docs/implementation/member-readiness-decisions.md` and implemented by migration `20260911140000_member_readiness_kyc`: capability restrictions, verification freshness records, normalized KYC status, deny-first eligibility resolution, the authenticated `GET /api/v1/member/readiness` surface, and the minimum Admin set/clear capability-restriction surface.
- Betting now consumes the KYC/Risk `BET` eligibility decision before Quote and again before Confirm through the platform composition seam, so a non-ALLOW decision prevents Quote persistence and prevents Confirm from touching Draw/Wallet/Ledger state.

## Source-alignment finding on 2026-09-09

The previous status text still listed OTP and Member session/device wire/storage
contracts as unresolved after Issue 31 had already recorded and implemented those
decisions. That documentation drift is corrected below. The OTP verify-attempt
default is now aligned with Ticket 13 at `10 attempts / challenge`; Ticket 16
security/abuse evidence remains required before acceptance.

## Evidence confirmed on 2026-09-04

GitHub Actions `ci` run `33829850497` on commit `932e47c879715c0f16c1a1b712b8faa14cf0c550` passed completely.

- `verify`: PASS — Prisma generation/migration, OpenAPI generation, typecheck, tests, production dependency audit, and build all passed.
- `container-smoke`: PASS — API, worker, Member, and Admin OCI images built and all runtime smoke checks passed.
- This CI result confirms the scoped session-management checkpoint only; it does not establish Identity / Eligibility milestone acceptance or Production GO.

## Local evidence on 2026-09-06

- Duplicate-account policy focused unit tests: 5 passed.
- Full local Vitest suite: 144 passed; 65 integration tests skipped because their integration environment flags/database were not enabled.
- TypeScript typecheck passed after using the generated OpenAPI/client artifacts for the same source HEAD. No Identity / Eligibility milestone acceptance or Production GO is claimed from this local evidence.
- Responsible-gaming self-exclusion focused verification: 18 tests passed across self-exclusion enforcement, Member capability restrictions, and eligibility precedence. The full local Vitest suite then passed 150 tests with 65 integration tests skipped because their integration environment flags/database were not enabled; TypeScript typecheck also passed after generating Prisma Client and using the generated OpenAPI client for the same API source HEAD. This remains local checkpoint evidence rather than Identity / Eligibility milestone acceptance.

## Local evidence on 2026-09-13

- Focused Member readiness/KYC capability verification used a fresh throwaway PostgreSQL database (`lottify_readiness_verify_30ac0d9b`) created from the current `.env` connection and applied all committed migrations through `20260911150000_member_recovery_otp`.
- `RUN_INTEGRATION_TESTS=1 pnpm vitest run tests/unit/eligibility.service.spec.ts tests/unit/member-capability-restriction.spec.ts tests/contract/member-readiness-api.contract.spec.ts tests/integration/member-readiness.integration.spec.ts` passed 37 tests across 4 files.
- The passed evidence covers deny-first eligibility precedence, per-capability KYC requirements, missing Terms/profile requirements, KYC review/rejection/expiry, declared OpenAPI schemas without persistence leakage, Admin capability gating, Idempotency-Key requirements, Admin set/clear audit behavior, and self-exclusion removal denial.
- This is deterministic local checkpoint evidence for the Member readiness/KYC slice. It is not full Identity / Eligibility milestone acceptance or Production GO.

## PR / CI evidence on 2026-09-13

- PR #94 merged the Betting `BET` eligibility enforcement into `main` at merge commit `fe0b93c5f0b3a9c05c17bc2f30d0f62ecc69c8f0`, with feature commit `6a5ccf336f6bdd13ba8df093f41d9b005ca35ac6`.
- Official `luiapi-sys/lottify` GitHub Actions failed before runner start because the account billing/spending limit blocks jobs; check-run annotations state that the job was not started because recent account payments failed or the spending limit must be increased.
- Owner decision accepted fallback CI evidence for that PR merge on the exact feature SHA. Fallback CI run `https://github.com/luiapidev/lottify-ci/actions/runs/34731238031` completed successfully for `6a5ccf336f6bdd13ba8df093f41d9b005ca35ac6`, including `verify` and `container-smoke`.
- Post-merge official `main` CI for `fe0b93c5f0b3a9c05c17bc2f30d0f62ecc69c8f0` still fails before runner start with the same billing/spending-limit annotation. Production Release Gate remains HOLD.

## Remaining contract/detail gaps for affected slices

The Wayfinder map declares the engineering specification handoff complete. The following lower-level details are still not explicit enough to implement the affected slices without choosing additional behavior or wire/storage shape. They do not block unrelated Identity / Eligibility work whose behavior is already locked.

1. **OTP acceptance evidence** — Issue 31 resolved the concrete OTP storage and REST shape plus TTL/resend/request-window bindings, and the verify-attempt default now matches Ticket 13 at `10 attempts / challenge`. The remaining gap is the required Ticket 16 security/abuse evidence for the aligned policy.
2. **Logical Device risk evidence** — Issue 31 resolved the Device persistence and Member session/device management surface. Ticket 06 still requires anomalous-device Risk Signals and policy outcomes (`ALLOW`, `CHALLENGE`, `REAUTH`, `BLOCK`); the evidence model and its end-to-end wiring remain outside the implemented session/device management checkpoint.
3. **Age/jurisdiction eligibility policy** — Tickets 02/06/11 require age/jurisdiction eligibility before affected capabilities are enabled. The Terms acceptance/version contract and mandatory profile field set are implemented as `member_terms_documents` / `member_terms_acceptances` plus the `members` profile columns, and the capability-readiness slice now consumes those facts before returning a capability decision. Concrete age/jurisdiction thresholds, evidence rules, and policy outcomes remain source-blocked; the current profile/date-of-birth implementation validates data shape and never invents a legal eligibility threshold.

## Milestone disposition

Member phone authentication, session/device management, Terms/profile onboarding facts, Member readiness/KYC capability decisions, Member capability restrictions, responsible-gaming self-exclusion, and Betting `BET` eligibility enforcement are implemented checkpoints on `main`; the earlier wire/storage-contract gaps for those operations are no longer open. Identity / Eligibility remains incomplete because OTP security/abuse evidence, anomalous-device risk behavior, concrete age/jurisdiction eligibility policy, broader Ticket 16 acceptance evidence, and official CI evidence are not complete. Slices that depend on those gaps must not invent policy values or identity-evidence semantics; any required specification change must be recorded explicitly rather than inferred from the implementation.
