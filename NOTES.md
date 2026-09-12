# Workflow Notes

## Bug-fix loop decisions

- Trigger on an observed bug/repro failure or any deterministic test/CI/verification failure.
- Keep each run to one symptom and one root-cause class.
- Continue local reversible diagnose -> implement -> commit candidate -> exact-commit review work autonomously; defer the human checkpoint to requirement decisions, production/deploy/merge policy boundaries, destructive actions, or human-only access.
- A proved unrelated pre-existing full-suite failure may be recorded without blocking the active loop; unexplained or related failures remain blocking.

## Local Lottify workflow routing notes

- `workflows/lottify-main-workflow.md` is an engineering workflow entrypoint under `AGENTS.md` and the approved source documents; it does not create or replace source-of-truth requirements.
- Work is classified as Feature, Bug, Financial/Security critical change, CI failure, or Production deploy. Mixed work uses the stricter controlling workflow.
- Skill invocation is conditional by boundary. Do not run every installed skill for every task.
- `security-threat-model` is reserved for high-risk financial/security/trust boundaries.
- Member/Admin UX changes require functional browser verification against the approved UX/design source; screenshots alone are supplemental evidence.
- `code-review` is required before merge for repository changes.
- Ticket 16 acceptance remains distinct from tests/CI and blocks Production GO when mandatory evidence is missing or failed.
- Production promotion is blocked by any unresolved release blocker under Ticket 19 priority semantics, any applicable pre-deploy mandatory evidence gap, candidate identity mismatch, or failed Goal Alignment review. Final release acceptance also requires the post-deploy Deployment and Rollback/Roll-forward Recovery evidence required by Ticket 16.
- Use `lottify-multi-agent` whenever work is delegated to multiple agents, whether execution is parallel or serialized. Parallel Writers require stable prerequisites and proven-disjoint write/ownership boundaries; unstable shared critical boundaries stay serialized under one Writer at a time.
