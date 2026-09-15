#!/usr/bin/env python3
"""Install project-agent and project profiles into supported local agent runtimes."""

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil

import yaml

from runtime_skill_router import load_config


SUPPORTED_RUNTIMES = ("hermes", "codex")


def _skill_name(path):
    skill_file = path / "SKILL.md"
    if not skill_file.is_file():
        return None
    text = skill_file.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---\n", 4)
    if end < 0:
        return None
    try:
        frontmatter = yaml.safe_load(text[4:end])
    except yaml.YAMLError:
        return None
    name = frontmatter.get("name") if isinstance(frontmatter, dict) else None
    return name if isinstance(name, str) and name.strip() else None


def _runtime_roots(runtime, home, codex_home=None):
    home = Path(home)
    if runtime == "hermes":
        return {
            "root": home / ".hermes" / "skills",
            "project_target": home / ".hermes" / "skills" / "software-development" / "project-agent",
            "profile_target": home / ".hermes" / "skills" / "software-development" / "lottify",
            "shared_target_root": home / ".hermes" / "skills",
        }
    if runtime == "codex":
        root = Path(codex_home) / "skills" if codex_home else home / ".codex" / "skills"
        return {
            "root": root,
            "project_target": root / "project-agent",
            "profile_target": root / "lottify",
            "shared_target_root": root,
        }
    raise ValueError(f"unsupported runtime: {runtime}")


def _referenced_skills(config):
    names = []
    for section in ("role_defaults", "action_packs"):
        for skills in config[section].values():
            for skill in skills:
                if skill not in names:
                    names.append(skill)
    return names


def _link(source, target, backup_root, *, migrate_existing=False, dry_run=False):
    source = Path(source).resolve()
    target = Path(target)
    if not (source / "SKILL.md").is_file():
        raise ValueError(f"skill source is missing SKILL.md: {source}")
    if target.is_symlink():
        try:
            if target.resolve() == source:
                return {"target": str(target), "source": str(source), "action": "unchanged"}
        except OSError:
            pass
        if not migrate_existing:
            return {"target": str(target), "source": str(source), "action": "conflict"}
        if not dry_run:
            target.unlink()
    elif target.exists():
        if not migrate_existing:
            return {"target": str(target), "source": str(source), "action": "preserved"}
        backup = Path(backup_root) / target.name
        if backup.exists():
            raise ValueError(f"backup path already exists: {backup}")
        if not dry_run:
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(target), str(backup))
        backup_path = str(backup)
    else:
        backup_path = None

    if not dry_run:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(source, target_is_directory=True)
    result = {"target": str(target), "source": str(source), "action": "linked"}
    if "backup_path" in locals() and backup_path:
        result["backup"] = backup_path
    return result


def _discover_skill_names(root):
    root = Path(root)
    if not root.exists():
        return []
    names = set()
    seen_real_dirs = set()
    for current, dirs, files in os.walk(root, followlinks=True):
        real = os.path.realpath(current)
        if real in seen_real_dirs:
            dirs[:] = []
            continue
        seen_real_dirs.add(real)
        if "SKILL.md" not in files:
            continue
        name = _skill_name(Path(current))
        if name:
            names.add(name)
        dirs[:] = []
    return sorted(names)


def install_runtime(runtime, repo, home, *, codex_home=None, migrate_existing=False, dry_run=False, timestamp=None):
    repo = Path(repo).resolve()
    home = Path(home).resolve()
    roots = _runtime_roots(runtime, home, codex_home)
    project_source = repo / "tools" / "project-agent"
    lottify_source = repo / "tools" / "lottify-skill"
    config = load_config(project_source / "skills" / "runtime-skill-packs.yaml")
    shared_source_root = home / ".agents" / "skills"
    stamp = timestamp or dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_root = home / ".local" / "share" / "project-agent" / "backups" / runtime / stamp

    actions = [
        _link(
            project_source,
            roots["project_target"],
            backup_root,
            migrate_existing=migrate_existing,
            dry_run=dry_run,
        ),
        _link(
            lottify_source,
            roots["profile_target"],
            backup_root,
            migrate_existing=migrate_existing,
            dry_run=dry_run,
        ),
    ]

    unresolved = []
    for skill in _referenced_skills(config):
        target = roots["shared_target_root"] / skill
        if target.exists() or target.is_symlink():
            actions.append({"target": str(target), "source": None, "action": "preserved"})
            continue
        source = shared_source_root / skill
        if (source / "SKILL.md").is_file():
            actions.append(_link(source, target, backup_root, dry_run=dry_run))
        else:
            unresolved.append(skill)

    available = _discover_skill_names(roots["root"])
    inventory = {
        "version": 1,
        "runtime": runtime,
        "skill_root": str(roots["root"]),
        "available_skills": available,
        "unresolved_runtime_pack_skills": sorted(unresolved),
        "canonical_repo": str(repo),
    }
    inventory_path = home / ".local" / "share" / "project-agent" / f"{runtime}-inventory.json"
    if not dry_run:
        inventory_path.parent.mkdir(parents=True, exist_ok=True)
        inventory_path.write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")

    return {
        "runtime": runtime,
        "actions": actions,
        "inventory": inventory,
        "inventory_path": str(inventory_path),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--runtime", choices=(*SUPPORTED_RUNTIMES, "all"), default="all")
    parser.add_argument("--codex-home", type=Path)
    parser.add_argument("--migrate-existing", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--format", choices=("json", "yaml"), default="json")
    args = parser.parse_args()

    runtimes = SUPPORTED_RUNTIMES if args.runtime == "all" else (args.runtime,)
    try:
        results = [
            install_runtime(
                runtime,
                args.repo,
                args.home,
                codex_home=args.codex_home or os.environ.get("CODEX_HOME"),
                migrate_existing=args.migrate_existing,
                dry_run=args.dry_run,
            )
            for runtime in runtimes
        ]
    except (OSError, ValueError, yaml.YAMLError) as error:
        parser.error(str(error))

    output = {"results": results}
    if args.format == "yaml":
        print(yaml.safe_dump(output, sort_keys=False, allow_unicode=True), end="")
    else:
        print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
