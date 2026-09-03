# Lock REST/OpenAPI resource model and contract conventions

Type: grilling
Status: resolved
Blocked by: 02, 03, 04, 05, 06, 07, 08, 09

## Question

What are the exact /api/v1 Member/Admin resources, commands, query shapes, idempotency requirements, pagination/filter/sort conventions, error-code taxonomy, concurrency/version semantics, realtime event contracts, generated-client boundaries, and compatibility rules needed to express the approved workflows without leaking persistence internals?

## Comments

### API round 1 — confirmed

- API boundary: REST under `/api/v1` is organized around business resources rather than persistence/table structure. Member, Admin, and provider webhook/integration surfaces are explicit; shared domain contracts may be reused where appropriate while authorization and representation remain use-case specific.
- Resource versus command endpoints: ordinary resource operations use REST resource semantics, while invariant-bearing state transitions use explicit command endpoints such as Bet Order confirm/cancel, Withdrawal cancel, Draw publish, Result confirm, and Approval approve. Generic `PATCH status=...` cannot bypass workflow/state-machine guards.
- Member betting resources: the canonical Member flow exposes Lottery Products, Product Draws, Draw detail/Bet Types, Bet Quotes, Bet Orders, confirm/cancel commands, and Bet Order detail/history. Quote responses include resolved payout, restrictions, normalized lines, total, expiry, and authoritative server/cutoff timing used for the decision.
- Critical mutation idempotency: critical mutations require `Idempotency-Key`, including Quote, Bet Order create/confirm/cancel, Deposit initiation, Withdrawal create/cancel, sensitive Admin commands, and financial adjustments. Scope is principal + operation/endpoint + logical business scope. Same key and same payload returns the same result; same key with different payload returns `IDEMPOTENCY_CONFLICT`.
- API state representation: responses expose canonical domain state plus relevant accepted snapshots, financial/settlement/refund trail, `allowedActions`, resource `version`, and timestamps without leaking internal orchestration implementation. Clients do not infer authorization or valid transitions from status alone.

### API round 2 — confirmed

- Pagination/filter/sort: list APIs use cursor pagination by default for large or fast-changing collections, with `limit` and `cursor`. Filters are explicit allowlists per resource, sorting uses an explicit `field:asc|desc` convention, and every default/explicit sort has a stable tie-breaker such as `createdAt desc, id desc`. Arbitrary persistence-field filtering is not exposed.
- Error contract: all endpoints return the common machine-readable error shape `code`, `message`, `details`, and `correlationId` with appropriate HTTP status. Shared codes include validation/auth/access/not-found/state/version/idempotency/rate-limit failures plus stable domain codes such as `DRAW_CLOSED`, `QUOTE_EXPIRED`, and `INSUFFICIENT_FUNDS`; clients branch on `code`, never by parsing human messages.
- Concurrency/versioning: mutable Admin/config resources and race-sensitive workflow commands expose a resource `version` and require optimistic concurrency when the action depends on current state, using `expectedVersion` or `If-Match`. Stale writes/commands fail with `VERSION_CONFLICT` and require refresh/re-evaluation; silent last-write-wins is forbidden for governed state.
- Realtime contracts: realtime events are notification/read-model update signals rather than authoritative state. Events carry an explicit event type/version, resource identity/version, `occurredAt`, `correlationId`, and only the minimal safe payload. Clients must recover missed events through REST refresh/polling, and realtime delivery never instructs the client to perform an authoritative business mutation without the corresponding API command.
- OpenAPI/generated-client compatibility: OpenAPI is the authoritative external REST contract and Member/Admin applications consume generated typed clients. CI performs breaking-change compatibility checks. `/api/v1` evolves additively/backward-compatibly; published fields, enum meanings, and operation semantics are not silently removed/renamed/redefined. Breaking changes require an explicit version/migration strategy.

### API round 3 — confirmed

