# Lottify Main Engineering Workflow

## Purpose

Route each engineering request into the smallest Lottify workflow that can prove the requested result against the approved source of truth. This workflow controls delegation and evidence; it does not redefine product requirements.

## Trigger

Run whenever a new Lottify engineering request, defect, CI failure, critical financial/security change, or production-promotion request enters the active queue.

## Source-of-truth gate

Before planning or delegating implementation, the Lead must read the active implementation checkpoint and the relevant source documents. For cross-cutting work, the minimum set is:

- `.scratch/lottify-v1-specification/issues/19-implementation-roadmap-and-delivery-sequencing.md`
- `.scratch/lottify-v1-specification/issues/02-end-to-end-business-workflows.md`
- `.scratch/lottify-v1-specification/issues/16-acceptance-criteria-and-test-traceability.md`
- the active domain ticket and applicable ADRs
- `CONTEXT.md` for canonical domain vocabulary
- `docs/agents/multi-agent-workflow.md` for delegation and integration rules

If the request conflicts with an approved requirement, API/event contract, financial invariant, ADR, migration order, or ownership decision, stop the conflicting implementation path and report the conflict. A new direction requires a Change Request; the workflow must not silently replace the approved plan.

## Shared control trace

Every routed run preserves both traces:

`Plan -> Intended Result -> Current State -> Gap -> Implementation`

and

`Requirement -> Plan -> Implementation -> Test -> Actual Result`

The Lead owns the second trace and the final acceptance wording. Passing tests, build, lint, typecheck, or CI are evidence only; none of them alone establishes requirement acceptance.

The Lead is an orchestration/review role and does not write product code. Implementation changes are delegated to a Writer with an explicit scope, source references, evidence obligations, and stop conditions.

## Task classifier

Classify the request before selecting skills:

| Type | Route |
| --- | --- |
| New or changed product capability with approved behavior | `feature-workflow.md` |
| Reproducible defect or deterministic verification failure caused by product code | `bug-fix-verification-loop.md` |
| Change touching a high-risk financial/security/trust boundary | `financial-security-critical-change-workflow.md` |
| GitHub Actions / CI pipeline failure where product behavior is not yet proved broken | `ci-failure-workflow.md` |
| Promotion of an approved immutable release candidate to production | `production-deploy-workflow.md` |

If a request belongs to more than one type, route to the stricter workflow. A financial/security critical change remains critical even when it was discovered through a bug or CI failure.

Use this dispatch order so only one workflow controls the active action:

1. An explicit promotion of an already-built/reviewed release candidate routes to Production deploy.
2. A CI failure starts in CI failure for exact-failure diagnosis; hand off to Bug or Critical when product root cause is proved.
3. A product defect routes to Critical when the high-risk classifier matches, otherwise Bug.
4. A requested capability routes to Critical when the high-risk classifier matches, otherwise Feature.

Production deploy does not perform product implementation. Any newly discovered code/config/contract defect leaves the deploy workflow and returns to the appropriate implementation workflow before a new candidate is produced.

## Automatic skill routing

Do not invoke every skill on every task. Select only skills justified by the affected boundary and required evidence.

| Condition | Skill |
| --- | --- |
| Parallel work is proven safe under the repository rules | `lottify-multi-agent` |
| Deterministic bug/repro investigation | `diagnosing-bugs` |
| Behavior change needs test-first regression or acceptance coverage | `tdd` |
| GitHub Actions / CI failure | `gh-fix-ci` |
| Next.js App Router behavior is touched | `vercel:nextjs` |
| React/TSX rendering, composition, performance, or state patterns are touched | `vercel-react-best-practices` |
| PostgreSQL schema/query/index/transaction behavior is touched | `supabase:supabase-postgres-best-practices` |
| Security-sensitive implementation or security review is required | `security-best-practices` |
| High-risk financial/security/trust boundary is changed | `security-threat-model` |
| Member/Admin UX needs browser evidence | `vercel:agent-browser-verify` |
| A broader end-to-end implementation story must be verified | `vercel:verification` |
| Any change is ready for merge review | `code-review` |

