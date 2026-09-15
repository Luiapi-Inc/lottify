# dependency-security-review

Owner: security-agent.

Trigger: dependency/lockfile, container base image, secrets scan or release candidate security evidence. Read Tickets 13 and 16 plus the active checkpoint.

Check reproducible lockfile/image identity, dependency and OCI image scan reports, secrets scan, unresolved Critical findings and governed handling of High findings. Verify remediation against the exact candidate rather than an older image or a rerun on different dependencies.

Return scan artifact, candidate SHA/digest, findings by severity, disposition and release blockers.
