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

## Remaining contract/detail gaps for affected slices

The Wayfinder map declares the engineering specification handoff complete. The following lower-level details are still not explicit enough to implement the affected slices without choosing additional behavior or wire/storage shape. They do not block unrelated Identity / Eligibility work whose behavior is already locked.

1. **OTP acceptance evidence** — Issue 31 resolved the concrete OTP storage and REST shape plus TTL/resend/request-window bindings, and the verify-attempt default now matches Ticket 13 at `10 attempts / challenge`. The remaining gap is the required Ticket 16 security/abuse evidence for the aligned policy.
2. **Logical Device risk evidence** — Issue 31 resolved the Device persistence and Member session/device management surface. Ticket 06 still requires anomalous-device Risk Signals and policy outcomes (`ALLOW`, `CHALLENGE`, `REAUTH`, `BLOCK`); the evidence model and its end-to-end wiring remain outside the implemented session/device management checkpoint.
3. **Member onboarding contract** — Tickets 02/06/11 require Terms acceptance, mandatory profile data, and age/jurisdiction eligibility before affected capabilities are enabled, but do not lock the mandatory profile field set, Terms acceptance representation/version contract, or age/jurisdiction evidence rules.

## Milestone disposition

Member phone authentication and session/device management are implemented checkpoints on `main`; the earlier wire/storage-contract gaps for those operations are no longer open. Identity / Eligibility remains incomplete because anomalous-device risk behavior and onboarding readiness remain unresolved/unfinished, and Ticket 16 acceptance evidence is not complete. Slices that depend on those gaps must not invent policy values or identity-evidence semantics; any required specification change must be recorded explicitly rather than inferred from the implementation.
