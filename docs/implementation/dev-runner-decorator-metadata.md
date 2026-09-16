# W5-F5 — Dev runner emits decorator metadata (dev:api / dev:worker)

Candidate: `0d3b6cb1ce905387dd6822a29121bba70bddcf4a` (origin/main at time of fix).
Status: RESOLVED (dev-runner defect; not a production defect). No production code, schema,
API contract, or deployment touched. Evidence captured on a clean worktree of origin/main.

## Problem (reproduced)

`pnpm dev:api` and `pnpm dev:worker` ran the API/worker through `tsx watch <entry>.ts`.
`tsx` transpiles via esbuild, which does **not** implement `emitDecoratorMetadata`.
NestJS constructor DI therefore reads no `design:paramtypes` and every injected
dependency resolves to `undefined` at runtime. Observed consequence: `GET
/internal/health/live|ready|startup` returned HTTP 500 `TypeError: Cannot read
properties of undefined (reading 'liveness')` at `apps/api/src/health.controller.ts:19`.

The same source compiled by `tsc --emitDecoratorMetadata` served those endpoints
HTTP 200 — proving this is a dev-runner defect, not a source or production defect.
Any runtime/browser evidence gathered through `tsx` is therefore invalid.

## Fix

Replace the tsx-driven DI entrypoints with a small runner that compiles with the
backend's own `tsc` config (which carries `emitDecoratorMetadata: true` via the
extends chain) and executes the compiled output with `node --watch`.

- `scripts/dev.mjs` — new dev runner:
  1. `tsc -p tsconfig.backend.json` (initial full build, emits decorator metadata);
  2. `tsc -p tsconfig.backend.json --watch` (rebuild on source change);
  3. `node --watch dist/<entry>.js` (restart on rebuild).
- `package.json`:
  - `dev:api`      → `node scripts/dev.mjs apps/api/src/main.ts`
  - `dev:worker`   → `node scripts/dev.mjs apps/workers/src/main.ts`
  - `tsx watch` removed from every DI-driven entrypoint. `openapi:spec` still uses
    `tsx` (a one-shot script, not a DI-driven runtime) — unaffected.

This makes the dev runtime execute the same compiled shape production containers
execute, so the dev flow is DI-correct and any evidence gathered through it is valid.

## Guard

`tests/dev-runner-decorator-metadata.spec.ts` fails if the regression returns:
- asserts `dev:api` and `dev:worker` do **not** contain `tsx`;
- asserts they run `node scripts/dev.mjs`;
- asserts `scripts/dev.mjs` and `tsconfig.backend.json` exist;
- asserts the backend tsconfig (extends chain) keeps `emitDecoratorMetadata` and
  `experimentalDecorators` true.

## Evidence

All under `.hermes/evidence/release/dev-di/` (worktree-captured, candidate-bound):
- `probe-dev-api.txt` — `pnpm dev:api` on port 4100:
  - `GET /internal/health/live`   → HTTP 200 `{"ok":true}`
  - `GET /internal/health/startup`→ HTTP 200 `{"ok":true}`
- `dev-api-probe.log` — boot log: routes mapped, `Nest application successfully started`
  (DI resolved; would not start under tsx).
- Guard suite: `pnpm vitest run tests/dev-runner-decorator-metadata.spec.ts` → 4 passed.

The reviewer-repeatable tsx-vs-tsc metadata probe (`metadata-drill.sh`, same probe
source the W5 observation used) still produces a consistent result:
- tsx: `paramtypes_present:false`
- tsc-compiled: `paramtypes_present:true`  (`design:paramtypes: ["Dep"]`)

## How to verify locally

1. `pnpm dev:api` → wait for `Nest application successfully started`.
2. `curl -i http://127.0.0.1:3000/internal/health/live` → `HTTP/1.1 200 {"ok":true}`.
3. Re-run `metadata-drill.sh` to compare tsx vs tsc metadata emission.
