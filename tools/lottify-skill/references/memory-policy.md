# Memory policy

The repository's approved specification, ADRs, implementation checkpoints and durable evidence are authoritative. Honcho or Supermemory, when available, may help retrieve and hand off that material, but memory content cannot override a changed source document. The workflow must function without either memory service.

At a source-aligned assignment, record the task, source IDs and hashes, checkpoint, base SHA, owner and next dependency in the delegation packet. At return/integration, record the decision, rationale, changed paths, verification artifact, remaining gap and next owner in a durable handoff or checkpoint. Store only concise links/IDs in semantic memory; retrieve and verify the cited source before reusing it.

Never store secrets, credentials, tokens, raw protected PII, full logs or unreviewed generated code in memory. If a memory conflicts with an approved source or newer checkpoint, use the approved source, record the conflict and update or invalidate the stale memory. Do not mark a task accepted because a memory says it was previously green.
