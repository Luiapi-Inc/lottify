# Set measurable non-functional targets and release gates

Type: grilling
Status: resolved
Blocked by:

## Question

What measurable v1 targets and acceptance thresholds apply to concurrent users, quote/confirm throughput, payment callbacks, settlement throughput, API latency/error rate, queue lag, recovery objectives, backup/PITR restore, observability coverage, security/rate limiting, reconciliation freshness, and production GO/NO-GO evidence?

## Comments

### NFR round 1 — confirmed

- Capacity baseline: the v1 production acceptance target is 5,000 concurrently active Member sessions, at least 300 Quote requests/second, at least 150 Confirm requests/second, and at least 200 payment/webhook events/second under production-like tests. Tests include realistic pre-cutoff burst behavior rather than steady-state traffic only, and no critical business or financial effect may duplicate under load. These are acceptance targets to prove, not claims about current infrastructure capacity.
- API latency/error SLO: at production-like load, ordinary read APIs target `p95 <= 300 ms` and `p99 <= 800 ms`; Quote targets `p95 <= 500 ms` and `p99 <= 1.5 s`; Confirm targets `p95 <= 800 ms` and `p99 <= 2 s`. Critical API server error rate must remain below 0.5%. v1 monthly service availability target is at least 99.9%, excluding only policy-governed announced planned maintenance. External-provider latency is measured separately from Lottify-owned processing time.
- Queue and settlement targets: critical Outbox/queue delivery targets `p95 < 5 s` under normal operation, with alerting if critical lag exceeds 30 seconds. Webhooks are authenticated/validated and durably accepted before success is acknowledged. Settlement capacity target is at least 100,000 Bet Lines within 10 minutes for the configured worker pool; failures must resume idempotently and partial completion is never Member-visible. Critical DLQ entries alert immediately.
- Backup and disaster recovery: PostgreSQL uses continuous PITR with `RPO <= 5 minutes` and `RTO <= 60 minutes`, plus automated daily backups under an explicit retention policy. Restore verification runs at least monthly. Production GO is blocked until restore has been proven, and restore validation checks Ledger invariants, schema/migration state, and integrity of critical business references rather than database availability alone.
- Observability coverage: production requires structured logs, metrics, distributed traces, error tracking, and shared `correlationId` propagation across critical workflows. Required business alerts include Confirm error/failure spikes, payment/webhook failure, stuck/reconciling Withdrawals, Settlement failure, queue/DLQ lag, reconciliation discrepancies, and provider health degradation. A critical transaction must be traceable from API through workflow and onward to Ledger/provider and Outbox/worker activity.

### NFR round 2 — confirmed

- Rate limiting and abuse protection are policy-configurable by endpoint and may combine principal, IP, device, and risk signals. Baseline v1 limits are OTP request `5 / 15 minutes / phone+IP`, OTP verify `10 attempts / challenge`, Quote `60 requests/minute/Member` with burst control, Confirm `30 requests/minute/Member`, Withdrawal create `5/hour/Member`, and stricter per-session/action limits for sensitive Admin commands. Elevated risk may reduce limits or require challenge/blocking, while idempotent retries remain the same logical operation rather than a new transaction.
- Security release gate: production GO requires dependency/container vulnerability scans with no unresolved Critical findings, secrets scanning, auth/session/OTP/MFA/re-auth tests, RBAC/approval negative-path tests, webhook signature/replay tests, financial/idempotency race tests, and verification that sensitive logs do not leak credentials, tokens, secrets, or protected PII. High-severity findings require explicit governed risk acceptance; Critical findings cannot be waived for the v1 launch.
- Reconciliation freshness is measurable: Ledger-to-Wallet projection mismatches alert within 1 minute; Payment/provider reconciliation runs continuously plus a scheduled sweep at least every 5 minutes; Betting/Settlement-to-Ledger reconciliation runs after batch completion plus periodic sweep. Unresolved monetary discrepancies older than 15 minutes raise an operational alert, while critical/high-value discrepancies escalate immediately.
- Production GO/NO-GO evidence is mandatory and follows `Requirement → Approved design/specification → Implementation → Automated tests → Functional/visual verification → Performance/security evidence → Migration/backup/restore evidence → Deployment plan → Rollback plan`. Any mandatory missing evidence is a NO-GO even if build and CI are green.
- Rollback and production verification gate: before deployment, migration compatibility, rollback/roll-forward procedures, backup/PITR checkpoint, and critical config/secret/provider readiness must be verified. After deployment, smoke tests cover critical Member/Admin flows, financial invariants, queue/provider/observability health, and abnormal error/latency detection. Financial or data-integrity invariant failure triggers scoped traffic stop/kill-switch and evidence-based rollback or forward recovery rather than live ad-hoc mutation.

## Answer

Lottify v1 uses measurable non-functional acceptance targets and a hard production evidence gate rather than treating successful builds as release readiness.

1. Capacity acceptance target is 5,000 concurrent active Member sessions, 300 Quote requests/second, 150 Confirm requests/second, and 200 payment/webhook events/second under production-like burst testing, with once-only critical effects under load.
2. API SLOs are explicit: read `p95 <= 300 ms`, `p99 <= 800 ms`; Quote `p95 <= 500 ms`, `p99 <= 1.5 s`; Confirm `p95 <= 800 ms`, `p99 <= 2 s`; critical server-error rate below 0.5%; monthly availability at least 99.9% excluding governed planned maintenance.
3. Critical queue lag targets `p95 < 5 s`, alerting above 30 seconds, immediate alert for critical DLQ entries, and webhook durability before success acknowledgement.
4. Settlement capacity target is at least 100,000 Bet Lines within 10 minutes for the configured worker pool, with idempotent resume and no Member-visible partial completion.
5. PostgreSQL recovery targets are `RPO <= 5 minutes` and `RTO <= 60 minutes` with continuous PITR, daily backup, monthly restore verification, and integrity validation of Ledger/schema/business references.
6. Production observability requires structured logs, metrics, traces, error tracking, correlation propagation, and business alerts across betting, payments, withdrawals, settlement, queues, reconciliation, and provider health.
7. Endpoint/risk-based rate limits and anti-abuse controls are configurable, with explicit OTP, Quote, Confirm, Withdrawal, and Admin baselines and preservation of idempotent retry semantics.
8. Security GO requires clean Critical vulnerability posture, secrets protection, authentication/authorization/webhook/idempotency-race coverage, and no sensitive-data leakage in operational telemetry.
9. Reconciliation has freshness SLOs and escalation thresholds for Wallet/Ledger, provider payments, and Betting/Settlement discrepancies.
10. Production GO requires complete evidence across requirements, design, implementation, tests, functional/visual result, performance/security, migration/backup/restore, deployment, and rollback. Missing mandatory evidence is NO-GO.
11. Pre/post-deploy verification includes migration compatibility, recovery readiness, critical flow smoke tests, financial invariants, and operational health; integrity failure invokes governed stop/kill-switch and rollback or forward recovery.

These targets define objective release readiness and force reliability, security, recovery, reconciliation, and operational evidence to be proven before Lottify v1 is considered production-ready.
