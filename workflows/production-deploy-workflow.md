# Production Deploy Workflow

## Purpose

Promote an already-reviewed immutable Lottify release candidate to production only when the approved scope, applicable pre-deploy Ticket 16 evidence, release blockers, migration/recovery posture, and actual candidate contents are aligned, then close final release acceptance only after production deployment and post-switch evidence are recorded.

## Trigger

Run on an explicit production-promotion request for a concrete release candidate. Building features, fixing bugs, merging changes, and producing a candidate occur before this workflow.

## Pre-switch eligibility gate

The Lead must reject eligibility for a production traffic switch while any of these is true:

- an unresolved release blocker remains under Ticket 19 priority ordering: `Integrity/Security/Compliance -> Functional critical path -> Recovery/Operations -> Performance -> Non-critical UX`; use the canonical issue workflow labels from `docs/agents/triage-labels.md` and do not translate them into an invented severity taxonomy;
- any applicable pre-deploy mandatory Ticket 16 evidence is missing, failed, stale after a traced contract change, or unexplained/flaky;
- the candidate is not the immutable artifact set that was reviewed and tested;
- required Member/Admin functional/visual evidence is missing;
- an applicable migration, backfill, backup/restore, security, performance, observability, or provider obligation required before switch is unproved;
- the rollback point or governed roll-forward path is not ready;
- the intended deployed result differs from the approved requirement/plan or from the user's requested release goal.

Ticket 16 still requires the full release evidence chain. The `Deployment` and `Rollback/Roll-forward Recovery` cells that depend on actual production execution remain pending at this gate rather than being treated as pre-deploy evidence. They are mandatory for final release acceptance after deployment.

## Pre-deploy review

Before any production traffic switch, prepare one decision-ready brief containing:

- the exact user release request and approved release scope;
- the approved source Requirement/Decision and implementation plan;
- the exact candidate/build identity and reviewed diff/commits;
- the Member/Admin functional and visual result where applicable;
- tests plus Ticket 16 evidence matrix status;
- security/performance/migration/recovery/observability evidence as applicable;
- unresolved release-blocker result using Ticket 19 priority ordering plus the canonical triage label state;
- the rollback point and governed roll-forward path;
- the expected post-deploy smoke/functional checks.

This is the Goal Alignment checkpoint. The deploy may proceed only when the exact candidate is authorized for production under the active project policy. If prior authorization already covers this exact candidate and promotion action, do not ask again.

## Workflow

1. **Freeze and identity**
   - Confirm Scope/Contract Freeze for the candidate and record immutable build/image/artifact identities.
   - Any post-freeze API/event/schema/configuration/migration/security-policy/financial-contract change returns to change-impact and acceptance review.
2. **Release blocker check**
   - Query the canonical issue tracker for unresolved release blockers and order them by Ticket 19: `Integrity/Security/Compliance -> Functional critical path -> Recovery/Operations -> Performance -> Non-critical UX`.
   - Record issue workflow state with the canonical labels `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, or `wontfix`; do not invent another severity mapping.
3. **Ticket 16 pre-switch gate**
   - Evaluate the full matrix `Requirement -> Approved Specification -> Implementation -> Tests -> Functional/Visual Result -> Performance/Security -> Migration/Backup/Restore -> Deployment -> Rollback/Roll-forward Recovery`.
   - Before the traffic switch, every applicable pre-deploy mandatory cell must be complete and passing. Production `Deployment` and execution-dependent `Rollback/Roll-forward Recovery` cells are explicitly pending execution, with the rollback point and governed roll-forward path ready. Missing or failed evidence that is required before switch is NO-GO regardless of green CI.
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
   - Switch traffic deliberately only after the pre-switch eligibility gate and checkpoint remain satisfied.
9. **Post-deploy Actual Result**
   - Verify critical Member/Admin/API workflows, financial invariants as applicable, logs/metrics/traces, and release identity in the live environment.
   - Record Actual Result separately from test/CI status.
10. **Recovery decision if needed**
   - Application rollback is allowed only while database compatibility remains valid.
   - Otherwise use the governed roll-forward path; never repair authoritative financial data ad hoc.
11. **Release evidence closeout**
   - Attach the actual production Deployment evidence, post-switch Actual Result, and applicable rollback/roll-forward Recovery evidence to the Ticket 16 trace.
   - Final release acceptance closes only when every applicable mandatory Ticket 16 cell is complete and passing. Capture the post-deploy Rollback/Roll-forward Recovery evidence required by the acceptance matrix; a pre-deploy plan or readiness check alone cannot close that production evidence cell.

## Definition of done

Production deployment is complete only when the exact approved immutable candidate is live, post-deploy Actual Result matches the intended result, required observability and critical flows are healthy, and actual Deployment evidence is attached. Final release acceptance is complete only when all applicable mandatory Ticket 16 cells, including the required post-deploy Rollback/Roll-forward Recovery evidence, are closed and no unresolved release blocker is being hidden by a green pipeline.
