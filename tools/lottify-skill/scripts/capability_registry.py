#!/usr/bin/env python3
"""Load and route Lottify domain capability ownership rules."""

import argparse
from pathlib import Path

import yaml


REGISTRY_VERSION = 1


def _strings(value, field):
    if not isinstance(value, list) or not value or any(not isinstance(item, str) or not item.strip() for item in value):
        raise ValueError(f'{field} must be a non-empty list of strings')
    return value


def validate_registry(registry):
    if not isinstance(registry, dict) or registry.get('version') != REGISTRY_VERSION:
        raise ValueError(f'capability registry.version must be {REGISTRY_VERSION}')
    entries = registry.get('capabilities')
    if not isinstance(entries, list) or not entries:
        raise ValueError('capability registry.capabilities must be a non-empty list')
    seen_ids = set()
    seen_signals = set()
    for index, entry in enumerate(entries):
        prefix = f'capabilities[{index}]'
        if not isinstance(entry, dict):
            raise ValueError(f'{prefix} must be a mapping')
        identifier = entry.get('id')
        if not isinstance(identifier, str) or not identifier.strip() or identifier in seen_ids:
            raise ValueError(f'{prefix}.id is missing or duplicated')
        seen_ids.add(identifier)
        if not isinstance(entry.get('owner'), str) or not entry['owner'].strip():
            raise ValueError(f'{prefix}.owner is required')
        _strings(entry.get('reviewers'), f'{prefix}.reviewers')
        if type(entry.get('exclusive_boundary')) is not bool:
            raise ValueError(f'{prefix}.exclusive_boundary must be boolean')
        signals = _strings(entry.get('signals'), f'{prefix}.signals')
        _strings(entry.get('evidence'), f'{prefix}.evidence')
        for signal in signals:
            if signal in seen_signals:
                raise ValueError(f'duplicate capability signal: {signal}')
            seen_signals.add(signal)
    return registry


def load_registry(path):
    path = Path(path)
    try:
        value = yaml.safe_load(path.read_text(encoding='utf-8'))
    except (OSError, yaml.YAMLError) as error:
        raise ValueError(f'cannot load capability registry: {error}') from error
    return validate_registry(value)


def route(task, registry):
    if not isinstance(task, str) or not task.strip():
        raise ValueError('task must be a non-empty string')
    validate_registry(registry)
    lowered = task.lower()
    matches = [entry for entry in registry['capabilities'] if any(signal.lower() in lowered for signal in entry['signals'])]
    if not matches:
        raise ValueError(f'no capability route for task: {task}')
    if len(matches) > 1:
        raise ValueError('ambiguous capability route: ' + ', '.join(entry['id'] for entry in matches))
    entry = matches[0]
    return {key: entry[key] for key in ('id', 'owner', 'reviewers', 'exclusive_boundary', 'evidence')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('task')
    parser.add_argument('--registry', type=Path, required=True)
    args = parser.parse_args()
    import json
    try:
        print(json.dumps(route(args.task, load_registry(args.registry)), indent=2))
    except (OSError, ValueError, yaml.YAMLError) as error:
        parser.error(str(error))


if __name__ == '__main__':
    main()
