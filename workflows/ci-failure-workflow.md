# CI Failure Workflow

## Purpose

Resolve GitHub Actions / CI failures without assuming that every red pipeline is a product defect and without weakening tests or acceptance gates to obtain a green run.

## Trigger

Run when a required CI workflow, job, build, migration check, contract check, security scan, or container smoke gate fails.

## Workflow

1. **Identify the exact failure**
   - Use `gh-fix-ci` to inspect the failing workflow/job/log and pin the failing command, step, immutable commit, and error.
   - Do not retry blindly after a deterministic failure.
2. **Classify root-cause domain**
   - CI/config/tooling-only failure stays in this workflow.
   - Product code defect routes through `bug-fix-verification-loop.md` with the CI failure as the original repro.
   - High-risk financial/security behavior routes through `financial-security-critical-change-workflow.md`.
3. **Source alignment**
   - Confirm that the failing gate is still required by the active plan and Ticket 16. Do not delete, skip, quarantine, or loosen a required gate merely to make CI green.
4. **Diagnose**
   - Use `diagnosing-bugs` when the CI failure needs hypothesis-driven local reproduction beyond the evidence supplied by `gh-fix-ci`.
5. **Implement**
   - Make the smallest change that fixes the proved CI root cause.
   - Use `tdd` only when a meaningful product/test regression seam is involved.
6. **Verify**
   - Reproduce the previously failing command locally or in the appropriate controlled environment when possible.
   - Re-run the affected CI gate and any directly impacted checks.
   - A rerun that turns green without a proved explanation does not resolve an unexplained flaky failure.
7. **Review**
   - Run `code-review` before merge for any repository change.
   - Confirm the fix did not weaken the requirement, test oracle, security scanner, migration check, or evidence collection.
8. **Actual Result**
   - Record why the gate failed, why the change fixes that cause, the new CI result, and whether any product acceptance evidence remains outstanding.

## Definition of done

The CI run is complete when the exact failure is explained, the root-cause class is fixed, the previously failing gate passes for the expected reason, required checks remain semantically intact, code review has no blocker, and any product-level acceptance work has been routed to its controlling workflow.

Green CI alone never upgrades a release to Production GO.

## Checkpoint policy

No human checkpoint is required for reversible CI diagnosis/fix work. Escalate only if resolving the failure would require weakening an approved gate/criterion, changing an approved contract/requirement, taking a destructive action, or using human-only credentials/access.
