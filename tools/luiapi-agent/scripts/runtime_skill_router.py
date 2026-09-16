#!/usr/bin/env python3
"""Route agent/action context to installed runtime skill identifiers."""

import argparse
import json
import re
from pathlib import Path

import yaml

CONFIG_VERSION = 1


def _skill_list(value, field):
    if not isinstance(value, list) or any(not isinstance(item, str) or not item.strip() for item in value):
        raise ValueError(f"{field} must be a list of non-empty strings")
    return value


def validate_config(config):
    if not isinstance(config, dict) or config.get("version") != CONFIG_VERSION:
        raise ValueError(f"runtime skill config.version must be {CONFIG_VERSION}")
    for section in ("role_defaults", "action_packs", "action_signals"):
        value = config.get(section)
        if not isinstance(value, dict):
            raise ValueError(f"runtime skill config.{section} must be a mapping")
        for key, items in value.items():
            if not isinstance(key, str) or not key.strip():
                raise ValueError(f"runtime skill config.{section} contains an invalid key")
            _skill_list(items, f"runtime skill config.{section}.{key}")
    guarded = config.get("guarded_skills", {})
    if not isinstance(guarded, dict) or any(
        not isinstance(skill, str) or not skill.strip() or policy != "change-request"
        for skill, policy in guarded.items()
    ):
        raise ValueError("runtime skill config.guarded_skills must map skill names to change-request")
    return config


def load_config(path):
    try:
        value = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as error:
        raise ValueError(f"cannot load runtime skill config: {error}") from error
    return validate_config(value)


def load_inventory(path):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot load runtime inventory: {error}") from error
    if not isinstance(value, dict) or value.get("version") != 1:
        raise ValueError("runtime inventory.version must be 1")
    available = value.get("available_skills")
    if not isinstance(available, list) or any(not isinstance(item, str) or not item for item in available):
        raise ValueError("runtime inventory.available_skills must be a list of non-empty strings")
    return value


def _signal_match(signal, text):
    if any(ord(char) > 127 for char in signal):
        return signal.lower() in text.lower()
    pattern = r"(?<![a-z0-9])" + re.escape(signal.lower()) + r"(?![a-z0-9])"
    return bool(re.search(pattern, text.lower()))


def classify_actions(text, config):
    validate_config(config)
    return [
        action
        for action, signals in config["action_signals"].items()
        if any(_signal_match(signal, text) for signal in signals)
    ]


def route_skills(text, agents, config, *, explicit_actions=(), change_request=False, available_skills=None):
    validate_config(config)
    if not isinstance(text, str):
        raise ValueError("text must be a string")
    if not isinstance(agents, (list, tuple)) or any(not isinstance(agent, str) or not agent for agent in agents):
        raise ValueError("agents must be a list of non-empty strings")
    actions = list(explicit_actions) if explicit_actions else classify_actions(text, config)
    unknown = [action for action in actions if action not in config["action_packs"]]
    if unknown:
        raise ValueError("unknown action pack: " + ", ".join(unknown))
    selected = []
    skipped = []

    def add(skill):
        policy = config.get("guarded_skills", {}).get(skill)
        if policy == "change-request" and not change_request:
            if skill not in skipped:
                skipped.append(skill)
            return
        if skill not in selected:
            selected.append(skill)

    for agent in agents:
        for skill in config["role_defaults"].get(agent, []):
            add(skill)
    for action in actions:
        for skill in config["action_packs"].get(action, []):
            add(skill)

    unavailable = []
    if available_skills is not None:
        available = set(available_skills)
        unavailable = [skill for skill in selected if skill not in available]
        selected = [skill for skill in selected if skill in available]
    return {
        "action_types": actions,
        "skills": selected,
        "guarded_skills_skipped": skipped,
        "unavailable_skills": unavailable,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--agent", action="append", default=[])
    parser.add_argument("--action", action="append", default=[])
    parser.add_argument("--change-request", action="store_true")
    parser.add_argument("--inventory", type=Path)
    args = parser.parse_args()
    try:
        inventory = load_inventory(args.inventory) if args.inventory else None
        result = route_skills(
            args.text,
            args.agent,
            load_config(args.config),
            explicit_actions=args.action,
            change_request=args.change_request,
            available_skills=inventory["available_skills"] if inventory else None,
        )
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
