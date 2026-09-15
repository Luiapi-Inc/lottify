#!/usr/bin/env python3
"""Build and schedule a Lottify agent DAG without dispatching agents."""

import argparse
from collections import Counter
import json
from pathlib import Path, PurePosixPath
import re

import yaml

from model_router import choose_route, positive_integer, string_list, validate_candidates, validate_runtime
from execution_plan import build_plan, load_mapping, verify_bindings


PRIORITIES = (
    'integrity-security-compliance', 'functional-critical-path',
    'recovery-operations', 'performance', 'non-critical-ux',
)
STATES = {'pending', 'running', 'succeeded', 'failed', 'blocked', 'cancelled'}
WRITING_KINDS = {'writer', 'integration'}


def sha(value):
    return isinstance(value, str) and bool(re.fullmatch(r'(?:[a-f0-9]{40}|[a-f0-9]{64})', value))


def scope_parts(scope):
    subtree = scope.endswith('/**')
    path = scope[:-3] if subtree else scope
    if not path or path.startswith('/') or any(part in {'', '.', '..'} for part in path.split('/')) or any(character in path for character in '*?[]\\'):
        raise ValueError(f'invalid scope {scope!r}: use an exact relative path or directory/**')
    return PurePosixPath(path).parts, subtree


def scopes_overlap(first, second):
    first_parts, first_tree = scope_parts(first)
    second_parts, second_tree = scope_parts(second)
    return first_parts == second_parts or (first_tree and second_parts[:len(first_parts)] == first_parts) or (second_tree and first_parts[:len(second_parts)] == second_parts)


def conflicts(first, second):
    if first['kind'] not in WRITING_KINDS or second['kind'] not in WRITING_KINDS:
        return False
    if first['kind'] == second['kind'] == 'integration':
        return True
    if Path(first['workspace']).resolve() == Path(second['workspace']).resolve():
        return True
    if set(first['boundaries']) & set(second['boundaries']):
        return True
    return any(scopes_overlap(left, right) for left in first['scope'] for right in second['scope'])


def validate_plan(plan):
    if not isinstance(plan, dict) or type(plan.get('version')) is not int or plan['version'] != 1:
        raise ValueError('plan.version must be 1')
    positive_integer(plan.get('max_parallel'), 'max_parallel')
    validate_runtime(plan.get('runtime'))
    if set(plan['runtime']['routing'].get('priorities', {})) - set(PRIORITIES):
        raise ValueError('routing.priorities contains an unknown Ticket 19 priority')
    if not isinstance(plan.get('nodes'), list) or not plan['nodes']:
        raise ValueError('nodes must be a nonempty list')
    nodes = {}
    for node in plan['nodes']:
        if not isinstance(node, dict) or not isinstance(node.get('id'), str) or not node['id']:
            raise ValueError('each node needs a nonempty id')
        identity = node['id']
        if identity in nodes:
            raise ValueError(f'duplicate node id: {identity}')
        nodes[identity] = node
        if not isinstance(node.get('agent'), str) or not node['agent']:
            raise ValueError(f'{identity}: agent is required')
        if node.get('kind') not in WRITING_KINDS | {'review', 'gate'}:
            raise ValueError(f'{identity}: unknown kind')
        if node.get('status') not in STATES or node.get('priority') not in PRIORITIES:
            raise ValueError(f'{identity}: invalid status or priority')
        if not sha(node.get('base_sha')):
            raise ValueError(f'{identity}: immutable base_sha is required')
        for field in ('depends_on', 'scope', 'boundaries', 'requires'):
            string_list(node.get(field), f'{identity}.{field}')
        for scope in node['scope']:
            scope_parts(scope)
        if node['kind'] in WRITING_KINDS:
            if not node['scope'] or not sha(node.get('base_sha')):
                raise ValueError(f'{identity}: writing requires scope and immutable base_sha')
            if not isinstance(node.get('workspace'), str) or not Path(node['workspace']).is_absolute():
                raise ValueError(f'{identity}: writing requires an absolute isolated workspace')
        elif node['scope'] or node['boundaries']:
            raise ValueError(f'{identity}: read-only nodes cannot claim write resources')
        if 'profiles' in node:
            validate_candidates(node['profiles'], plan['runtime'], f'{identity}.profiles')
        if node['status'] == 'succeeded':
            if not isinstance(node.get('result_ref'), str) or not node['result_ref'].strip():
                raise ValueError(f'{identity}: succeeded requires durable result_ref')
            if not sha(node.get('candidate_sha')):
                raise ValueError(f'{identity}: succeeded requires immutable candidate_sha')
        if node['status'] == 'running':
            assigned = node.get('assigned_route', {})
            profile = plan['runtime']['profiles'].get(assigned.get('profile'))
            if not profile or any(assigned.get(field) != profile[field] for field in ('provider', 'model')):
                raise ValueError(f'{identity}: running route missing or changed; retain its actual provider/model')

    children = {identity: [] for identity in nodes}
    counts = {}
    for identity, node in nodes.items():
        counts[identity] = len(node['depends_on'])
        for dependency in node['depends_on']:
            if dependency not in nodes:
                raise ValueError(f'{identity}: unknown dependency {dependency}')
            children[dependency].append(identity)
            if node['status'] in {'running', 'succeeded'} and nodes[dependency]['status'] != 'succeeded':
                raise ValueError(f'{identity}: started before dependency {dependency} succeeded')
        candidate_from = node.get('candidate_from')
        if candidate_from is not None:
            if candidate_from not in nodes or nodes[candidate_from]['kind'] != 'writer':
                raise ValueError(f'{identity}: candidate_from must identify a Writer')
            if node['status'] in {'running', 'succeeded'} and node['kind'] != 'integration':
                if node.get('candidate_sha') != nodes[candidate_from].get('candidate_sha'):
                    raise ValueError(f'{identity}: stale candidate SHA')

    ready = sorted(identity for identity, count in counts.items() if count == 0)
    order = []
    while ready:
        identity = ready.pop(0)
        order.append(identity)
        for child in children[identity]:
            counts[child] -= 1
            if counts[child] == 0:
                ready.append(child)
        ready.sort()
    if len(order) != len(nodes):
        raise ValueError('dependency cycle: ' + ', '.join(sorted(identity for identity, count in counts.items() if count)))
    ancestors = {}
    for identity in order:
        ancestors[identity] = set(nodes[identity]['depends_on'])
        for dependency in nodes[identity]['depends_on']:
            ancestors[identity].update(ancestors[dependency])
        candidate_from = nodes[identity].get('candidate_from')
        if candidate_from is not None and candidate_from not in ancestors[identity]:
            raise ValueError(f'{identity}: candidate producer must be a dependency ancestor')
    return nodes, children, order


