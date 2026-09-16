# Ticket 13 load harness: scenario identity, target environment and open decisions

Status: **DRAFT — the target-environment specification below requires Lead/owner
sign-off before a `target`-profile run can be accepted as capacity evidence.**
The harness itself (scenario, drivers, seeding, assertions) is implemented and
re-runnable; only the environment the acceptance run must happen on is undecided,
and the card that requested this work says that decision belongs to the Lead.

Card: `t_4fd8e4a7` (W5, GH #91). Source of targets:
`.scratch/lottify-v1-specification/issues/13-non-functional-targets-and-release-gates.md`.

## 1. Requirement → Evidence → Actual Result → Next action

**Requirement.** GH #91 / Ticket 13 needs candidate-bound, reproducible proof of:
5,000 concurrently active Member sessions; ≥300 Quote req/s; ≥150 Confirm req/s;
≥200 payment/webhook events/s under realistic pre-cutoff burst; read p95 ≤ 300 ms /
p99 ≤ 800 ms, Quote p95 ≤ 500 ms / p99 ≤ 1.5 s, Confirm p95 ≤ 800 ms / p99 ≤ 2 s;
critical error rate < 0.5 %; critical queue/outbox lag p95 < 5 s (alert > 30 s);
settlement ≥ 100,000 Bet Lines in 10 minutes with idempotent resume and no
Member-visible partial completion; no duplicate financial effect under load.

**Evidence now in the repository.**

- `tools/load-harness/scenarios/ticket13.capacity.json` — every threshold above,
  transcribed; `lib/scenario.mjs` rejects a scenario that weakens any of them, and
  `tests/unit/load-harness.spec.ts` asserts that in CI.
- `tools/load-harness/run.mjs` + `drivers/*` — the five measurements, each writing
  `VERDICT ∈ {PASS, FAIL, MEASURED, NOT_MEASURED, ENV_GATED}` where only a profile
  with `claimsTarget: true` can ever produce PASS/FAIL.
- `tools/load-harness/seed/seed-load-fixtures.ts` — test-scoped provisioning of
  BET-eligible Members, sessions, funding and the settlement Order population.
- `tools/load-harness/seed/assert-financial-effects.ts` — independent SQL
  assertions for once-only stake/settlement effects and batch scope.
- `tools/load-harness/scripts/scratch-db.sh` — a dedicated `lottify_load_*`
  database built from the candidate's own migration chain, so a run never depends
  on (or damages) shared data.
- A smoke-profile run on this sandbox proves the plumbing (see §4); it is **not**
  capacity evidence and is reported as `MEASURED`.

**Actual result.** Capacity/SLO numbers for Ticket 13 remain **unproven**:
0 of 11 targets can be certified until the harness runs on a production-like
environment, and 2 of them are additionally blocked on missing capability (below).

**Next action.** Lead signs off (or amends) §3, then the `target` profile is run
there once per release candidate and the report is attached to the release
evidence. Two capability gaps need separate decisions (§5).

## 2. Why this sandbox cannot certify the targets

`lib/environment.mjs` computes a mechanical `productionLike` verdict from the
fingerprint it records in every report. This host fails it on:

- 2 vCPU available (cgroups limit), 3.7 GiB RAM (≈0.9 GiB free during a run);
- the load driver is co-located with the API, so driver cost is inside the
  measurement;
- the database is a shared development database (`lottify_dev`), not a dedicated
  load database;
- no queue/outbox/DLQ lag or settlement-throughput metric exists to observe the
  lag and throughput SLOs (see the telemetry card `t_79b28bfc`).

`run.mjs` therefore refuses `--profile target` here rather than printing a
misleading FAIL, and every report states the assessment verbatim.

## 3. PROPOSED production-like environment specification (needs sign-off)

| Item | Proposed requirement | Why this number |
|---|---|---|
| API nodes | ≥3 stateless API instances behind one L7 load balancer, ≥4 vCPU each, no co-located load driver | 5,000 sessions + 300 Quote rps + 150 Confirm rps must survive the loss of one node; the driver must be a separate host so driver cost is excluded |
| Load generator | ≥2 separate hosts (≥8 vCPU each), one per driver family (sessions/read, quote+confirm, events) | the burst profile drives all families at peak simultaneously; a single generator would be the bottleneck and hide API saturation |
| Database | dedicated PostgreSQL 18 instance, same major/minor as production, ≥4 vCPU / 16 GiB / provisioned IOPS, no other tenant traffic | wallet/ledger writes are the Quote→Confirm critical path; shared or small instances make the measurement about the DB, not the candidate |
| Redis | dedicated instance matching production configuration | outbox dispatch and idempotency scopes depend on it |
| Worker pool | ≥2 worker instances sized as the production pool for the settlement run | Ticket 13 says "for the configured worker pool"; the run is only meaningful if the pool matches the deployment |
| Telemetry | the metrics surface required by `scenarios/ticket13.capacity.json → requiredObservability`, plus an OTLP collector and dashboard | the harness refuses to derive lag/throughput SLOs from logs |
| Data volume | dataset seeded to the target scenario volumes (≥5,000 Members, ≥100,000 confirmed Orders/Bet Lines for the settlement run) | target-scale throughput on a toy dataset proves nothing about index/IO behaviour |
| Duration / iterations | ≥15 min steady-state at target rates, plus the pre-cutoff burst phase; 3 runs, median reported | a single short run cannot distinguish noise from saturation |
| Acceptance | all 11 targets PASS, error rate < 0.5 %, zero duplicate financial effects | Ticket 13 |

## 4. Smoke run recorded on this candidate (plumbing evidence only)

Profile `smoke` (20 sessions, 20 s windows, 200 Bet Lines) on candidate
`0d3b6cb1` in this sandbox — full report in
`.hermes/evidence/release/load-harness-ticket13-capacity-v1-smoke-0d3b6cb1ce90.md`:

- 18 rows in §1 across the drivers; the table covers **11/11 Ticket 13
  targets**, of which 10 are driver-backed and 2 are reported `NOT_MEASURED` with
  their reason (payment/webhook throughput — no ingress exists, §5; and
  `critical_queue_lag` — no queue/outbox lag metric family exists, §5 gap 2).
  0 could be `PASS`/`FAIL` because the profile is not target-scale.
- The report header line `Ticket 13 target coverage: N/11 driver-backed` is written
  from `lib/coverage.mjs`; the same module makes a missing target row fatal
  (`writeReport()` refuses, `scripts/assert-report.mjs` fails CI), so the verdict
  counter can never understate the unproven set.
- Both repeat runs are on record: settlement resumed with the same batch id, no
  Member-visible partial completion, and the SQL assertions found exactly one
  stake effect per confirmed Order and no Order paid twice.
- The read-path latency moved between runs on this host (p95 20 ms in one run,
  p95 2.3 s in another while a sibling build was running) — a direct demonstration
  of why this environment cannot certify an SLO.

## 5. Two capability gaps that block two Ticket 13 targets

1. **No inbound payment/webhook ingress exists.** Scanning the generated contract
   finds no `/webhook|callback|notify|ipn` route; the only provider-facing route is
   `POST /api/v1/member/deposits/:id/reconcile`, a Member-triggered *outbound*
   provider poll. Ticket 13 requires webhooks to be "authenticated/validated and
   durably accepted before success is acknowledged", so the harness will not drive
   an unsigned route. ≥200 events/s therefore stays `NOT_MEASURED` until an
   authenticated ingress with signature verification exists.
2. **Settlement has no worker-pool path.** The Settlement Batch is executed inline
   by the Admin API command `POST /api/v1/admin/draws/:drawId/settlement`; no
   worker group consumes a settlement job, and there is no settlement throughput or
   queue-lag metric. Until that exists, "≥100,000 Bet Lines in 10 minutes for the
   configured worker pool" can only be measured as an API-process run.

Both are recorded as findings and routed to follow-up cards rather than being
worked around inside the harness.

## 6. Open questions for the Lead

1. Approve or amend §3, and name the environment (cluster/account) the `target`
   profile must run on.
2. Decide whether the payment/webhook ingress (gap 1) is in v1 scope; if it is, it
   needs an owner, a signature contract and an event simulator.
3. Decide whether settlement gets a queue/worker execution path (gap 2) or whether
   "configured worker pool" is formally defined as the API process, in which case
   Ticket 13 wording and the release gate should say so.
4. Confirm the CI expectation: a `load-harness-smoke` job proves the harness on
   every PR (plumbing only); the capacity run stays a release-candidate step on the
   approved environment.
