# Observability & operational alerting — contract and configuration (GH #92)

This document is the operational reference for the Lottify observability and
alerting surface. It records the OTLP endpoint contract, the ops-exposure
model, the correlationId→log→trace linkage, and the operational alert pipeline.
It closes the W5 telemetry findings (W5-F1, W5-F2, W5-F3, W5-F4) on candidate
`0d3b6cb1`.

## 1. OTLP endpoint contract (`OTEL_EXPORTER_OTLP_ENDPOINT`)

`OTEL_EXPORTER_OTLP_ENDPOINT` is the OpenTelemetry-spec **base** endpoint shared
by every telemetry signal. Each signal appends its own path segment:

- traces → `{endpoint}/v1/traces`
- metrics → `{endpoint}/v1/metrics`

The exporter resolution (`src/platform/observability/observability.ts`,
`resolveOtlpSignalUrl`) strips a trailing slash and any already-present
`/v1/traces` / `/v1/metrics` / `/v1` suffix before appending the per-signal
segment, so all of these shapes configure identical, consistent exporters:

| Input                                         | traces POST to        | metrics POST to       |
|-----------------------------------------------|-----------------------|-----------------------|
| `http://collector:4318`                       | `/v1/traces`          | `/v1/metrics`         |
| `http://collector:4318/v1`                    | `/v1/traces`          | `/v1/metrics`         |
| `http://collector:4318/v1/traces`             | `/v1/traces`          | `/v1/metrics`         |

The API configures an explicit `PeriodicExportingMetricReader` alongside the
trace exporter so metrics export is deterministic and both signals use the same
base. Previously the trace exporter consumed the variable verbatim while the
SDK's metric exporter treated it as a base URL — one signal was always silently
lost. Leave the variable empty to disable OTLP export.

See `.env.example` for the documented value shape.

## 2. Ops exposure (`/metrics`, `/internal/health/*`)

`GET /metrics` and `GET /internal/health/*` are gated by `OpsAuthGuard`
(`apps/api/src/ops-auth.guard.ts`). When `OPS_AUTH_TOKEN` is set (production),
requests must present `Authorization: Bearer <OPS_AUTH_TOKEN>`; otherwise 401.
The environment schema (`src/platform/config/env.ts`) refuses to boot
`staging`/`production` without `OPS_AUTH_TOKEN`, so in those environments the
ops surface can never be left unauthenticated on the shared listener. The
open/pass-through guard only applies to `local`/`test` (sandbox probes and the
container smoke test, which runs `APP_ENV=test`, keep working unchanged).

The committed Prometheus scrape + alert configuration lives under
`deploy/observability/prometheus/`:

- `prometheus.yml` — scrape config for the `lottify-api` job, supplying the
  `OPS_AUTH_TOKEN` bearer token.
- `alerts.yml` — alerting rules mirroring `alert-definitions.yaml`.

The operational endpoints remain on the shared API listener; the bearer token
isolates them from public traffic. A future separate ops listener can be added
without changing the guard.

## 3. correlationId → log → trace linkage

`x-correlation-id` is resolved once per request by pino-http `genReqId`
(`apps/api/src/main.ts`) using the same rule as `CorrelationMiddleware`
(`apps/api/src/correlation.middleware.ts`, `resolveCorrelationId` in
`apps/api/src/correlation.ts`): a caller-supplied header within 128 chars is
accepted, otherwise a UUID is generated.

- **Logs**: the access-log record carries `correlationId` (via pino `genReqId`
  + `customProps`), so log lines are joinable to the transaction id.
- **Traces**: the active span gets the `lottify.correlation_id` attribute, so
  the exported OTLP payload carries it and the transaction is joinable from
  telemetry.
- **Persisted state**: the id flows into the durable domain rows that carry it
  — e.g. `payment_deposits.correlation_id` on the deposit, and
  `financial_transactions.correlation_id` on the ledger posting that a
  completed deposit credits (both proven at runtime — see
  `.hermes/evidence/release/w5-telemetry-fix-0d3b6cb1.md`).

**Outbox/worker hop (not yet drivable).** The outbox persists/propagates
`correlation_id` by code (`outbox.service.ts` persists it, the dispatcher
forwards it to the queue job), but **no business flow currently enqueues an
outbox event** — the repo has no outbox producer wired into a context service.
An end-to-end API → workflow → Ledger → Outbox/worker trace from telemetry is
therefore not demonstrable today; a follow-up card tracks wiring a live outbox
producer and carrying the id across the worker hop.

## 4. Operational alert pipeline

The worker alert pipeline (`apps/workers/src/operational-alert.sink.ts`) is a
routing sink composed of:

- `SentryOperationalAlertSink` — logs and captures to Sentry when `SENTRY_DSN`
  is set.
- `WebhookOperationalAlertSink` — POSTs a JSON alert payload to every
  `OPERATIONAL_ALERT_WEBHOOK_URLS` (comma-separated) endpoint, fire-and-forget
  with a 5s timeout; no-op when unset.

The seven Ticket 13 alert families are enumerated in
`deploy/observability/alert-definitions.yaml` with their codes, severities,
conditions, source signals, and default routes, mirrored as Prometheus rules in
`deploy/observability/prometheus/alerts.yml`. Family 1 (reconciliation
discrepancy) has an in-code detector
(`apps/workers/src/ledger-wallet-reconciliation-freshness.worker.ts`). Families
2–7 are declared as rules and activate once their backing metrics are produced
(see the `detector_status` field in `alert-definitions.yaml`).
