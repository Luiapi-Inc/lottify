# Foundation milestone implementation status

Source of truth: Wayfinder Tickets 01, 13, 15, 16, and 19. This record does not redefine those requirements.

## Implemented

- Node.js 24 / TypeScript / NestJS 11 production-shaped backend skeleton.
- Thirteen bounded-context module boundaries with an architecture test preventing direct context-to-context imports.
- PostgreSQL + Prisma 7.10 persistence baseline and reviewed initial migration for Identity Session, durable Idempotency, and Transactional Outbox infrastructure.
- Rotating refresh-session foundation with hashed high-entropy refresh tokens, atomic token rotation, revocation, and short-lived JWT access-token support.
- Durable idempotency claim/result storage with unique `(scope, key)` concurrency protection.
- Transactional Outbox claim leasing using PostgreSQL `FOR UPDATE SKIP LOCKED`, retry metadata, and BullMQ queue publication with durable event identity.
- Redis/BullMQ non-authoritative queue infrastructure with workload routing for Settlement, Payment/Reconciliation, Notification, and Scheduler/Outbox.
- Separate stateless API and worker process boundaries with startup/liveness/readiness probes.
- REST `/api/v1` + Swagger/OpenAPI generation and generated TypeScript client pipeline.
- Structured JSON Nest logs, HTTP request logs, correlation IDs, OpenTelemetry initialization, Prometheus-compatible metrics, and Sentry initialization seams.
- Separate Next.js 16 / React 19 Member and Admin application skeletons with standalone production output.
- Immutable OCI Dockerfile skeletons for API, workers, Member, and Admin pinned to the Node 24.20.0 base-image digest.
- Local PostgreSQL 18 / Redis 8 Compose definition, CI pipeline, blue/green release skeleton, environment validation, and secret-reference-ready runtime configuration.

## Evidence produced on 2026-09-03

- Prisma schema validation: PASS.
- OpenAPI spec generation + TypeScript client generation: PASS.
- TypeScript typecheck: PASS.
- Unit/architecture tests: 12/12 PASS.
- Backend TypeScript production build: PASS.
- Next.js Member standalone production build: PASS.
- Next.js Admin standalone production build: PASS.
- API runtime smoke: `/api/v1`, startup, liveness, and metrics return 200; readiness correctly returns 503 when required PostgreSQL is unavailable and reports Redis as degraded.
- Worker runtime smoke: startup/liveness return 200; readiness correctly returns 503 when PostgreSQL/Redis are unavailable.
- Production dependency audit: zero Critical findings after OpenTelemetry dependency correction. Two High and one Moderate findings remain in Prisma tooling transitive dependencies and require resolution or governed risk acceptance before Production GO.

## Environment-blocked evidence

The current host has no Docker CLI, PostgreSQL server/client, or Redis server/client. Therefore these proof cells cannot be truthfully marked PASS on this host:

- Apply the initial migration to a real PostgreSQL instance and execute the database integration tests.
- Execute the Redis/BullMQ integration test against a real Redis instance.
- Build and run the four OCI images locally and verify their container health checks/runtime behavior.

CI is configured with PostgreSQL and Redis services and `RUN_INTEGRATION_TESTS=1` so those integration scenarios execute in an environment that supplies the dependencies. Production GO remains subject to the complete Ticket 13/16 evidence matrix; this Foundation milestone does not imply production readiness.
