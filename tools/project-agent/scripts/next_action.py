#!/usr/bin/env python3
"""Resolve one project next action from approved priorities, dependencies and current execution state."""

import argparse
import json
from pathlib import Path

import yaml

from project_profile import load_profile
from runtime_skill_router import load_config, route_skills

STATE_VERSION = 1
STATUSES = {"pending", "running", "done", "blocked", "waiting", "cancelled"}


def load_state(path):
    try:
        value = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as error:
        raise ValueError(f"cannot load next-action state: {error}") from error
    return value


def validate_state(state, profile):
    if not isinstance(state, dict) or state.get("version") != STATE_VERSION:
        raise ValueError(f"state.version must be {STATE_VERSION}")
    for field in ("objective", "current_state"):
        if not isinstance(state.get(field), str) or not state[field].strip():
            raise ValueError(f"state.{field} is required")
    actions = state.get("actions")
    if not isinstance(actions, list):
        raise ValueError("state.actions must be a list")
    priorities = set(profile["priorities"])
    seen = set()
    for index, action in enumerate(actions):
        prefix = f"actions[{index}]"
        if not isinstance(action, dict):
            raise ValueError(f"{prefix} must be a mapping")
        for field in ("id", "title", "status", "priority", "owner"):
            if not isinstance(action.get(field), str) or not action[field].strip():
                raise ValueError(f"{prefix}.{field} is required")
        if action["id"] in seen:
            raise ValueError(f'duplicate action id: {action["id"]}')
        seen.add(action["id"])
        if action["status"] not in STATUSES:
            raise ValueError(f"{prefix}.status is unsupported")
        if action["priority"] not in priorities:
            raise ValueError(f"{prefix}.priority is not declared by the project profile")
        for field in ("depends_on", "blockers", "gaps", "project_subskills", "evidence_required", "action_types"):
            value = action.get(field, [])
            if not isinstance(value, list) or any(not isinstance(item, str) or not item.strip() for item in value):
                raise ValueError(f"{prefix}.{field} must be a list of strings")
        if action.get("expected_result") is not None and not isinstance(action["expected_result"], str):
            raise ValueError(f"{prefix}.expected_result must be text")
    for action in actions:
        unknown = set(action.get("depends_on", [])) - seen
        if unknown:
            raise ValueError(f'action {action["id"]} has unknown dependencies: {", ".join(sorted(unknown))}')
    return state


def _rank(action, priority_order, index):
    return (priority_order.index(action["priority"]), index)


def _result(action, state, skill_config, status, reason, change_request):
    runtime = route_skills(
        state["objective"] + " " + action["title"],
        [action["owner"]],
        skill_config,
        explicit_actions=action.get("action_types", []),
        change_request=change_request,
    )
    return {
        "status": status,
        "current_state": state["current_state"],
        "gap": action.get("gaps", []),
        "recommended_action": {
            "id": action["id"],
            "title": action["title"],
            "reason": reason,
            "owner": action["owner"],
            "priority": action["priority"],
            "project_subskills": action.get("project_subskills", []),
            "runtime_skills": runtime["skills"],
            "expected_result": action.get("expected_result"),
            "evidence_required": action.get("evidence_required", []),
            "blockers": action.get("blockers", []),
        },
    }


def resolve_next_action(state, profile, skill_config, *, change_request=False):
    validate_state(state, profile)
    actions = state["actions"]
    priority_order = profile["priorities"]
    indexed = list(enumerate(actions))
    running = [(index, action) for index, action in indexed if action["status"] == "running"]
    if running:
        index, action = min(running, key=lambda pair: _rank(pair[1], priority_order, pair[0]))
        return _result(
            action,
            state,
            skill_config,
            "in-progress",
            "continue the highest-priority active action",
            change_request,
        )

    done = {action["id"] for action in actions if action["status"] == "done"}
    executable = [
        (index, action)
        for index, action in indexed
        if action["status"] == "pending"
        and not action.get("blockers", [])
        and set(action.get("depends_on", [])).issubset(done)
    ]
    if executable:
        index, action = min(executable, key=lambda pair: _rank(pair[1], priority_order, pair[0]))
        return _result(
            action,
            state,
            skill_config,
            "ready",
            "highest-priority executable action with satisfied dependencies",
            change_request,
        )

    unfinished = [action for action in actions if action["status"] not in {"done", "cancelled"}]
    if not unfinished:
        return {
            "status": "done",
            "current_state": state["current_state"],
            "gap": [],
            "recommended_action": None,
            "resume_condition": None,
        }
    waits = []
    for action in unfinished:
        missing = [dependency for dependency in action.get("depends_on", []) if dependency not in done]
        reasons = list(action.get("blockers", []))
        if missing:
            reasons.append("waiting for dependencies: " + ", ".join(missing))
        if action["status"] in {"blocked", "waiting"} and not reasons:
            reasons.append(f'action state is {action["status"]}')
        waits.append({"id": action["id"], "reasons": reasons or ["not executable from current state"]})
    return {
        "status": "waiting",
        "current_state": state["current_state"],
        "gap": [reason for item in waits for reason in item["reasons"]],
        "recommended_action": None,
        "waiting_actions": waits,
        "resume_condition": "new evidence, dependency completion, access, or authoritative state change makes an action executable",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--change-request", action="store_true")
    parser.add_argument("--format", choices=("yaml", "json"), default="yaml")
    args = parser.parse_args()
    try:
        profile = load_profile(args.profile)
        config_path = args.repo / profile["runtime_skills"]["config"]
        result = resolve_next_action(
            load_state(args.state),
            profile,
            load_config(config_path),
            change_request=args.change_request,
        )
    except ValueError as error:
        parser.error(str(error))
    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(yaml.safe_dump(result, sort_keys=False, allow_unicode=True), end="")


if __name__ == "__main__":
    main()
