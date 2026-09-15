# Change Request — Hermes and Codex runtime installation

## User intent

Make the reusable project-agent/Lottify skill stack installable and usable on at least Hermes Agent and Codex on the Hermes host.

## Difference from the existing framework

The project-agent decision model, Lottify profile, Ticket 16/19 behavior, manifest v2 contract, ownership rules and acceptance gates remain unchanged.

This change adds runtime installation/discovery only:

- canonical project skill sources remain under `tools/project-agent/` and `tools/lottify-skill/`;
- Hermes and Codex receive managed links to those canonical sources;
- shared Matt/engineering skills under `~/.agents/skills` may be bridged into each runtime when that runtime does not already provide the skill;
- existing runtime-native skills are preserved;
- an inventory records which skill identifiers are actually discoverable in each runtime and which configured skills remain unavailable.

## Acceptance criteria

- Installer supports `hermes`, `codex`, and `all`.
- Existing non-symlink runtime skills are not overwritten unless `--migrate-existing` is explicit.
- A migrated existing skill is backed up outside the runtime skill root before replacement.
- `project-agent` and `lottify` resolve to canonical repo sources after installation.
- Shared Matt skills are linked only when their source `SKILL.md` exists.
- Runtime-native skills are preserved.
- Runtime inventory is generated for each installed runtime.
- Unit tests cover Hermes install, Codex migration/preservation, and dry-run behavior.
