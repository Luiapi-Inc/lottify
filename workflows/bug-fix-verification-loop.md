# Bug Fix Verification Loop

## Purpose

Resolve one observed software defect or deterministic product verification failure at a time through reproducible diagnosis, bounded implementation, actual-result verification, and a two-axis code review.

## Trigger

Start a run when either of these events occurs:

- a bug or reproducible product/runtime failure is observed; or
- a deterministic test, build, contract, typecheck, browser verification, or other product verification gate fails and evidence indicates product code may be responsible.

Route a GitHub Actions or CI infrastructure/configuration failure to `ci-failure-workflow.md` until product behavior is shown to be the root cause. Route any high-risk financial/security boundary to `financial-security-critical-change-workflow.md`.

No schedule is required.

## Scope of one run

One run owns exactly one observable symptom and one root-cause class. If investigation reveals an independent defect, record it separately rather than expanding the active run.

## Workflow

1. **Source alignment**.
   - Read the active implementation checkpoint, applicable Wayfinder source, Ticket 16 obligations, `CONTEXT.md`, and affected ADRs before changing product code.
   - Record the intended result and current observed result.
2. **Diagnose** with `diagnosing-bugs`.
   - Establish one fast, deterministic, agent-runnable command that can fail on the exact symptom.
   - Reproduce and minimise before forming a fix theory.
   - Rank falsifiable hypotheses and prove the root cause from evidence.
3. **Test-first boundary** with `tdd` when a valid regression seam exists.
   - Add the regression test at the correct seam and observe it fail for the proved defect.
4. **Implement** with the assigned Writer.
   - Make the smallest change that fixes the proved root-cause class without redefining approved requirements.
   - Re-run the original repro and targeted verification.
   - Run the required broader/full verification before closing the implementation phase.
   - If Member/Admin UX is affected, run `vercel:agent-browser-verify` against the approved UX flow and verify the user-visible error/recovery state as applicable.
5. **Actual Result**.
   - Observe the repaired behavior at the authoritative seam and compare it directly with the intended result.
   - Treat green tests as supporting evidence, not as the actual-result claim.
6. **Commit candidate**.
   - After implementation evidence is acceptable, the Writer commits only the bounded change and returns the exact candidate commit SHA.
7. **Review** with `code-review`.
   - Review Standards and Spec as separate axes against the exact committed candidate from the Writer and its pinned base.
   - If any review occurred before commit, repeat the final review/evidence check against the exact commit before integration.
   - Blocking findings return the run to Diagnose or Implement as appropriate; any follow-up change produces a new candidate commit that must receive the same exact-commit review.

## Checkpoints

Push the human checkpoint to the right. Local, reversible diagnosis, testing, and implementation continue autonomously.

Stop for a human decision when the next action requires any of:

- changing or resolving an ambiguous product/requirement decision;
- production deployment, traffic switch, or release promotion;
- merge/push when policy or ownership requires explicit approval;
- destructive or difficult-to-reverse action;
- evidence that cannot be obtained without human-only access.

## Definition of done

A run is complete only when all applicable conditions hold:

1. The original symptom has a deterministic repro that was observed failing before the fix.
2. The root cause is identified from evidence, not inference alone.
3. A regression test at the correct seam failed before the fix and passes after it, or the absence of a valid seam is explicitly documented.
4. The original repro passes after the fix.
5. Targeted tests/checks pass.
6. Required broader/full verification shows no regression attributable to the change.
7. The Actual Result is directly verified against the intended approved behavior.
8. Required Member/Admin browser evidence exists when UX changed.
9. Standards review has no blocking finding.
10. Spec review has no blocking finding against the approved source of truth.
11. The bounded change is committed with a message that states the proved root cause/fix intent, and the exact returned candidate commit has passed the final Standards/Spec review and evidence check.

An unrelated pre-existing full-suite failure does not fail this run only when evidence demonstrates that it is outside the active diff/root-cause class. Record the failing command, symptom, and independence evidence explicitly; do not convert an unexplained failure into a pass by rerunning it.

## Lottify constraints

- Follow repository source-of-truth and traceability rules before modifying product code.
- Preserve `Requirement/Decision -> Plan -> Implementation -> Test -> Actual Result`.
- A green test suite is evidence, not by itself acceptance.
- Do not absorb unrelated dirty work into the active bug-fix commit.
- Shared financial/schema/API/event boundaries remain subject to repository ownership and serialization rules.
- A bug fix that touches a high-risk financial/security boundary is controlled by the critical-change workflow even if this loop is used for diagnosis.
