#!/usr/bin/env python3
"""Generate Lottify agent execution manifest from task text and git diff."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

import yaml

from capability_registry import load_registry as load_capability_registry
from capability_registry import routes as route_capabilities
from skill_resolver import load_registry, resolve

PROJECT_AGENT_SCRIPTS = Path(__file__).resolve().parents[2] / 'luiapi-agent' / 'scripts'
if str(PROJECT_AGENT_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(PROJECT_AGENT_SCRIPTS))
from runtime_skill_router import load_config as load_runtime_skill_config
from runtime_skill_router import route_skills as route_runtime_skills


CONTRACT_VERSION = 2
SKILL_REGISTRY = Path(__file__).resolve().parent.parent / 'skills' / 'registry.yaml'
RUNTIME_SKILL_CONFIG = Path(__file__).resolve().parents[2] / 'luiapi-agent' / 'skills' / 'runtime-skill-packs.yaml'

RULES = [
    (['prisma/schema'], ['backend-agent', 'quality-gate-agent'], ['prisma-schema-review']),
    (['migration'], ['backend-agent', 'quality-gate-agent', 'release-gate-agent'], ['prisma-schema-review', 'database-migration-review']),
    (['wallet', 'ledger', 'payment', 'deposit', 'refund', 'settlement', 'withdrawal'], ['backend-agent', 'financial-integrity-agent'], ['payment-ledger-review', 'postgres-transaction-review']),
    (['transaction', 'lock', 'isolation', 'concurrency'], ['backend-agent', 'financial-integrity-agent'], ['postgres-transaction-review']),
    (['entity', 'aggregate', 'domain', 'state'], ['backend-agent', 'domain-agent'], ['ddd-domain-review']),
    (['command', 'query', 'event'], ['backend-agent', 'domain-agent'], ['cqrs-event-review']),
    (['api', 'controller', 'dto', 'openapi'], ['backend-agent', 'api-contract-agent'], ['api-contract-review']),
    (['component', 'page', 'form', 'ui'], ['frontend-agent'], ['frontend-accessibility-review']),
    (['e2e', 'playwright', 'browser'], ['qa-agent'], ['e2e-playwright-review']),
    (['docker', 'deploy', 'infra', 'release'], ['release-gate-agent'], ['production-readiness-review', 'infra-deployment-review']),
    (['observability', 'otel', 'opentelemetry', 'sentry', 'metrics'], ['release-gate-agent'], ['observability-review']),
    (['restore', 'recovery', 'pitr', 'rollback'], ['release-gate-agent'], ['chaos-recovery-review']),
    (['dependency', 'vulnerability', 'container scan'], ['security-agent'], ['dependency-security-review']),
    (['auth', 'rbac', 'permission', 'session', 'otp', 'mfa', 'secret', 'webhook', 'security'], ['security-agent'], ['security-auth-review']),
    (['performance', 'throughput', 'latency', 'capacity'], ['qa-agent', 'release-gate-agent'], ['performance-load-review']),
]

DEFAULT_SOURCES = {
    'roadmap': '.scratch/lottify-v1-specification/issues/19-implementation-roadmap-and-delivery-sequencing.md',
    'workflow': '.scratch/lottify-v1-specification/issues/02-end-to-end-business-workflows.md',
    'acceptance': '.scratch/lottify-v1-specification/issues/16-acceptance-criteria-and-test-traceability.md',
}

RELEASE_GATE_SOURCE = '.scratch/lottify-v1-specification/issues/13-non-functional-targets-and-release-gates.md'
PRODUCTION_RELEASE_SIGNALS = ('production', 'release candidate', 'production go', 'go/no-go')
PRODUCTION_RELEASE_SUBSKILLS = (
    'production-readiness-review',
    'infra-deployment-review',
    'observability-review',
    'performance-load-review',
    'dependency-security-review',
    'security-auth-review',
    'chaos-recovery-review',
    'e2e-playwright-review',
    'database-migration-review',
)
PRODUCTION_RELEASE_EVIDENCE = (
    'critical functional E2E result',
    'critical Member/Admin health and smoke result',
    'approved UX functional/visual result',
    'production-like performance result',
    'security release gate result',
    'migration compatibility result',
    'backup/PITR restore result',
    'observability release result',
    'deployment plan',
    'rollback or governed roll-forward plan',
)
PRODUCTION_RELEASE_REQUIRED_REVIEWERS = (
    'quality-gate-agent',
    'security-agent',
    'release-gate-agent',
)


def git_files(repo):
    try:
        files = set()
        for command in (
            ['git', 'diff', '--name-only', '-z'],
            ['git', 'diff', '--cached', '--name-only', '-z'],
            ['git', 'ls-files', '--others', '--exclude-standard', '-z'],
        ):
            output = subprocess.check_output(command, cwd=repo)
            files.update(path.decode('utf-8') for path in output.split(b'\0') if path)
        return sorted(files)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []


def signal_matches(signal, task, files):
    text = (task + ' ' + ' '.join(files)).lower()
    pattern = r'(?<![a-z0-9])' + re.escape(signal) + r's?(?![a-z0-9])'
    return bool(re.search(pattern, text))


def is_production_release(task, files):
    return any(signal_matches(signal, task, files) for signal in PRODUCTION_RELEASE_SIGNALS)


def source_record(repo, kind, path):
    resolved = (repo / path).resolve()
    if not resolved.is_relative_to(repo.resolve()) or not resolved.is_file():
        raise ValueError(f'source does not exist inside repository: {path}')
    return {'kind': kind, 'path': resolved.relative_to(repo.resolve()).as_posix(), 'sha256': hashlib.sha256(resolved.read_bytes()).hexdigest()}


def is_change_request(task):
    return bool(re.search(r'(?<![a-z0-9])change[ -]request(?![a-z0-9])', task.lower()))


def runtime_skill_route(task, files, agents):
    return route_runtime_skills(
        task + ' ' + ' '.join(files),
        agents,
        load_runtime_skill_config(RUNTIME_SKILL_CONFIG),
        change_request=is_change_request(task),
    )


def required_skill_names(task, files, agents):
    names = ['lottify', 'luiapi-agent']
    for skill in runtime_skill_route(task, files, agents)['skills']:
        if skill not in names:
            names.append(skill)
    return names


def generate(task, files, repo=None, sources=(), checkpoint=None, allowed_scope=(), dependencies=()):
    repo = Path.cwd() if repo is None else Path(repo)
    agents = ['lead-agent']
    subskills = []
    matched_signals = []

    for signals, matched_agents, matched_skills in RULES:
        rule_signals = [signal for signal in signals if signal_matches(signal, task, files)]
        if rule_signals:
            for signal in rule_signals:
                if signal not in matched_signals:
                    matched_signals.append(signal)
            for agent in matched_agents:
                if agent not in agents:
                    agents.append(agent)
            for skill in matched_skills:
                if skill not in subskills:
                    subskills.append(skill)

    production_release = is_production_release(task, files)
    if production_release:
        for agent in ('qa-agent', 'security-agent', 'release-gate-agent'):
            if agent not in agents:
                agents.append(agent)
        for skill in PRODUCTION_RELEASE_SUBSKILLS:
            if skill not in subskills:
                subskills.append(skill)

    if len(agents) > 1 and 'quality-gate-agent' not in agents:
        agents.append('quality-gate-agent')

    evidence = ['requirement trace', 'test evidence', 'review findings']
    evidence_by_subskill = {
        'prisma-schema-review': ['schema/migration validation'],
        'payment-ledger-review': ['ledger invariant verification', 'idempotency evidence'],
        'postgres-transaction-review': ['transaction/isolation evidence', 'concurrency evidence'],
        'ddd-domain-review': ['domain invariant evidence'],
        'cqrs-event-review': ['command/event contract evidence'],
        'api-contract-review': ['OpenAPI diff', 'consumer compatibility result'],
        'frontend-accessibility-review': ['accessibility verification'],
        'e2e-playwright-review': ['critical workflow E2E result'],
        'production-readiness-review': ['acceptance trace', 'migration status', 'observability status', 'rollback point'],
        'security-auth-review': ['positive and denial-path security result'],
        'performance-load-review': ['production-like load result'],
        'database-migration-review': ['old/new application compatibility result', 'backfill integrity result'],
        'infra-deployment-review': ['immutable candidate and rollout plan'],
        'observability-review': ['correlation and alert verification'],
        'chaos-recovery-review': ['restore/replay or roll-forward result'],
        'dependency-security-review': ['dependency/container scan result'],
    }
    for subskill in subskills:
        for item in evidence_by_subskill.get(subskill, []):
            if item not in evidence:
                evidence.append(item)
    if production_release:
        for item in PRODUCTION_RELEASE_EVIDENCE:
            if item not in evidence:
                evidence.append(item)

    source_records = [source_record(repo, kind, path) for kind, path in DEFAULT_SOURCES.items()]
    if production_release:
        source_records.append(source_record(repo, 'release-gate', RELEASE_GATE_SOURCE))
    for entry in sources:
        kind, separator, path = entry.partition('=')
        if not separator or not kind or not path:
            raise ValueError('--source must be KIND=REPO_RELATIVE_PATH')
        source_records.append(source_record(repo, kind, path))
    if checkpoint:
        source_records.append(source_record(repo, 'checkpoint', checkpoint))
    gaps = []
    if not checkpoint:
        gaps.append('active implementation checkpoint not recorded')
    if not any(record['kind'] == 'domain-ticket' for record in source_records):
        gaps.append('applicable domain ticket not recorded')
    if not allowed_scope:
        gaps.append('Lead has not assigned allowed write scope')
    gaps.append('Lead has not confirmed source alignment or decision IDs')
    gaps.append('Lead has not selected one Writer')
    writer_candidates = [agent for agent in agents if agent in {'backend-agent', 'frontend-agent', 'qa-agent'}]

    shared_boundaries = [skill for skill in ('prisma-schema-review', 'payment-ledger-review', 'postgres-transaction-review', 'api-contract-review', 'cqrs-event-review') if skill in subskills]
    risk = 'critical' if any(skill in subskills for skill in ('payment-ledger-review', 'postgres-transaction-review', 'security-auth-review')) else 'high' if shared_boundaries or 'production-readiness-review' in subskills else 'standard'
    reviewers = [agent for agent in agents if agent in {'domain-agent', 'financial-integrity-agent', 'api-contract-agent', 'quality-gate-agent', 'release-gate-agent', 'security-agent'}]
    if production_release:
        for reviewer in PRODUCTION_RELEASE_REQUIRED_REVIEWERS:
            if reviewer not in reviewers:
                reviewers.append(reviewer)
    skill_registry = load_registry(SKILL_REGISTRY)
    required_skills = required_skill_names(task, files, agents)
    resolved_skills = [
        {
            'requested': requested,
            **resolve(requested, skill_registry),
        }
        for requested in required_skills
    ]
    capabilities = route_capabilities(
        task + ' ' + ' '.join(files),
        load_capability_registry(Path(__file__).resolve().parent.parent / 'skills' / 'capability-registry.yaml'),
    )
    return {
        'contract': {'name': 'lottify-agent-execution-manifest', 'version': CONTRACT_VERSION},
        'task': {'objective': task, 'changed_files': list(files), 'source_of_truth': source_records},
        'dependencies': list(dependencies),
        'source_alignment': {'confirmed_by_lead': False, 'decision_ids': [], 'adr_disposition': None},
        'risk_assessment': {'suggested_level': risk, 'shared_boundaries': shared_boundaries, 'parallelism': 'Lead must prove stable dependencies and disjoint ownership' if shared_boundaries else 'Lead decides from actual ownership', 'production_release': production_release},
        'routing': {
            'lead_agent': 'lead-agent',
            'agents': agents,
            'subskills': subskills,
            'matched_signals': matched_signals,
        },
        'skills': {'required': required_skills, 'resolved': resolved_skills},
        'capabilities': capabilities,
        'records': {'decisions': [], 'handoffs': [], 'checkpoints': [], 'evidence_refs': []},
        'ownership': {'writer_candidates': writer_candidates, 'writer': None, 'allowed_scope': list(allowed_scope), 'forbidden_scope': []},
        'evidence': {'required': evidence, 'records': []},
        'reviews': {'required': reviewers, 'records': []},
        'acceptance': {'status': 'pending', 'candidate_sha': None, 'level': 'local-checkpoint', 'gaps': gaps},
        'execution': {
            'checkpoint_version': 2,
            'state': 'SOURCE_ALIGNMENT',
            'objective_id': hashlib.sha256(task.encode('utf-8')).hexdigest(),
        },
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--task', required=True)
    parser.add_argument('--repo', type=Path, default=Path.cwd())
    parser.add_argument('--diff', action='store_true')
    parser.add_argument('--file', action='append', default=[], help='Changed path; repeat for scoped reviews')
    parser.add_argument('--source', action='append', default=[], help='KIND=REPO_RELATIVE_PATH; repeat for domain ticket and ADR')
    parser.add_argument('--checkpoint', help='Active implementation checkpoint path')
    parser.add_argument('--allowed-scope', action='append', default=[], help='Lead-approved path or glob; repeat')
    parser.add_argument('--dependency', action='append', default=[], help='Package dependency; repeat')
    parser.add_argument('--format', choices=('yaml', 'json'), default='yaml')
    parser.add_argument('--json', action='store_true', help='Compatibility alias for --format json')
    parser.add_argument('--output')
    args = parser.parse_args()
    try:
        files = sorted(set(args.file) | (set(git_files(args.repo)) if args.diff else set()))
        output = generate(args.task, files, args.repo, args.source, args.checkpoint, args.allowed_scope, args.dependency)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.error(str(error))
    selected_format = 'json' if args.json else args.format
    rendered = json.dumps(output, indent=2) if selected_format == 'json' else yaml.safe_dump(output, sort_keys=False, allow_unicode=True)
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as handle:
            handle.write(rendered)
    else:
        print(rendered, end='')