- Member non-betting resources: Member APIs expose purpose-scoped authentication/OTP, current profile, sessions/devices, Wallet and transaction history, Deposits, Withdrawals, Payout Destinations, Verification Cases, Promotion Entitlements, and notification preferences as first-class resources. Member representations and commands remain least-privilege and are not direct reuse of Admin representations.
- Admin resource surface: operational resources live under `/api/v1/admin/...` and cover Product/Draw/Bet Type/schedule configuration, Results and Settlement Batches, Deposits/Withdrawals, Members/restrictions/verification, Promotions, reconciliation/discrepancies, Approvals, Providers, Audit, configuration, maintenance, and kill switches. Invariant-bearing transitions remain explicit command endpoints rather than generic status patches.
- Canonical wire formats: identifiers are opaque strings; money is represented as integer minor units plus currency (for example `{ amountMinor, currency }`) and never binary floating point; timestamps are canonical RFC 3339/ISO-8601 instants with business timezone represented separately where required; enums are documented strings; and OpenAPI distinguishes omitted fields from explicit `null` where semantics differ.
- Long-running operations: asynchronous work such as exports, large reconciliation, settlement/replay, or other non-immediate jobs returns `202 Accepted` plus an Operation/Job resource. Clients query durable status such as `QUEUED`, `RUNNING`, `SUCCEEDED`, or `FAILED` and receive result/error references rather than holding a long HTTP request open.
- Authentication contract: OTP request/verify endpoints are explicit and purpose-scoped; successful authentication issues short-lived access plus rotating refresh-session semantics; refresh reuse/revocation is server-enforced; sessions/devices are first-class manageable resources; Admin MFA/re-authentication uses trusted server-side session evidence; clients cannot self-assert trusted facts such as `mfaVerified=true` on sensitive commands.

## Answer

Lottify v1 exposes a versioned REST/OpenAPI contract under `/api/v1` that mirrors approved business resources and workflows without leaking persistence or orchestration internals.

1. Member, Admin, and provider/integration surfaces are explicit and use business-resource representations rather than database tables.
2. Stateful business transitions use explicit command endpoints; generic status mutation cannot bypass domain guards.
3. Member betting APIs cover Product/Draw/Bet Type discovery, Quote, Bet Order creation/confirm/cancel, and Bet history with accepted payout/restriction/timing snapshots.
4. Critical mutations require scoped `Idempotency-Key`; identical retry returns the prior result while a changed payload conflicts.
5. Resource responses expose canonical state, accepted snapshots, `allowedActions`, version, and timestamps while hiding internal orchestration mechanics.
6. Lists use deterministic cursor pagination with allowlisted filters/sorts and stable tie-breakers.
7. Errors use one machine-readable `code/message/details/correlationId` contract with stable shared and domain error codes.
8. Race-sensitive mutations use optimistic resource versioning and return `VERSION_CONFLICT` instead of silent last-write-wins.
9. Realtime events are versioned read/update signals only; REST remains recoverable source access when events are missed.
10. OpenAPI is authoritative for generated clients, and `/api/v1` evolves only compatibly unless an explicit version/migration path is introduced.
11. Member non-betting resources cover authentication, profile/session/device management, Wallet, Payments, KYC, Promotions, and notification preferences with Member-specific least-privilege representations.
12. Admin resources live under `/api/v1/admin/...` and expose the operational control plane through explicit governed commands.
13. Wire formats use opaque IDs, integer minor-unit money plus currency, canonical instants, explicit timezone where needed, documented enums, and precise omitted/null semantics.
14. Long-running work uses `202 Accepted` plus durable Operation/Job resources rather than long-lived synchronous requests.
15. Authentication is purpose-scoped and server-authoritative: rotating refresh/session state, MFA/re-auth evidence, and security decisions are never trusted from client-supplied booleans.

These conventions make Member/Admin clients generated, testable, backward-compatible, race-safe, idempotent, and aligned with the locked domain/state/financial/provider invariants.
