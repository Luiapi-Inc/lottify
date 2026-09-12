# Production Deploy Workflow

## Purpose

Promote an already-reviewed immutable Lottify release candidate to production only when the approved scope, Ticket 16 acceptance evidence, release blockers, migration/recovery posture, and actual candidate contents are aligned.

## Trigger

Run on an explicit production-promotion request for a concrete release candidate. Building features, fixing bugs, merging changes, and producing a candidate occur before this workflow.

## Entry gate

The Lead must reject Production GO while any of these is true:

- a release-scoped P0/P1 blocker is open;
- any mandatory Ticket 16 evidence cell is missing, failed, stale after a traced contract change, or unexplained/flaky;
- the candidate is not the immutable artifact set that was reviewed and tested;
- required Member/Admin functional/visual evidence is missing;
- an applicable migration, backfill, backup/restore, security, performance, observability, provider, rollback, or roll-forward obligation is unproved;
- the intended deployed result differs from the approved requirement/plan or from the user's requested release goal.

## Pre-deploy review

Before any production traffic switch, prepare one decision-ready brief containing:

- the exact user release request and approved release scope;
- the approved source Requirement/Decision and implementation plan;
- the exact candidate/build identity and reviewed diff/commits;
- the Member/Admin functional and visual result where applicable;
- tests plus Ticket 16 evidence matrix status;
- security/performance/migration/recovery/observability evidence as applicable;
- open P0/P1 result;
- the rollback point and governed roll-forward path;
- the expected post-deploy smoke/functional checks.

This is the Goal Alignment checkpoint. The deploy may proceed only when the exact candidate is authorized for production under the active project policy. If prior authorization already covers this exact candidate and promotion action, do not ask again.

## Workflow

1. **Freeze and identity**
   - Confirm Scope/Contract Freeze for the candidate and record immutable build/image/artifact identities.
   - Any post-freeze API/event/schema/configuration/migration/security-policy/financial-contract change returns to change-impact and acceptance review.
2. **Release blocker check**
   - Query the canonical issue tracker for release-scoped P0/P1 blockers and unresolved release-critical evidence gaps.
3. **Ticket 16 gate**
   - Verify the matrix `Requirement -> Approved Specification -> Implementation -> Tests -> Functional/Visual Result -> Performance/Security -> Migration/Backup/Restore -> Deployment -> Rollback/Roll-forward Recovery`.
   - Any mandatory missing/failed cell is NO-GO regardless of green CI.
4. **Candidate verification**
   - Run `vercel:verification` for the applicable end-to-end story.
   - Run `vercel:agent-browser-verify` for critical Member/Admin journeys when they are part of the release.
   - If a deterministic failure appears, leave the deploy route and use the Bug, CI, or Critical workflow according to root-cause class.
5. **Pre-deploy brief / Goal Alignment**
   - Present the concrete candidate and evidence described above at the required production checkpoint.
6. **Deploy inactive environment**
   - Follow the Ticket 19 blue/green discipline: deploy the same immutable candidate to the inactive production environment.
   - Apply only reviewed migration/configuration actions and preserve compatibility with the active version across the rollout window.
7. **Pre-switch verification**
   - Verify migration compatibility, health, critical smoke flows, observability, and required provider/runtime dependencies on the inactive side.
8. **Traffic switch**
   - Switch traffic deliberately only after the entry gate and checkpoint remain satisfied.
9. **Post-deploy Actual Result**
   - Verify critical Member/Admin/API workflows, financial invariants as applicable, logs/metrics/traces, and release identity in the live environment.
   - Record Actual Result separately from test/CI status.
10. **Recovery decision if needed**
   - Application rollback is allowed only while database compatibility remains valid.
   - Otherwise use the governed roll-forward path; never repair authoritative financial data ad hoc.
11. **Release evidence closeout**
   - Attach deployment and post-deploy evidence to the Ticket 16 trace and record final GO state or incident/rollback state.

## Definition of done

Production deployment is complete only when the exact approved immutable candidate is live, post-deploy Actual Result matches the intended result, required observability and critical flows are healthy, the Ticket 16 trace includes deployment/recovery evidence, and no unresolved production blocker is being hidden by a green pipeline.