If a required skill is unavailable in the active environment, record a workflow/tooling gap and continue only with an equivalent evidence path that does not weaken the source-of-truth or acceptance requirement.

## High-risk boundary classifier

Route to the critical workflow when the change can alter any of these approved boundaries:

- Ledger, Wallet, Reservation, posting, compensation, reconciliation, or money finalization;
- Deposit, Withdrawal, Bet Confirm, refund, settlement, result correction, promotion monetary effects;
- idempotency, replay, concurrency, transaction ordering, or ambiguous provider outcomes;
- login identity, session rotation/revocation, authorization, Admin privilege, MFA/re-authentication;
- payment/payout/result provider callbacks, webhook authenticity/replay protection, secrets, security policy, or another external trust boundary;
- authoritative financial schema/migration, API/event/provider contract, or race-sensitive state-machine behavior.

`security-threat-model` is used only for this class or when the approved source explicitly requires a threat model.

## Multi-agent routing

Use `lottify-multi-agent` only when all of the following are true:

1. Source requirements and prerequisites are stable.
2. Writer paths are disjoint.
3. Writers do not share the same unstable schema/migration/API/event/financial/transaction boundary.
4. Each candidate can be reviewed and reverted independently.
5. Merge order is known or genuinely independent.

Otherwise serialize the work. Architecture and Test/Evidence Guards remain read-only by default. One Writer owns each unstable shared critical boundary at a time.

When the delegated-agent runner supports explicit model selection, use the user's configured subagent defaults:

```toml
model = "chatgpt-web/high"
model_reasoning_effort = "high"
```

## Human checkpoint policy

Push checkpoints to the right. The Lead continues reversible source analysis, delegation, implementation review, tests, and evidence collection without interrupting the user.

Stop for a decision only when the next step requires an unresolved requirement/change decision, production promotion/traffic switch without existing authorization for the exact candidate, a destructive or difficult-to-reverse action, or human-only access/evidence. The checkpoint brief must show the decision required, source-of-truth impact, completed work/evidence, remaining risk, and the exact next action.

## Common pre-merge gate

Before merge, every implementation route must:

1. map the diff back to the approved Requirement/Decision and plan;
2. run the test/evidence levels required by the changed invariant;
3. verify the Actual Result rather than inferring it from green tests;
4. run Member/Admin browser verification when user-facing UX changed;
5. run `code-review` against both engineering standards and the approved specification;
6. resolve all blocking review findings before merge.

## Ticket 16 acceptance gate

Acceptance is evaluated as:

`Requirement/Decision -> Acceptance Criterion -> Test Scenario -> Test Level -> Evidence`

The required test level depends on the invariant. Transactional/state/financial correctness requires deterministic integration evidence; REST/OpenAPI, provider, and event compatibility use contract evidence; critical Member/Admin journeys use E2E/browser evidence; capacity, migration, recovery, security, and observability use the applicable NFR/operational evidence.

Each release-critical evidence record must retain the Requirement/Decision or Acceptance Criterion identity, scenario identity, environment, immutable build/release identity, result, execution timestamp, and a durable report/log/evidence reference.

Missing mandatory evidence is a NO-GO even when build, lint, tests, and CI are green.

## Production eligibility

A change may enter `production-deploy-workflow.md` only when:

- the intended release scope is approved and frozen for the candidate;
- required merge review is complete;
- no release-scoped P0/P1 blocker remains open;
- the Ticket 16 evidence matrix has no mandatory missing or failed cell;
- Member/Admin functional and visual evidence is present when applicable;
- migration, backup/restore, security, performance, observability, rollback/roll-forward evidence is present when applicable;
- the release candidate is immutable and identifies the exact reviewed implementation.

## Definition of done

This router is satisfied when the request is assigned to exactly one controlling workflow, conditional skills have been selected from observable task boundaries, delegation obeys repository ownership rules, and the final status can be traced from Requirement through Actual Result without weakening Ticket 16 acceptance.
