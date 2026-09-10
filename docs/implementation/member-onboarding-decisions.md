# Member onboarding implementation decisions — Terms acceptance + Member profile (Issue 64)

Source of truth: Wayfinder Tickets 01, 02, 06, 10, 11, 13, 16 and 19. This record
does not redefine those requirements. It records the concrete implementation
decisions taken to implement the previously-unlocked Member onboarding data
contracts — the same role `member-identity-decisions.md` played for the
OTP/session/device contracts (Issue 31) — because
`docs/implementation/identity-eligibility-status.md` (gap 3) records that the
mandatory profile field set, the Terms acceptance/version contract and the
age/jurisdiction evidence rules were never locked by the source documents.

## Scope

Member-owned onboarding facts (Ticket 01 assigns "onboarding state, terms
acceptance, and effective Member capability restrictions" to the Member context):

- a versioned Member Terms document that an Admin authors and publishes,
- a Member's immutable Terms acceptance,
- the mandatory Member profile data,
- `/api/v1/member/terms`, `/api/v1/member/terms/accept`, `/api/v1/member/profile`
  and the minimum Admin governance surface needed to make a version required.

Out of scope (Issue 64 explicitly): capability readiness / KYC eligibility
decisions (item 5), withdrawal preflight + deposit method/fee (item 6), OTP
RECOVERY (item 7), account recovery, frontend binding. No monetary effect.

## Decision 1 — Terms version contract

- `member_terms_documents` is a versioned document keyed by `(code, version)`,
  mirroring the repository's other versioned configuration (Promotion Campaign
  version, Lottery configuration version): `DRAFT → PUBLISHED → RETIRED`,
  optimistic `revision`, effective window, publication facts and approval
  evidence reference.
- v1 governs one agreement, `code = MEMBER_TERMS`. The code exists so a future
  agreement (a risk disclosure, a promotion T&C) is a new code rather than a
  rewrite of this one, and so an acceptance is always tied to a named document.
- A version is "currently required" exactly when it is `PUBLISHED` and
  `effectiveFrom <= now < effectiveUntil` (open-ended when `effectiveUntil` is
  null). A DRAFT, future-dated, expired or retired version is never required.
  This is a derivation from document state, not a flag.
- `contentDigest` is SHA-256 over the canonical `{code, version, title, body}`
  — the exact text a Member accepts. The digest is snapshotted on the
  acceptance, so a later Terms change can never rewrite what was accepted.
- `policyVersion` is an Admin-supplied governance reference carried onto the
  approval evidence (Ticket 08 approval evidence requires a policy version).
  It is intentionally *not* part of the accepted-text digest.
- Publication is maker-checker protected: the publishing Admin must differ from
  the author, must hold a fresh MFA/reauth for action class
  `member-terms.publish`, and must not publish a window that overlaps another
  published version of the same code. Approval evidence and audit record are
  written in the same transaction as the state change. Retirement is the
  terminal transition that frees an open-ended window for the next version.
- Supporting migrations/triggers enforce the same invariants at the database:
  published content is immutable, and a PUBLISHED row cannot exist without its
  publication facts.

## Decision 2 — Acceptance contract

- `member_terms_acceptances` holds one row per `(memberId, documentId)`
  (unique), with the accepted `documentCode`/`documentVersion`, the accepted
  `contentDigest`, `source`, `acceptedAt`, `evidence` (IP/user-agent) and the
  request `correlationId`.
- Acceptance is idempotent twice over: the same `Idempotency-Key` with the same
  payload replays the durable prior result, and accepting the same version again
  under a new key returns the existing evidence (`alreadyAccepted: true`)
  instead of writing a second row. Concurrency serializes on an advisory lock
  over `(member, document)` in addition to the keyed command lock, so the unique
  index is a backstop rather than the concurrency mechanism.
- Accepting a version that is not currently required is a `409`
  (`TERMS_VERSION_NOT_REQUIRED`): the Member is never recorded as having
  accepted terms it was not subject to. An unknown version is `404`.
