# Blue/green release skeleton

Lottify promotes one immutable production-candidate artifact set through inactive-color deployment, compatibility verification, smoke verification, deliberate traffic switch, and post-switch verification.

1. Build API, worker, Member, and Admin OCI artifacts once; record immutable digests.
2. Apply only reviewed expand/backfill-compatible migrations before the traffic switch.
3. Deploy the candidate to the inactive color with the production configuration and secret references.
4. Verify startup/liveness/readiness, `/api/v1`, queue connectivity, PostgreSQL compatibility, metrics/traces/error tracking, and critical smoke scenarios.
5. Switch traffic deliberately to the inactive color and record the release/correlation evidence.
6. Re-run post-deploy smoke and financial/operational health checks.
7. Roll application traffic back only while schema/data compatibility is preserved; otherwise use the governed roll-forward recovery path.

This file is the deployment skeleton only. Production GO remains blocked until Ticket 13/16 evidence is complete.
