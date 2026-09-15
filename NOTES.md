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
- Production promotion is blocked by any unresolved release blocker under Ticket 19 priority semantics, any missing mandatory Ticket 16 cell, candidate identity mismatch, or failed Goal Alignment review. Before Production GO, Deployment requires verified deployment plan/readiness and Rollback/Roll-forward Recovery requires verified procedures/readiness plus applicable controlled recovery test/drill evidence. After rollout, append actual deployment and post-switch evidence; actual production recovery execution evidence is required when recovery is exercised.
- Use `lottify` whenever work is delegated to multiple agents, whether execution is parallel or serialized. Parallel Writers require stable prerequisites and proven-disjoint write/ownership boundaries; unstable shared critical boundaries stay serialized under one Writer at a time.

## Release verification environment checkpoint — 2026-09-15

- This section records operational verification facts only. It does not redefine requirements, financial invariants, release gates, or the Source of Truth.
- PostgreSQL and Redis used for Lottify integration/release verification are hosted on `lottify-prod`. Use the approved runtime `DATABASE_URL` and `REDIS_URL`; never commit credentials or connection secrets to this repository.
- CI account/remote for this verification path is `luiapidev` via remote `ci` -> `git@github-luiapi.dev:luiapidev/lottify-ci.git`. CI evidence must identify and test the exact candidate SHA; a green CI run does not waive Ticket 16 acceptance evidence.
- Hermes shell configuration provides GitHub credentials through `GITHUB_TOKEN_DEV` and `GITHUB_TOKEN_SYS`. Their values are runtime secrets and must not be copied into documentation, logs, commits, or release-evidence artifacts.
- Candidate commit `d3db1b08e99e12c72e163669b425cbf7cefd5b76` predates the financial source-allocation change. Commit `9fa46ab32f259c7962e7ec6bd6fb16e8e56318f6` adds `20260913033500_reservation_source_allocation_snapshot` and is an ancestor of current `main` commit `1999c5c6bc03557845a488c6023f384f9efcf14a` (which supersedes the earlier `544882e8b83e5421d3abdfabf1c8c93d2affef1a`).
- Therefore the older `d3db1b0` candidate must not be treated as the acceptance candidate for the current source-allocation invariant. Any replacement candidate still requires Ticket 16 migration compatibility, deterministic financial integration evidence, immutable build identity, and Ticket 19 release-gate checks before production promotion.
- Production migration, deploy, or traffic switching remains a separate high-impact action and is not authorized by this checkpoint.
