# performance-load-review

Owner: qa-agent with release-gate-agent review.

Trigger: capacity, latency, queue lag, settlement throughput or production candidate load evidence. Read Tickets 13, 16 and 19.

Check production-like seeded inputs and pre-cutoff bursts against the approved session, Quote/Confirm, webhook, queue and settlement targets. Include p95/p99 and error rate, resource saturation, retry/concurrency effects and absence of duplicate authoritative financial effects. A green microbenchmark alone cannot prove the release target.

Return test configuration, immutable build, environment, report/metrics reference, achieved versus target values and gaps.
