# Load / performance harness (Ticket 13, GH #91)

This directory holds the candidate-bound load/performance harness for the Ticket 13
capacity and SLO targets. It is the executable counterpart of
`.scratch/lottify-v1-specification/issues/13-non-functional-targets-and-release-gates.md`:
the targets are data in `scenarios/ticket13.capacity.json`, transcribed verbatim,
and `pnpm test` fails if any of them is weakened.

Nothing here deploys, and nothing here mutates a production system. The harness
drives a candidate API that is already running, reads its metrics surface, and
writes a report. Fixture rows are written only to a dedicated `lottify_load_*`
database created for the run.

## Why the harness looks like this

- **The API has no `@Public` route.** Member capacity therefore needs real Member
  sessions. `seed/seed-load-fixtures.ts` mints them with the repository's own
  `SessionService`, so no authentication bypass and no new route is added.
- **The telemetry needed for queue/outbox/DLQ lag and settlement throughput does
  not exist yet** (see the telemetry card `t_79b28bfc`). The harness reads a
  metrics surface and reports `NOT_MEASURED` when a family is absent, with the
  observed metric inventory attached as evidence of absence. It never scrapes
  logs to invent an SLO number.
- **A sandbox number is not capacity evidence.** The host is 2 vCPU / 3.7 GiB with
  a co-located client and a shared development database. `run.mjs` refuses to run
  the `target` profile here, and profiles that do not declare `claimsTarget: true`
  can only ever report `MEASURED`, never `PASS`.

## Scenario identity

`scenarios/ticket13.capacity.json` defines:

| Item | Value |
|---|---|
| Target concurrency | 5,000 concurrently active Member sessions |
| Quote / Confirm | ≥300 Quote req/s, ≥150 Confirm req/s (funnel ratio derived from the target rates: 2 Quotes per Confirm) |
| Webhook | ≥200 payment/webhook events/s |
| SLOs | read p95 ≤ 300 ms / p99 ≤ 800 ms; Quote p95 ≤ 500 ms / p99 ≤ 1.5 s; Confirm p95 ≤ 800 ms / p99 ≤ 2 s; critical server error rate < 0.5 % |
| Queue lag | p95 < 5 s, alert threshold 30 s |
| Settlement | ≥100,000 Bet Lines within 10 min in the configured worker pool, idempotent resume, no Member-visible partial completion, no duplicate financial effect |
| Pre-cutoff burst | long ramp, peak inside the last `burstWindowSeconds` before Draw cutoff (harness-declared shape; the source fixes the requirement, not the shape) |
| Dataset | one BET-eligible Member per session, funded CASH bucket, one published product/bet-type version, OPEN Draw(s), confirmed Order population for settlement |

Profiles: `smoke` (harness plumbing, ~1 min), `sandbox` (largest honest run on this
host), `target` (the acceptance run; requires the approved production-like
environment).

## How to run a scenario

```bash
# 0. environment: export DATABASE_URL (the shared dev URL is fine as the source of
#    connection parameters — the scripts never write to it) and JWT_ACCESS_SECRET.
set -a && . ./.env && set +a
export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:?required by the API env schema}"

# 1. dedicated load database + full candidate migration chain
bash tools/load-harness/scripts/scratch-db.sh --suffix <card-id>     # prints LOAD_DATABASE_URL
export LOAD_DATABASE_URL=...

# 2. fixtures (Members, sessions, funding, published product/Draw, settlement Orders)
#    The seeding step reads DATABASE_URL and refuses anything that is not a load
#    database, so the load URL must be passed explicitly here too:
pnpm load:seed -- --profile smoke \
  --manifest .hermes/evidence/release/w5-raw-load/load-manifest-smoke.json \
  --database-url "$LOAD_DATABASE_URL"

# 3. boot the candidate API (tsc-compiled, the container shape) against that database
bash tools/load-harness/scripts/boot-api.sh --port 19199

# 4. run the scenario and write the report
pnpm load:run -- --profile smoke --base-url http://127.0.0.1:19199 \
  --manifest .hermes/evidence/release/w5-raw-load/load-manifest-smoke.json \
  --database-url "$LOAD_DATABASE_URL"

# 5. optionally pause it and re-run the same command (the report then shows idempotent resume)
pnpm load:run -- --profile smoke --base-url http://127.0.0.1:19199 \
  --manifest .hermes/evidence/release/w5-raw-load/load-manifest-smoke.json \
  --database-url "$LOAD_DATABASE_URL"

# 6. stop the API and remove the fixtures / database
bash tools/load-harness/scripts/boot-api.sh --port 19199 --stop
pnpm load:seed -- --manifest .hermes/evidence/release/w5-raw-load/load-manifest-smoke.json \
  --database-url "$LOAD_DATABASE_URL" --cleanup
bash tools/load-harness/scripts/scratch-db.sh --suffix <card-id> --drop
```

