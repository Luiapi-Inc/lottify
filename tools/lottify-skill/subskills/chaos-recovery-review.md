# chaos-recovery-review

Owner: release-gate-agent with qa-agent for deterministic exercises.

Trigger: backup/PITR, provider ambiguity, Outbox/queue replay, failover or rollback/recovery change. Read Tickets 09, 13, 15, 16 and 19 as applicable.

Check controlled failure/replay inputs, once-only business/financial effects, reconciliation after ambiguous outcomes, restore to `RPO <= 5 minutes` and `RTO <= 60 minutes`, Ledger/schema/critical-reference integrity and safe resumption of in-flight work. Confirm application rollback compatibility or governed roll-forward recovery.

Return exercise timeline, immutable build/environment, artifacts, actual RPO/RTO or replay result, invariant proof and remaining gaps.
