#!/usr/bin/env python3
"""Load and validate reusable luiapi-agent profiles."""

import argparse
import json
from pathlib import Path

import yaml

PROFILE_VERSION = 1


def _strings(value, field, allow_empty=False):
    if not isinstance(value, list) or (not allow_empty and not value):
        qualifier = "a" if allow_empty else "a non-empty"
        raise ValueError(f"{field} must be {qualifier} list")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        raise ValueError(f"{field} must contain non-empty strings")
    return value


def validate_profile(profile):
    if not isinstance(profile, dict) or profile.get("version") != PROFILE_VERSION:
        raise ValueError(f"profile.version must be {PROFILE_VERSION}")
    project = profile.get("project")
    if not isinstance(project, dict):
        raise ValueError("profile.project must be a mapping")
    for field in ("id", "name", "entry_skill"):
        if not isinstance(project.get(field), str) or not project[field].strip():
            raise ValueError(f"profile.project.{field} is required")
    sources = profile.get("sources")
    if not isinstance(sources, dict) or not isinstance(sources.get("required"), dict):
        raise ValueError("profile.sources.required must be a mapping")
    for kind, path in sources["required"].items():
        if not isinstance(kind, str) or not kind.strip() or not isinstance(path, str) or not path.strip():
            raise ValueError("profile.sources.required entries must be non-empty strings")
    _strings(sources.get("status_globs", []), "profile.sources.status_globs", allow_empty=True)
    priorities = _strings(profile.get("priorities"), "profile.priorities")
    if len(priorities) != len(set(priorities)):
        raise ValueError("profile.priorities must not contain duplicates")
    roles = profile.get("roles")
    if not isinstance(roles, dict) or not isinstance(roles.get("lead"), str) or not roles["lead"].strip():
        raise ValueError("profile.roles.lead is required")
    runtime = profile.get("runtime_skills")
    if not isinstance(runtime, dict) or not isinstance(runtime.get("config"), str) or not runtime["config"].strip():
        raise ValueError("profile.runtime_skills.config is required")
    return profile


def load_profile(path):
    path = Path(path)
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as error:
        raise ValueError(f"cannot load project profile: {error}") from error
    return validate_profile(value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profile", type=Path)
    args = parser.parse_args()
    try:
        result = load_profile(args.profile)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
