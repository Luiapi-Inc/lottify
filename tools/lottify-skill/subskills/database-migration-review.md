# database-migration-review

Owner: backend-agent, reviewed by release-gate-agent when rollout is affected.

Trigger: Prisma schema, migration, backfill or reference-data changes. Read Tickets 15, 16, 19, the affected domain ticket, active checkpoint and applicable ADRs.

Check ownership and authoritative data, expand/backfill/verify/contract order, migration replay, old/new application compatibility, business invariant verification after backfill and an explicit rollback or governed roll-forward path. A migration that runs but corrupts data or breaks the rollout window blocks acceptance.

Return exact migration paths, test environment/build, compatibility and integrity results, recovery plan and unresolved gaps.
