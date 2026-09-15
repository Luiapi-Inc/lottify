# observability-review

Owner: release-gate-agent.

Trigger: telemetry, logging, traces, metrics, alerts or a critical workflow whose recovery depends on them. Read Tickets 13, 15, 16 and the active checkpoint.

Check `correlationId` propagation across HTTP, commands, Outbox/queue and provider attempts; structured JSON logs, OpenTelemetry seams, Prometheus-compatible metrics, Sentry error reporting and relevant business alerts. Verify IDs are not confused with business/idempotency keys and logs do not expose secrets or protected PII.

Return a trace or deterministic test reference, alert verification, missing coverage and release impact.
