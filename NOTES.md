# Workflow Notes

## Bug-fix loop decisions

- Trigger on an observed bug/repro failure or any deterministic test/CI/verification failure.
- Keep each run to one symptom and one root-cause class.
- Continue local reversible diagnose -> implement -> review work autonomously; defer the human checkpoint to requirement decisions, production/deploy/merge policy boundaries, destructive actions, or human-only access.
- A proved unrelated pre-existing full-suite failure may be recorded without blocking the active loop; unexplained or related failures remain blocking.

## Canonical Lottify workflow routing

- `workflows/lottify-main-workflow.md` is the routing source for engineering work.
- Work is classified as Feature, Bug, Financial/Security critical change, CI failure, or Production deploy. Mixed work uses the stricter controlling workflow.
- Skill invocation is conditional by boundary. Do not run every installed skill for every task.
- `security-threat-model` is reserved for high-risk financial/security/trust boundaries.
- Member/Admin UX changes require functional browser verification against the approved UX/design source; screenshots alone are supplemental evidence.
- `code-review` is required before merge for repository changes.
- Ticket 16 acceptance remains distinct from tests/CI and blocks Production GO when mandatory evidence is missing or failed.
- Production deploy is blocked by any release-scoped P0/P1, required evidence gap, candidate identity mismatch, or failed Goal Alignment review.
- `lottify-multi-agent` is used only when prerequisites are stable and Writer scopes plus unstable critical boundaries are proven disjoint.
