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

## Evidence confirmed on 2026-09-04

GitHub Actions `ci` run `33822450161` on commit `815581560e2c905de10b6a74933dbc6ca46efcac` provides the Foundation environment evidence.

- `verify`: PASS after a rerun of a transient npm registry timeout. PostgreSQL 18 and Redis 8 service containers were healthy; Prisma generation and migration deploy passed; OpenAPI/client generation passed; typecheck passed; all 16 tests passed, including the four Foundation integration tests enabled by `RUN_INTEGRATION_TESTS=1`; `pnpm audit --prod --audit-level high` reported `No known vulnerabilities found`; and the backend, Member, and Admin production builds passed.
- `container-smoke`: PASS. The initial migration applied against PostgreSQL, all four OCI images built, and API, worker, Member, and Admin containers all passed their runtime smoke checks against the CI environment.
- The previously environment-blocked PostgreSQL, Redis/BullMQ, OCI build, and container-runtime proof cells are therefore satisfied by CI evidence rather than by the local host.

## Milestone disposition

Foundation implementation and its scoped CI/runtime evidence are complete for this milestone. This is not Production GO: the complete Ticket 13/16 release evidence matrix and all remaining production acceptance criteria still govern release readiness. The Member and Admin applications remain Foundation skeletons and are not an approval of final production UX.
