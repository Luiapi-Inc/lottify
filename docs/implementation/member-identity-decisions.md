# Member Identity/Eligibility implementation decisions (Issue 31)

Source of truth: Wayfinder Tickets 02, 06, 10, 11, 16, 19. This record does not
redefine those requirements; it records the concrete implementation decisions
made to implement the previously-unlocked OTP/Device/session REST and storage
contracts, as the repository checkpoint required before this slice proceeds.

## Scope

This vertical delivers Member phone registration/login, purpose-scoped OTP
request/verify, and Member session/device management as domain application
services in `identity-access` plus `/api/v1/member` REST. It reuses the existing
member-scoped rotating refresh session foundation (`SessionService` +
`AuthSession`) rather than introducing a second session mechanism.

## Decision 1 — Member identity and storage

- Member login identity is the phone number, stored canonicalized to E.164
  (`member-phone.ts`). Email remains profile data and is not a login identifier.
- New tables `members`, `member_devices`, `member_otp_challenges` (migration
  `20260909190000_member_identity`). `auth_sessions` already existed and is the
  Member session store.
- `members.phone` is unique: the phone is the identity, so a concurrent/duplicate
  REGISTER resolves to the same account rather than creating a duplicate.

## Decision 2 — OTP purpose + policy values

- OTP request/verify are purpose-scoped (`LOGIN`, `REGISTER`; `REAUTH` is a
  reserved purpose reserved for later sensitive-action self-service).
- Concrete policy bindings (previously unlocked, per Ticket 06 controls and
  Ticket 13 baselines) live in `env.ts` defaults:
  - code length 6, TTL 300s, max verify attempts 5,
  - resend cooldown 60s, request window 900s with max 5 requests/window.
- `MEMBER_OTP_REQUEST_MAX_PER_WINDOW` and `requestWindowSeconds` implement the
  Ticket 13 "OTP request 5 / 15 minutes" baseline. Codes are stored only as
  SHA-256 hashes and are never returned by the API.

## Decision 3 — Anti-enumeration

- OTP request returns the same shape for registered and unregistered phones and
  never returns the code. Request-time account enumeration is therefore not
  possible. After a successful OTP verify the Member has proven phone possession,
  so `LOGIN` on an unregistered phone may safely return `MEMBER_NOT_REGISTERED`
  to route the client to registration.

## Decision 4 — REGISTER vs LOGIN

- `REGISTER` verify creates the Member on first verified use and authenticates
  them. A REGISTER for an already-active phone authenticates the same account
  (`accountCreated: false`) instead of creating a duplicate.
- `LOGIN` verify requires an existing `ACTIVE` Member; it never creates an
  account. Registration/login eligibility here is bounded to phone identity +
  account status; the KYC/risk duplicate-account and capability-restriction
  policy slices remain separate (Ticket 06 domain already ships, but wiring them
  to Member capability state is a later eligibility slice).

## Decision 5 — Single-use and concurrency

- A challenge is consumed atomically (`updateMany ... where consumedAt: null`);
  a replay of the same code is denied with `OTP_ALREADY_USED`.
- Member creation is duplicate-safe under a phone-unique constraint.

## Decision 6 — Session/device REST surface

- `POST /api/v1/member/auth/otp/request`, `/otp/verify`, `/refresh`, `/logout`,
  `/revoke-all`, `GET /me`.
- First-class Member resources: `GET /api/v1/member/sessions`,
  `DELETE /api/v1/member/sessions/{id}`, `GET /api/v1/member/devices`,
  `DELETE /api/v1/member/devices/{id}` (device revoke revokes its sessions).
- Refresh is delivered as an HttpOnly cookie scoped to `/api/v1/member`; access
  tokens are returned in the body. Member access tokens carry `actor: member`
  so Member and Admin token spaces are mutually exclusive.
- OTP delivery is behind a port (`MemberOtpDeliveryPort`) with a local sink
  adapter; Notification provider integration (Ticket 09) is out of scope and can
  be wired later without touching the auth flow.

## Evidence (local, this worktree)

- typecheck, unit (member OTP policy + member auth service), contract
  (member OpenAPI), and DB integration tests pass; pre-existing admin auth and
  foundation integration tests also pass, confirming no admin/member token
  regression. See the completion handoff for the exact run.
