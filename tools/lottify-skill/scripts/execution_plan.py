"""Bind source-aligned manifests to Writer, review, acceptance and integration nodes."""

import hashlib
import json
from pathlib import Path
import re

import yaml

from source_alignment_check import check
from model_router import string_list


def load_mapping(path):
    value = yaml.safe_load(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        raise ValueError(f'{path}: expected a mapping')
    return value


def contract_digest(manifest):
    contract = {key: manifest.get(key) for key in ('contract', 'task', 'dependencies', 'source_alignment', 'risk_assessment', 'routing', 'skills', 'capabilities', 'ownership', 'records', 'execution')}
    contract['evidence_required'] = manifest.get('evidence', {}).get('required')
    contract['reviews_required'] = manifest.get('reviews', {}).get('required')
    return hashlib.sha256(json.dumps(contract, sort_keys=True).encode('utf-8')).hexdigest()


def graph_digest(plan):
    fields = ('id', 'agent', 'kind', 'priority', 'depends_on', 'base_sha', 'scope', 'boundaries', 'requires', 'workspace', 'candidate_from', 'profiles')
    contract = [{key: node.get(key) for key in fields} for node in sorted(plan['nodes'], key=lambda node: node['id'])]
    return hashlib.sha256(json.dumps(contract, sort_keys=True).encode('utf-8')).hexdigest()


def verify_bindings(plan):
    if plan.get('bindings') and plan.get('graph_sha256') != graph_digest(plan):
        raise ValueError('graph contract changed; reconcile scope/dependencies and rebuild before dispatch')
    for binding in plan.get('bindings', []):
        manifest = load_mapping(Path(binding['manifest']))
        if contract_digest(manifest) != binding['contract_sha256']:
            raise ValueError(f'{binding["package"]}: manifest contract changed; reconcile plan before dispatch')
        problems = check(manifest, Path(binding['repo']), 'delegation')
        if problems:
            raise ValueError(f'{binding["package"]}: ' + '; '.join(problems))


def build_plan(spec, directory):
    if not isinstance(spec.get('repo'), str) or not Path(spec['repo']).is_absolute():
        raise ValueError('spec.repo must be an absolute repository path')
    repo = Path(spec['repo']).resolve()
    packages = spec.get('packages')
    if not isinstance(packages, list) or not packages:
        raise ValueError('packages must be a nonempty list')
    identities = set()
    for package in packages:
        identity = package.get('id')
        if not isinstance(identity, str) or not re.fullmatch(r'[a-zA-Z0-9_-]+', identity) or identity in identities:
            raise ValueError('package IDs must be unique letters/digits/underscores/hyphens')
        identities.add(identity)
    plan = {'version': 1, 'max_parallel': spec.get('max_parallel'), 'runtime': spec.get('runtime'), 'bindings': [], 'nodes': []}
    for package in packages:
        identity = package['id']
        dependencies = string_list(package.get('depends_on'), f'{identity}.depends_on')
        if set(dependencies) - identities:
            raise ValueError(f'{identity}: unknown package dependency')
        path = (directory / package['manifest']).resolve()
        manifest = load_mapping(path)
        problems = check(manifest, repo, 'delegation')
        if problems:
            raise ValueError(f'{identity}: ' + '; '.join(problems))
        manifest_dependencies = string_list(manifest.get('dependencies'), f'{identity}.manifest_dependencies')
        if manifest_dependencies != dependencies:
            raise ValueError(f'{identity}: manifest dependencies do not match package dependencies')
        plan['bindings'].append({'package': identity, 'repo': str(repo), 'manifest': str(path), 'contract_sha256': contract_digest(manifest)})
        writer = manifest['ownership']['writer']
        reviewers = string_list(manifest.get('reviews', {}).get('required'), f'{identity}.reviewers')
        if writer in reviewers or not reviewers:
            raise ValueError(f'{identity}: independent reviewers must be assigned before planning')
        boundaries = string_list(package.get('boundaries'), f'{identity}.boundaries')
        requires = string_list(package.get('requires', ['repository', 'tools']), f'{identity}.requires')

        def node(suffix, agent, kind, depends_on):
            result = {
                'id': f'{identity}::{suffix}', 'agent': agent, 'kind': kind,
                'status': 'pending', 'priority': package.get('priority'),
                'depends_on': depends_on, 'base_sha': package.get('base_sha'),
                'scope': [], 'boundaries': [], 'requires': list(requires),
            }
            if kind != 'writer':
                result['candidate_from'] = f'{identity}::write'
            return result

        implementation = node('write', writer, 'writer', [f'{dependency}::integrate' for dependency in dependencies])
        implementation.update(scope=list(manifest['ownership']['allowed_scope']), boundaries=list(boundaries), workspace=package.get('workspace'))
        plan['nodes'].append(implementation)
        review_ids = []
        for index, reviewer in enumerate(reviewers, 1):
            review = node(f'review-{index}', reviewer, 'review', [implementation['id']])
            plan['nodes'].append(review)
            review_ids.append(review['id'])
        gate = node('accept', 'lead-agent', 'gate', review_ids)
        integration = node('integrate', 'lead-agent', 'integration', [gate['id']])
        integration.update(scope=list(implementation['scope']), boundaries=list(boundaries), workspace=str(repo))
        plan['nodes'].extend([gate, integration])
    plan['graph_sha256'] = graph_digest(plan)
    return plan
