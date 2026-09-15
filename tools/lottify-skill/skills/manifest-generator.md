# Manifest Generator Skill

Use when Lead Agent needs to create or reconcile an execution packet automatically.

## Procedure

1. Before delegation, generate an initial manifest from the task description.
2. Add the active checkpoint, domain ticket and applicable ADRs; confirm source alignment, decision IDs, selected Writer and allowed scope with the Lead.
3. After implementation, inspect staged, unstaged, and untracked changed files.
4. Re-run generation with Git diff signals.
5. Reconcile impacted domains, agents, subskills, and evidence with the initial manifest.
6. Run the source/evidence checker and require any newly discovered review or release gates before acceptance.

## Required Output

Return:

- YAML or JSON manifest;
- selected agents;
- selected subskills;
- ownership boundaries;
- verification requirements.

Executable helper: [scripts/manifest_generator.py](../scripts/manifest_generator.py).
