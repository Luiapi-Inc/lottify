#!/usr/bin/env python3
"""Check source provenance, ownership, and Ticket 16 evidence in a manifest."""

import argparse
import fnmatch
import hashlib
import json
from pathlib import Path
import re

import yaml
from manifest_generator import (
    CONTRACT_VERSION,
    DEFAULT_SOURCES,
    PRODUCTION_RELEASE_EVIDENCE,
    PRODUCTION_RELEASE_REQUIRED_REVIEWERS,
    PRODUCTION_RELEASE_SUBSKILLS,
    RELEASE_GATE_SOURCE,
    is_production_release,
)
from skill_resolver import load_registry, resolve


REQUIRED_KINDS = {'roadmap', 'workflow', 'acceptance', 'checkpoint', 'domain-ticket'}
EVIDENCE_FIELDS = {
    'requirement_id', 'acceptance_id', 'scenario_id', 'level', 'environment',
    'build_id', 'candidate_sha', 'result', 'executed_at', 'artifact',
    'implementation', 'actual_result',
}


def immutable_sha(value):
    return isinstance(value, str) and bool(re.fullmatch(r'(?:[a-f0-9]{40}|[a-f0-9]{64})', value))


def check(manifest, repo, stage):
    problems = []
    contract = manifest.get('contract', {})
    if contract.get('name') != 'lottify-agent-execution-manifest' or contract.get('version') != CONTRACT_VERSION:
        problems.append(f'manifest contract must be lottify-agent-execution-manifest v{CONTRACT_VERSION}')
    task = manifest.get('task', {})
    sources = task.get('source_of_truth', [])
    kinds = {source.get('kind') for source in sources}
    production_release = bool(manifest.get('risk_assessment', {}).get('production_release'))
    objective_requires_release_gate = is_production_release(
        task.get('objective', ''), task.get('changed_files', [])
    )
    for kind in sorted(REQUIRED_KINDS - kinds):
        problems.append(f'missing source kind: {kind}')
    if objective_requires_release_gate and not production_release:
        problems.append('production release objective is not classified as production_release')
    if production_release and 'release-gate' not in kinds:
        problems.append('production release is missing Ticket 13 release-gate source')
    if production_release:
        routing = manifest.get('routing', {})
        missing_subskills = set(PRODUCTION_RELEASE_SUBSKILLS) - set(routing.get('subskills', []))
        for subskill in sorted(missing_subskills):
            problems.append(f'production release missing required subskill: {subskill}')
        required_evidence = set(manifest.get('evidence', {}).get('required', []))
        for item in PRODUCTION_RELEASE_EVIDENCE:
            if item not in required_evidence:
                problems.append(f'production release missing mandatory evidence requirement: {item}')
        required_reviewers = set(manifest.get('reviews', {}).get('required', []))
        for reviewer in PRODUCTION_RELEASE_REQUIRED_REVIEWERS:
            if reviewer not in required_reviewers:
                problems.append(f'production release missing required reviewer: {reviewer}')
    skills = manifest.get('skills', {})
    required_skills = skills.get('required', [])
    try:
        registry = load_registry(Path(__file__).resolve().parent.parent / 'skills' / 'registry.yaml')
        resolved = {entry.get('requested'): entry for entry in skills.get('resolved', [])}
        for requested in required_skills:
            result = resolve(requested, registry)
            record = resolved.get(requested)
            if not record or record.get('canonical') != result['canonical'] or record.get('version') != result['version']:
                problems.append(f'skill resolution missing or stale: {requested}')
    except ValueError as error:
        problems.append(f'skill registry invalid: {error}')
    if not manifest.get('source_alignment', {}).get('confirmed_by_lead'):
        problems.append('Lead has not confirmed source alignment')
    if not manifest.get('source_alignment', {}).get('decision_ids'):
        problems.append('approved requirement/decision IDs not recorded')
    adr_disposition = manifest.get('source_alignment', {}).get('adr_disposition')
    if adr_disposition not in {'reviewed', 'not-applicable'}:
        problems.append('ADR applicability not decided by Lead')
    elif adr_disposition == 'reviewed' and 'adr' not in kinds:
        problems.append('ADR marked reviewed but no ADR source recorded')
    for source in sources:
        path = source.get('path', '')
        kind = source.get('kind')
        if kind in DEFAULT_SOURCES and path != DEFAULT_SOURCES[kind]:
            problems.append(f'noncanonical {kind} source: {path}')
        if kind == 'release-gate' and path != RELEASE_GATE_SOURCE:
            problems.append(f'noncanonical release-gate source: {path}')
        resolved = (repo / path).resolve()
        if not resolved.is_relative_to(repo.resolve()) or not resolved.is_file():
            problems.append(f'source missing or outside repo: {path}')
        elif hashlib.sha256(resolved.read_bytes()).hexdigest() != source.get('sha256'):
            problems.append(f'source changed since manifest generation: {path}')

    ownership = manifest.get('ownership', {})
    if not ownership.get('writer'):
        problems.append('one Writer must be selected by Lead')
    elif ownership['writer'] not in set(ownership.get('writer_candidates', [])) | {'lead-agent'}:
        problems.append('selected Writer is not a routed candidate')
    scope = ownership.get('allowed_scope', [])
    if not scope:
        problems.append('allowed write scope is empty')
    for path in task.get('changed_files', []):
        if not any(fnmatch.fnmatchcase(path, pattern) for pattern in scope):
            problems.append(f'changed path outside allowed scope: {path}')

    if stage == 'acceptance':
        acceptance = manifest.get('acceptance', {})
        if acceptance.get('status') != 'verified':
            problems.append('acceptance status is not verified')
        if acceptance.get('gaps'):
            problems.append('unresolved acceptance gaps remain')
        candidate_sha = acceptance.get('candidate_sha')
        if not immutable_sha(candidate_sha):
            problems.append('acceptance candidate_sha must be an immutable Git SHA')
        records = manifest.get('evidence', {}).get('records', [])
        if not records:
            problems.append('no evidence records')
        for index, record in enumerate(records, 1):
            missing = EVIDENCE_FIELDS - {key for key, value in record.items() if value not in (None, '', [], {})}
            if missing:
                problems.append(f'evidence record {index} missing: {", ".join(sorted(missing))}')
            if record.get('result') != 'passed':
                problems.append(f'evidence record {index} is not passed')
            if record.get('candidate_sha') != candidate_sha:
                problems.append(f'evidence record {index} is for a different candidate')
        required = manifest.get('evidence', {}).get('required', [])
        covered = {item for record in records for item in record.get('covers', [])}
        for item in required:
            if item not in covered:
                problems.append(f'required evidence not covered: {item}')
        reviews = manifest.get('reviews', {})
        accepted_reviewers = {
            record.get('agent')
            for record in reviews.get('records', [])
            if record.get('result') == 'passed'
            and record.get('candidate_sha') == candidate_sha
            and record.get('report')
        }
        for agent in reviews.get('required', []):
            if agent not in accepted_reviewers:
                problems.append(f'required reviewer result missing: {agent}')
    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--repo', type=Path, default=Path.cwd())
    parser.add_argument('--stage', choices=('delegation', 'acceptance'), default='delegation')
    args = parser.parse_args()
    try:
        manifest = yaml.safe_load(args.manifest.read_text(encoding='utf-8'))
        if not isinstance(manifest, dict):
            raise ValueError('manifest must be a mapping')
        problems = check(manifest, args.repo, args.stage)
    except (OSError, ValueError, yaml.YAMLError) as error:
        parser.error(str(error))
    print(json.dumps({'stage': args.stage, 'valid': not problems, 'problems': problems}, indent=2))
    if problems:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
