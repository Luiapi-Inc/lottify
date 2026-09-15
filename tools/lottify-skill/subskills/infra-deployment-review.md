# infra-deployment-review

Owner: release-gate-agent.

Trigger: immutable image, environment configuration, deployment topology, migration execution or blue/green rollout change. Read Tickets 13, 15, 16 and 19.

Check candidate image identity, startup validation, runtime secret references, separate API/worker/Member/Admin readiness, old/new database compatibility, inactive-environment smoke, traffic-switch criteria and post-switch verification. Confirm rollback is compatible with current schema/data or name the governed roll-forward path.

Return candidate digest, migration/configuration evidence, health/smoke result, recovery route and GO/NO-GO gaps. This review does not authorize deployment.