- Phone possession is the precondition and is not re-invented here:
  registration/login only issue a Member session after a successful OTP
  challenge (Issue 31), and the acceptance requires an authenticated, `ACTIVE`
  Member, so no acceptance can be recorded for an unverified phone. Ticket 06
  models phone verification as a readiness requirement; persisting a separate
  `phoneVerifiedAt` is not required by this slice and is deliberately not
  invented here.
- `GET /member/terms` reports only durable acceptances. It never derives an
  "accepted" value from onboarding completion, KYC or a client claim. A Member
  with no acceptance sees `accepted: false` and `satisfied: false`.
- Acceptance evidence is immutable at the database level (BEFORE UPDATE OR
  DELETE trigger), like `audit_records` and `admin_approval_evidence`. There is
  no production update or delete path.

## Decision 3 — Mandatory profile field set

The source locks "mandatory profile fields" as a readiness requirement without
enumerating them (identity-eligibility-status gap 3). The implementation uses
the three fields the locked Member prototype collects
(`docs/mockups/member-frontend-ios/profile.html`, `member-profile.html`):

| field | storage | rule |
|---|---|---|
| `fullName` | `members.full_name` TEXT | trimmed, 1–200 chars; blank clears |
| `dateOfBirth` | `members.date_of_birth` DATE | real `YYYY-MM-DD` date, not in the future, not before 1900-01-01 |
| `province` | `members.province` TEXT | trimmed, 1–100 chars; blank clears |

- `GET /member/profile` returns the Member's own values plus `mandatoryFields`,
  `missingMandatoryFields` and `profileComplete`. Completeness is derived from
  stored values only.
- `PATCH /member/profile` accepts only these three fields (strict schema), and
  explicitly refuses server-owned/trusted facts (`phone`, `status`, `kycStatus`,
  `termsAccepted`, identifiers) with `400 VALIDATION_ERROR` naming the offending
  field — never a silent no-op that a client could mistake for acceptance.
- `phone` is the login identity owned by Identity & Access and is exposed
  read-only; email is deliberately not added here (not collected by the locked
  prototype and not needed by this slice).
- The `1900-01-01` lower bound is a format/typo sanity bound, not an age policy.
  Age/jurisdiction **eligibility** stays with the capability-readiness slice
  (Issue 64 item 5), which is where a threshold belongs; no age threshold is
  invented here.
- Clearing a field is allowed and is reported as missing — clearing never
  fabricates completeness. A Member profile is not a governed financial fact, so
  there is no approval/version lifecycle; last-write-wins with `profileUpdatedAt`
  recorded.

## Decision 4 — Admin governance surface (minimum)

- `POST /api/v1/admin/member-terms` authors a DRAFT version (`member-terms.manage`),
  `POST /api/v1/admin/member-terms/{id}/publish` approves/publishes it
  (`member-terms.approve` + fresh MFA), `POST /api/v1/admin/member-terms/{id}/retire`
  retires it (`member-terms.manage`), and `GET` list/detail are
  `member-terms.read`. All mutations require an `Idempotency-Key`.
- Three new Admin capabilities (`member-terms.read`, `member-terms.manage`,
  `member-terms.approve`) were added to the capability registry: SUPER_ADMIN and
  ADMIN hold all three, AUDITOR holds `member-terms.read`.
- `tests/unit/admin-auth-security.spec.ts` locks the role→capability mapping and
  was extended with the same three capabilities — the mapping is a locked list,
  so extending it is the intended change rather than a relaxation.

## Verification

- Domain unit tests: `tests/unit/terms-document.spec.ts`,
  `tests/unit/profile-fields.spec.ts`.
- API contract: `tests/contract/member-onboarding-api.contract.spec.ts`
  (declared success schemas, no persistence leakage, capability gating,
  Idempotency-Key on every critical mutation).
- Deterministic integration evidence (happy / denial / idempotency /
  incomplete profile / trusted-fact rejection / DB-level immutability):
  `tests/integration/member-terms-profile.integration.spec.ts` against Postgres.
- `pnpm check` (generate → openapi → typecheck → test → build) must pass; the
  regenerated OpenAPI exposes 108 paths / 118 operations / 132 schemas with no
  Prisma/entity leakage.

This is an implementation checkpoint. It is not Ticket 16 acceptance of the
Identity / Eligibility milestone, and it does not claim capability readiness —
it produces the requirements that slice will read.
