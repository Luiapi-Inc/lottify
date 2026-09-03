# Lock provider integration, webhook and asynchronous reliability contracts

Type: grilling
Status: resolved
Blocked by: 02, 04

## Question

What exact adapter contracts, provider transaction identities, webhook authenticity/replay rules, idempotency scopes, outbox events, consumer deduplication, retry/dead-letter/replay semantics, provider health/routing/failover behavior, secret references, and correlation rules apply across Payments, KYC, SMS/Notification, and Result providers?

## Comments

### Provider/async round 1 — confirmed

- Provider adapter boundary: each external integration is hidden behind a domain-owned adapter interface so core workflows never depend on vendor-specific payloads or status codes. v1 covers at least Payment, KYC, SMS/Notification, and Result providers. Adapters own request mapping, response normalization, provider-error classification, status queries, and webhook normalization; vendor-native statuses do not become canonical business states directly.
- Provider transaction identity: every external operation records separate internal business transaction identity, provider identity, provider transaction/reference identity, request-attempt identity, provider idempotency/reference key when available, and correlation identity. `provider + providerTransactionId` is unique within the provider-guaranteed scope, and the mapping to the internal workflow is immutable and auditable.
- Webhook authenticity: an incoming webhook must pass provider authentication/signature verification, timestamp-tolerance validation, replay protection, evidence/raw-metadata retention, payload normalization, and business state-transition/idempotency validation before it can advance a workflow. Invalid webhooks are rejected/audited; valid duplicates are idempotent according to the provider contract; no money or payout state is changed from unverified payloads.
- Webhook deduplication: deduplication uses the strongest stable provider event identity available. If no stable event id exists, the adapter derives a deterministic fingerprint from immutable signed fields. Webhook-event dedupe is distinct from business-effect idempotency, so multiple events or retries that refer to one business transaction can still produce only one authoritative business/financial effect.
- Unknown provider outcome: timeout/network failure after an outbound request is treated as ambiguous rather than definitive failure. The owner workflow enters reconciliation/unknown-outcome handling, queries the provider by known reference, consumes authoritative webhook/status evidence, and retries an external side effect only after it is proven safe. Blind payout retry is forbidden.

### Provider/async round 2 — confirmed

- Transactional Outbox: any cross-subsystem event that must reflect an authoritative state change is written in the same PostgreSQL transaction as that state change. Each Outbox Event carries at least `eventId`, event type/version, aggregate or business reference, `occurredAt`, `correlationId`, `causationId`, and payload. Publishing can retry independently without re-running or mutating the originating business transaction.
- Consumer deduplication: every async consumer is idempotent through durable processed-message/event identity and/or domain uniqueness guards. At-least-once delivery is acceptable, but each business or financial effect remains once-only. Queue/broker exactly-once delivery is never treated as a financial invariant.
- Retry, dead-letter, and replay: transient failures use bounded exponential backoff with jitter; non-retryable business failures go directly to a governed failure/review state rather than looping. Exhausted retries move to DLQ/review. Replay is permissioned and audited, preserves the original business/idempotency identities, and cannot create duplicate effects.
- Provider health, routing, and failover: routing evaluates provider enablement, capability, configured priority, health, and circuit-breaker state. Automatic failover is permitted only before an external operation is committed or has entered an ambiguous outcome. Once a workflow is bound to a provider transaction, it cannot switch provider mid-flight unless a workflow-specific recovery path proves the transition safe.
- Secrets and correlation: provider configuration stores secret references rather than plaintext credentials; rotation is versioned/audited and logs/events must not leak secrets or sensitive PII. A `correlationId` traces the chain from API through workflow, provider attempt, webhook, Ledger/outbox/job, while business IDs, provider IDs, and idempotency keys remain separate identities with distinct semantics.

### Provider/async round 3 — confirmed

- Provider error taxonomy: adapters normalize provider failures into canonical categories such as `TRANSIENT`, `DEFINITIVE_FAILURE`, `BUSINESS_REJECTION`, `AMBIGUOUS_OUTCOME`, and `INTEGRATION_CONTRACT_ERROR`. Retry policy is driven by this canonical classification; only categories explicitly marked retryable may be retried automatically.
- Outbound idempotency: retries of the same external side effect reuse the same provider idempotency/reference key and business identity. A timeout or transport retry does not create a fresh external operation identity merely because a new HTTP attempt is made.
- Event schema versioning: Outbox/domain events carry an explicit schema version. Version evolution is backward-compatible within the declared support window, consumers declare the versions they understand, and the meaning of an already published event version is never changed in place.
- Provider evidence retention: request, response, webhook, signature-validation, and reconciliation evidence is retained only to the extent required for operations, audit, and dispute/reconciliation policy. Secrets and unnecessary PII are redacted; hashes or immutable references may be retained to prove payload/evidence identity without propagating plaintext sensitive data.
- Domain-specific provider authority: Payment workflows complete only after authoritative provider outcome plus required Ledger posting; KYC provider outcomes are normalized before policy decisions; conflicting Result-provider evidence enters review and cannot auto-settle; SMS/Notification delivery attempts remain non-authoritative side effects unless an explicit policy makes delivery/acknowledgement a prerequisite.

## Answer

Lottify v1 isolates every external integration behind domain-owned provider adapters and treats asynchronous delivery as at-least-once while preserving once-only business effects.

1. Payment, KYC, SMS/Notification, and Result providers expose canonical adapter contracts for request mapping, status normalization, error classification, status lookup, and webhook normalization; vendor-native states never become business states directly.
2. Internal business IDs, provider IDs, provider transaction/reference IDs, request-attempt IDs, outbound idempotency keys, and correlation IDs are separate immutable identities with explicit scope.
3. Incoming webhooks must pass authentication/signature validation, timestamp/replay protection, evidence retention, normalization, and state/idempotency checks before they can advance a workflow. Event dedupe is distinct from business-effect idempotency.
4. Ambiguous outbound outcomes enter reconciliation and provider-status verification before retry or compensation; blind payout retry is forbidden.
5. Authoritative state changes and Outbox Events are committed atomically in PostgreSQL. Consumers are idempotent, at-least-once delivery is acceptable, and queue exactly-once guarantees are not financial invariants.
6. Retry uses canonical error taxonomy, bounded backoff, DLQ/review, and permissioned audited replay while preserving original business/idempotency identities.
7. Provider routing considers enablement, capability, priority, health and circuit-breaker state. Automatic failover is allowed only before an operation is committed or ambiguous; bound provider transactions are not silently switched mid-flight.
8. Provider configuration stores secret references, not plaintext credentials. Rotation and access are audited, logs/events redact secrets and sensitive PII, and retained provider evidence is governed and tamper-evident.
9. Outbound retries reuse the same provider operation identity/idempotency reference; a transport retry does not create a logically new external side effect.
10. Outbox/domain event schemas are explicitly versioned and evolve compatibly without changing historical version meaning.
11. Domain authority remains local: provider evidence informs the owning workflow, but completion still obeys domain-specific invariants such as verified payment plus Ledger posting, normalized KYC policy decisions, conflict-reviewed Results, and non-authoritative notification delivery.

These contracts allow external providers, queues, callbacks, retries, replays and failover to remain replaceable and failure-tolerant without duplicating money, identity decisions, settlement outcomes or other business effects.
