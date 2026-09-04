# Identity / Eligibility milestone implementation status

Source of truth: Wayfinder Tickets 01, 02, 06, 10, 11, 16, and 19. This record does not redefine those requirements.

## Implemented checkpoint

- Identity & Access has the rotating refresh-session foundation required by the approved security model.
- Session management is Member-scoped: active-session review returns only `sessionId`, `deviceId`, and `expiresAt`.
- Session revocation is constrained to the owning Member and supports single-session, per-device, and all-device scope.
- Refresh-token hashes remain persistence-only and are not exposed by the Member-facing application service.
- Member capability restrictions are modeled as independent `BET_BLOCKED`, `WITHDRAWAL_BLOCKED`, `DEPOSIT_BLOCKED`, `LOGIN_BLOCKED`, and `PROMOTION_BLOCKED` controls with source, reason, effective period, and actor-or-policy reference; one account-wide status is not used.
- No new persistence schema or REST path has been introduced for Device, OTP, or onboarding behavior whose detailed contract is not locked.

## Evidence confirmed on 2026-09-04

GitHub Actions `ci` run `33829850497` on commit `932e47c879715c0f16c1a1b712b8faa14cf0c550` passed completely.

- `verify`: PASS — Prisma generation/migration, OpenAPI generation, typecheck, tests, production dependency audit, and build all passed.
- `container-smoke`: PASS — API, worker, Member, and Admin OCI images built and all runtime smoke checks passed.
- This CI result confirms the scoped session-management checkpoint only; it does not establish Identity / Eligibility milestone acceptance or Production GO.

## Remaining contract/detail gaps for affected slices

The Wayfinder map declares the engineering specification handoff complete. The following lower-level details are still not explicit enough to implement the affected slices without choosing additional behavior or wire/storage shape. They do not block unrelated Identity / Eligibility work whose behavior is already locked.

1. **OTP operational contract** — Ticket 06 requires purpose-scoped/versioned expiry, attempt limits, resend cooldown, rate limits, old-code invalidation, and anti-enumeration. Ticket 13 additionally locks the baseline limits at OTP request `5 / 15 minutes / phone+IP` and OTP verify `10 attempts / challenge`. Concrete expiry/resend values and the exact policy/wire representation are not stated; Ticket 10 requires explicit purpose-scoped request/verify operations without enumerating their exact REST paths/payloads.
2. **Logical Device record contract** — Tickets 01/06 require Identity & Access-owned logical Device records and per-device management, but do not lock the canonical Device attributes, device-registration/linkage rules, or the evidence model used for anomalous-device decisions.
3. **Member onboarding contract** — Tickets 02/06/11 require Terms acceptance, mandatory profile data, and age/jurisdiction eligibility before affected capabilities are enabled, but do not lock the mandatory profile field set, Terms acceptance representation/version contract, or age/jurisdiction evidence rules.
4. **Sessions/devices external API shape** — Ticket 10 requires first-class Member sessions/devices resources, while the exact operations, paths, request shapes, and response representations are not specified beyond the resource-level requirement.

## Milestone disposition

The scoped Session foundation remains an implementation checkpoint, and Identity / Eligibility may continue through work packages whose approved behavior is explicit. Slices that depend on the unresolved details above must not invent policy values, resource shapes, or identity-evidence semantics; those details require an explicit implementation decision or Change Request before that affected slice proceeds.
