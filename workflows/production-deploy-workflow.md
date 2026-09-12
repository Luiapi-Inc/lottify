# Production Deploy Workflow

## Purpose

Promote an already-reviewed immutable Lottify release candidate to production only when the approved scope, Ticket 16 Production GO/NO-GO evidence matrix, release blockers, migration/recovery posture, and actual candidate contents are aligned, then enrich the same evidence trace with actual production deployment and post-switch results before final closeout.

## Trigger

Run on an explicit production-promotion request for a concrete release candidate. Building features, fixing bugs, merging changes, and producing a candidate occur before this workflow.

## Pre-switch eligibility gate

The Lead must reject eligibility for a production traffic switch while any of these is true:

- an unresolved release blocker remains under Ticket 19 priority ordering: `Integrity/Security/Compliance -> Functional critical path -> Recovery/Operations -> Performance -> Non-critical UX`; use the canonical issue workflow labels from `docs/agents/triage-labels.md` and do not translate them into an invented severity taxonomy;
- any mandatory Ticket 16 Production GO/NO-GO evidence cell is missing, failed, stale after a traced contract change, or unexplained/flaky;
- the candidate is not the immutable artifact set that was reviewed and tested;
- required Member/Admin functional/visual evidence is missing;
- an applicable migration, backfill, backup/restore, security, performance, observability, or provider obligation required before switch is unproved;
- documented and verified recovery readiness is incomplete, including a compatibility-aware rollback path while database compatibility remains valid and a governed roll-forward path with the applicable plan/test evidence;
- the intended deployed result differs from the approved requirement/plan or from the user's requested release goal.

Ticket 16 requires the full Production GO/NO-GO evidence chain before the traffic switch, with no missing mandatory cell. At this gate, the `Deployment` cell is satisfied by the verified deployment plan/readiness evidence required by Ticket 13; actual production execution is appended after rollout. The `Rollback/Roll-forward Recovery` cell is satisfied by verified rollback/roll-forward procedures/readiness plus applicable controlled recovery test/drill evidence. A successful rollout does not require intentionally executing rollback or roll-forward in production. If recovery is actually exercised because of a failure, its production execution evidence becomes mandatory for closeout. Post-deploy evidence enriches the trace and never retroactively excuses a missing pre-switch mandatory cell.

## Pre-deploy review

Before any production traffic switch, prepare one decision-ready brief containing:

- the exact user release request and approved release scope;
- the approved source Requirement/Decision and implementation plan;
- the exact candidate/build identity and reviewed diff/commits;
- the Member/Admin functional and visual result where applicable;
- tests plus Ticket 16 evidence matrix status;
- security/performance/migration/recovery/observability evidence as applicable;
- unresolved release-blocker result using Ticket 19 priority ordering plus the canonical triage label state;
- the verified compatibility-aware rollback readiness and governed roll-forward path, including applicable recovery test/drill evidence;
- the expected post-deploy smoke/functional checks.

This is the Goal Alignment checkpoint. The deploy may proceed only when the exact candidate is authorized for production under the active project policy. If prior authorization already covers this exact candidate and promotion action, do not ask again.

## Workflow

1. **Freeze and identity**
   - Confirm Scope/Contract Freeze for the candidate and record immutable build/image/artifact identities.
   - Any post-freeze API/event/schema/configuration/migration/security-policy/financial-contract change returns to change-impact and acceptance review.
2. **Release blocker check**
   - Query the canonical issue tracker for unresolved release blockers and order them by Ticket 19: `Integrity/Security/Compliance -> Functional critical path -> Recovery/Operations -> Performance -> Non-critical UX`.
   - Record issue workflow state with the canonical labels `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, or `wontfix`; do not invent another severity mapping.
3. **Ticket 16 Production GO/NO-GO gate**
   - Evaluate the full matrix `Requirement -> Approved Specification -> Implementation -> Tests -> Functional/Visual Result -> Performance/Security -> Migration/Backup/Restore -> Deployment -> Rollback/Roll-forward Recovery`.
   - Before the traffic switch, every mandatory cell must be complete and passing for Production GO. Satisfy `Deployment` with verified deployment plan/readiness evidence. Satisfy `Rollback/Roll-forward Recovery` with verified compatibility-aware rollback/roll-forward procedures/readiness plus applicable controlled recovery test/drill evidence. Actual production execution evidence is appended after rollout, and actual rollback/roll-forward execution evidence is required only if recovery is exercised because of failure. Any missing or failed mandatory pre-switch evidence is NO-GO regardless of green CI.
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
   - If post-switch verification fails and recovery is required, application rollback is allowed only while database compatibility remains valid.
   - Otherwise use the governed roll-forward path; never repair authoritative financial data ad hoc.
   - When rollback or roll-forward is exercised, capture the actual production recovery execution and resulting state as mandatory Ticket 16 evidence.
11. **Release evidence closeout**
   - Append the actual production Deployment evidence, post-switch smoke/functional/operational Actual Result, and release identity to the Ticket 16 trace that already supported Production GO.
   - Preserve the verified pre-switch rollback/roll-forward procedures/readiness and applicable controlled recovery test/drill evidence in the Recovery trace. If production recovery was exercised because of failure, append its actual execution evidence and resulting state as well.
   - Final release acceptance closes only when every applicable mandatory Ticket 16 obligation remains satisfied after the rollout. Post-deploy evidence enriches the trace; it cannot retroactively cure a mandatory evidence gap that should have produced pre-switch NO-GO. A successful rollout does not require an intentional production rollback/roll-forward solely to manufacture execution evidence.

## Definition of done

Production deployment is complete only when the exact approved immutable candidate is live, post-deploy smoke/functional/operational Actual Result matches the intended result, required observability and critical flows are healthy, and actual Deployment evidence has been appended to the Production GO trace. Final release acceptance is complete only when all applicable mandatory Ticket 16 obligations remain satisfied, including verified pre-switch deployment-plan evidence, recovery procedures/readiness and applicable controlled recovery test/drill evidence, plus actual rollback/roll-forward execution evidence whenever recovery was exercised; no unresolved release blocker may be hidden by a green pipeline.
