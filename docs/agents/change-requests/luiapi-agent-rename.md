# Change Request — rename reusable core to luiapi-agent

## User intent

Rename the reusable generic project-delivery skill from `project-agent` to `luiapi-agent` while keeping Lottify as the first project profile and retaining compatibility with manifests created under the prior name.

## Contract change

- Canonical skill identifier becomes `luiapi-agent`.
- Canonical source moves from `tools/project-agent/` to `tools/luiapi-agent/`.
- Hermes Agent and Codex install the canonical skill as `luiapi-agent`.
- `project-agent` remains a registry alias for compatibility, but is not the canonical runtime skill name.
- Existing manifest-v2 records that resolved `project-agent@1.0.0` remain readable.

## Unchanged behavior

Lottify requirements, Ticket 16 evidence semantics, Ticket 19 sequencing, agent roles, review subskills, runtime/Matt skill routing, next-action behavior, and production release gates are unchanged.

## Acceptance criteria

- New manifests require and resolve `luiapi-agent`.
- `project-agent` resolves to canonical `luiapi-agent` through the registry.
- Legacy manifest-v2 records with `project-agent@1.0.0` continue to validate.
- Runtime installer retires only the known legacy `project-agent` symlink and installs `luiapi-agent` on Hermes Agent and Codex.
- Existing unrelated runtime skills are preserved.
- Lottify and generic-core regression suites remain green.