`--cleanup` removes the fixture rows but never rewrites append-only ledger
history, and it does **not** delete the manifest. A manifest holds real Member
access tokens and the (redacted-host, unredacted-password) connection string, so
it is a secret-bearing local file: never attach it to a card, a PR or a report —
attach the report, which carries the counts, not the tokens.

Reports land in `.hermes/evidence/release/load-harness-<scenario>-<profile>-<sha>.{md,json}`
and are bound to the candidate SHA, the environment fingerprint, the scenario
identity, the timestamps, the raw samples, the metric inventory and (for
settlement) the independent SQL assertion output.

Both halves of a report must name the same candidate; CI enforces it in the smoke
job, and a reviewer can check a report the same way. The expected SHA is the
*candidate* — inside CI the checked-out commit is the candidate, but on a harness
branch the candidate is `origin/main`:

```bash
node tools/load-harness/scripts/assert-report.mjs \
  .hermes/evidence/release/load-harness-ticket13-capacity-v1-smoke-<candidate-sha-12>.json \
  "$(git rev-parse --short=12 origin/main)"   # CI passes HEAD, which is the candidate there
```

`scratch-db.sh` and `boot-api.sh` also take caller-provided `DATABASE_URL`,
`LOAD_DATABASE_URL`, `JWT_ACCESS_SECRET`, `REDIS_URL` and `API_PORT` over the
checkout's `.env`, so a reproduction targets the load database it was given rather
than whatever a working copy points at.

## What the drivers do

| Driver | Target(s) | How |
|---|---|---|
| `read-sessions` | 5,000 concurrent sessions, read p95/p99, error rate | ramps one authenticated session per seeded Member, keeps continuous `GET /api/v1/member/profile` traffic, samples established sessions every second |
| `quote-confirm` | Quote/Confirm req/s + p95/p99, error rate, duplicate effect | drives `POST …/quotes` → `…/orders` → `…/orders/:id/confirm` with real Idempotency-Keys; every Nth cycle confirms so the mix matches the target rate ratio; replays sampled Confirms concurrently with the SAME key to probe duplicate effects |
| `payment-events` | ≥200 payment/webhook events/s | discovers candidate ingress routes from the OpenAPI contract and drives one only when a caller names it with its signature header; otherwise `NOT_MEASURED` with the route inventory as evidence |
| `settlement-capacity` | ≥100k Bet Lines / 10 min, idempotent resume, no Member-visible partial completion | closes the Draw, intakes + confirms the Result through the Admin commands, runs the Settlement command twice (resume), and polls `GET /api/v1/member/orders/:id/settlement` while the batch is in flight |
| `seed/assert-financial-effects.ts` | once-only financial effect, settlement scope | SQL over the whole dedicated load database: exactly one stake commit per Order in a stake-committed state (`CONFIRMED`/`SETTLED`/`CANCELLING`/`CANCELLED`), never two for any Order, no duplicate refund, exactly one settlement batch, no Order paid twice, every settlement row POSTED. An empty examined population is a failure, so the counters can never be 0-over-zero |

## Limits that must be stated in every report

- The `target` profile is refused outside a production-like environment (CPU,
  memory, client co-location and dedicated-database checks are mechanical in
  `lib/environment.mjs`).
- Settlement is executed by the Admin API command, because no worker group
  consumes a settlement job in this candidate. A `target` run therefore measures
  the API process, not a scaled worker pool; the report says so.
- Payment/webhook throughput cannot be measured until an authenticated ingress
  exists; this is recorded as a capability gap, not as a failure of the harness.
