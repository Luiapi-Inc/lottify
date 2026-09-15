# Manifest Generator CLI

Generate an execution manifest from task description and optionally reconcile it with repository changes.

Before delegation:

```bash
python3 tools/lottify-skill/scripts/manifest_generator.py \
  --task "add withdrawal approval" \
  --checkpoint docs/implementation/member-withdrawal-status.md \
  --source domain-ticket=.scratch/lottify-v1-specification/issues/04-financial-ledger-and-balance-invariants.md \
  --allowed-scope 'apps/api/src/withdrawal/**' \
  --format yaml
```

After implementation:

```bash
python3 tools/lottify-skill/scripts/manifest_generator.py \
  --task "add withdrawal approval" \
  --diff \
  --format json
```

Output:

- selected agents;
- selected subskills;
- ownership scope;
- required evidence;
- acceptance status.

`--diff` includes staged, unstaged, and untracked changed paths. Use `--output <file>` when the manifest should be persisted as an execution artifact.

`--diff` includes all dirty paths in the checkout; use an isolated Writer worktree or repeat `--file` for an exact candidate. The Lead chooses `ownership.writer`, confirms `source_alignment` and decision IDs, then runs `scripts/source_alignment_check.py` at delegation and acceptance stages. Generated `allowed_scope` is empty unless the Lead supplies it explicitly.
