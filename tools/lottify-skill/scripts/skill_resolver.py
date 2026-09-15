#!/usr/bin/env python3
"""Resolve requested Lottify capability names to installed canonical skills."""

import argparse
from pathlib import Path
import re

import yaml


REGISTRY_VERSION = 1
STATUSES = {'installed', 'advisory', 'retired'}
VERSION_PATTERN = re.compile(r'^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$')
IDENTIFIER_PATTERN = re.compile(r'^[a-z0-9][a-z0-9._:-]*$')


def _strings(value, field):
    if not isinstance(value, list) or not value or any(not isinstance(item, str) or not item.strip() for item in value):
        raise ValueError(f'{field} must be a non-empty list of strings')
    return value


def validate_registry(registry):
    if not isinstance(registry, dict) or registry.get('version') != REGISTRY_VERSION:
        raise ValueError(f'registry.version must be {REGISTRY_VERSION}')
    entries = registry.get('skills')
    if not isinstance(entries, list) or not entries:
        raise ValueError('registry.skills must be a non-empty list')

    seen_canonical = set()
    seen_aliases = set()
    for index, entry in enumerate(entries):
        prefix = f'registry.skills[{index}]'
        if not isinstance(entry, dict):
            raise ValueError(f'{prefix} must be a mapping')
        canonical = entry.get('canonical')
        if not isinstance(canonical, str) or not IDENTIFIER_PATTERN.fullmatch(canonical):
            raise ValueError(f'{prefix}.canonical is invalid')
        if canonical in seen_canonical:
            raise ValueError(f'duplicate canonical skill: {canonical}')
        seen_canonical.add(canonical)
        version = entry.get('version')
        if not isinstance(version, str) or not VERSION_PATTERN.fullmatch(version):
            raise ValueError(f'{prefix}.version must be semantic version text')
        aliases = _strings(entry.get('aliases'), f'{prefix}.aliases')
        status = entry.get('status')
        if status not in STATUSES:
            raise ValueError(f'{prefix}.status is unsupported')
        for alias in aliases:
            if not IDENTIFIER_PATTERN.fullmatch(alias):
                raise ValueError(f'{prefix}.aliases contains invalid identifier: {alias}')
            if alias in seen_aliases:
                raise ValueError(f'duplicate alias: {alias}')
            seen_aliases.add(alias)
        if canonical not in aliases:
            raise ValueError(f'{prefix}.aliases must include canonical identifier')
        if status == 'installed' and not isinstance(entry.get('path'), str):
            raise ValueError(f'{prefix}.path is required for installed skill')
    return registry


def load_registry(path):
    path = Path(path)
    try:
        value = yaml.safe_load(path.read_text(encoding='utf-8'))
    except (OSError, yaml.YAMLError) as error:
        raise ValueError(f'cannot load skill registry: {error}') from error
    return validate_registry(value)


def resolve(requested, registry, required_version=None, available_identifiers=None):
    if not isinstance(requested, str) or not requested.strip():
        raise ValueError('requested skill must be a non-empty string')
    validate_registry(registry)
    match = next((entry for entry in registry['skills'] if requested in entry['aliases']), None)
    if match is None:
        raise ValueError(f'unknown skill: {requested}')
    if match['status'] != 'installed':
        raise ValueError(f'skill {requested} is not installed')
    if required_version is not None and match['version'] != required_version:
        raise ValueError(
            f'skill {requested} version mismatch: required {required_version}, installed {match["version"]}'
        )
    if available_identifiers is not None and match['canonical'] not in set(available_identifiers):
        raise ValueError(f'skill {requested} is not installed on the current host')
    return {
        'canonical': match['canonical'],
        'version': match['version'],
        'status': match['status'],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('skill')
    parser.add_argument('--registry', type=Path, required=True)
    parser.add_argument('--version', dest='required_version')
    parser.add_argument('--available', action='append', default=None)
    args = parser.parse_args()
    try:
        registry = load_registry(args.registry)
        result = resolve(args.skill, registry, args.required_version, args.available)
    except (OSError, ValueError, yaml.YAMLError) as error:
        parser.error(str(error))
    import json
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