def schedule(plan):
    nodes, children, order = validate_plan(plan)
    verify_bindings(plan)
    active = [node for node in nodes.values() if node['status'] == 'running']
    for index, first in enumerate(active):
        for second in active[index + 1:]:
            if conflicts(first, second):
                raise ValueError(f'active ownership conflict: {first["id"]}, {second["id"]}')
    if len(active) > plan['max_parallel']:
        raise ValueError('running nodes exceed max_parallel')
    effective = {identity: PRIORITIES.index(node['priority']) for identity, node in nodes.items()}
    depth = dict.fromkeys(nodes, 0)
    for identity in reversed(order):
        for child in children[identity]:
            if nodes[child]['status'] not in {'succeeded', 'cancelled'}:
                effective[identity] = min(effective[identity], effective[child])
                depth[identity] = max(depth[identity], depth[child] + 1)
    occupied = Counter(node['assigned_route']['provider'] for node in active)
    waiting = {}
    dispatch = []
    pending = sorted((node for node in nodes.values() if node['status'] == 'pending'), key=lambda node: (effective[node['id']], -depth[node['id']], node['id']))
    for node in pending:
        identity = node['id']
        incomplete = [f'{dependency} ({nodes[dependency]["status"]})' for dependency in node['depends_on'] if nodes[dependency]['status'] != 'succeeded']
        if incomplete:
            waiting[identity] = 'dependencies: ' + ', '.join(incomplete)
            continue
        conflict = next((other['id'] for other in active if conflicts(node, other)), None)
        if conflict:
            waiting[identity] = f'ownership held by {conflict}'
            continue
        if len(active) >= plan['max_parallel']:
            waiting[identity] = 'global capacity exhausted'
            continue
        route, reason = choose_route(node, plan['runtime'], occupied)
        if route is None:
            waiting[identity] = reason
            continue
        candidate_from = node.get('candidate_from')
        dispatch.append({
            'id': identity, 'agent': node['agent'], 'kind': node['kind'],
            'route': route, 'effective_priority': PRIORITIES[effective[identity]],
            'candidate_sha': nodes[candidate_from]['candidate_sha'] if candidate_from else node['base_sha'],
            'dependency_results': {dependency: {'candidate_sha': nodes[dependency]['candidate_sha'], 'result_ref': nodes[dependency]['result_ref']} for dependency in node['depends_on']},
        })
        occupied[route['provider']] += 1
        active.append(node)
    return {
        'dispatch': dispatch, 'waiting': waiting, 'topological_order': order,
        'running': [node['id'] for node in nodes.values() if node['status'] == 'running'],
        'halted': {identity: node['status'] for identity, node in nodes.items() if node['status'] in {'failed', 'blocked', 'cancelled'}},
        'all_succeeded': all(node['status'] == 'succeeded' for node in nodes.values()),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('build', 'schedule'))
    parser.add_argument('input', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--format', choices=('json', 'yaml'), default='json')
    args = parser.parse_args()
    try:
        if args.command == 'build':
            result = build_plan(load_mapping(args.input), args.input.resolve().parent)
            validate_plan(result)
        else:
            result = schedule(load_mapping(args.input))
    except (OSError, ValueError, TypeError, KeyError, yaml.YAMLError) as error:
        parser.error(str(error))
    rendered = json.dumps(result, indent=2) if args.format == 'json' else yaml.safe_dump(result, sort_keys=False)
    if args.output:
        args.output.write_text(rendered + '\n', encoding='utf-8')
    else:
        print(rendered)


if __name__ == '__main__':
    main()
