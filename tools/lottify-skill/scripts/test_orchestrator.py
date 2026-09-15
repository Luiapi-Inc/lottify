import copy
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest

from execution_plan import build_plan
from manifest_generator import DEFAULT_SOURCES, generate
from orchestrator import schedule


BASE = 'a' * 40
CANDIDATE = 'b' * 40


def runtime():
    return {
        'providers': {
            'host': {'available': True, 'max_parallel': 4},
            'second': {'available': True, 'max_parallel': 1},
        },
        'profiles': {
            'inherited': {'provider': 'host', 'model': None, 'available': True, 'capabilities': ['repository', 'tools']},
            'review': {'provider': 'second', 'model': 'test-model', 'available': True, 'capabilities': ['repository', 'tools', 'review-tools']},
        },
        'routing': {'default': ['inherited'], 'roles': {}, 'priorities': {}},
    }


def node(identity, **changes):
    value = {
        'id': identity, 'agent': 'backend-agent', 'kind': 'writer', 'status': 'pending',
        'priority': 'functional-critical-path', 'depends_on': [], 'base_sha': BASE,
        'scope': [f'apps/{identity}/**'], 'boundaries': [],
        'requires': ['repository', 'tools'], 'workspace': f'/tmp/lottify-test-{identity}',
    }
    value.update(changes)
    return value


def plan(*nodes, capacity=4):
    return {'version': 1, 'max_parallel': capacity, 'runtime': runtime(), 'nodes': list(nodes)}


def selected(result):
    return [entry['id'] for entry in result['dispatch']]


class SchedulerTest(unittest.TestCase):
    def test_independent_writers_run_in_parallel(self):
        result = schedule(plan(node('member'), node('admin')))
        self.assertEqual(selected(result), ['admin', 'member'])
        self.assertIsNone(result['dispatch'][0]['route']['model'])

    def test_shared_boundary_serializes_even_with_disjoint_files(self):
        result = schedule(plan(node('first', boundaries=['financial-core']), node('second', boundaries=['financial-core'])))
        self.assertEqual(selected(result), ['first'])
        self.assertIn('ownership held', result['waiting']['second'])

    def test_overlapping_scopes_and_same_workspace_are_serialized(self):
        for changes in ({'scope': ['apps/first/nested/file.ts']}, {'workspace': '/tmp/lottify-test-first'}):
            with self.subTest(changes=changes):
                result = schedule(plan(node('first'), node('second', **changes)))
                self.assertEqual(selected(result), ['first'])

    def test_unsupported_globs_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'invalid scope'):
            schedule(plan(node('first', scope=['apps/*/file.ts'])))

    def test_prerequisite_inherits_critical_priority(self):
        result = schedule(plan(
            node('foundation', priority='non-critical-ux'),
            node('financial', priority='integrity-security-compliance', depends_on=['foundation']),
            node('ordinary', priority='recovery-operations'), capacity=1,
        ))
        self.assertEqual(selected(result), ['foundation'])
        self.assertEqual(result['dispatch'][0]['effective_priority'], 'integrity-security-compliance')
        self.assertIn('foundation', result['waiting']['financial'])

    def test_failed_dependency_does_not_block_independent_work(self):
        result = schedule(plan(node('failed', status='failed'), node('child', depends_on=['failed']), node('independent')))
        self.assertEqual(selected(result), ['independent'])
        self.assertIn('failed (failed)', result['waiting']['child'])

    def test_cycles_unknown_dependencies_and_duplicate_ids_are_rejected(self):
        for nodes in ((node('a', depends_on=['b']), node('b', depends_on=['a'])), (node('a', depends_on=['missing']),), (node('a'), node('a'))):
            with self.subTest(nodes=nodes), self.assertRaises(ValueError):
                schedule(plan(*nodes))

    def test_running_work_retains_ownership_and_provider_capacity(self):
        running = node('running', status='running', boundaries=['schema'], assigned_route={'profile': 'inherited', 'provider': 'host', 'model': None})
        value = plan(running, node('blocked', boundaries=['schema']), node('independent'))
        value['runtime']['providers']['host']['max_parallel'] = 1
        result = schedule(value)
        self.assertEqual(selected(result), [])
        self.assertIn('ownership', result['waiting']['blocked'])
        self.assertIn('capacity', result['waiting']['independent'])

    def test_active_ownership_conflict_is_an_error(self):
        assigned = {'profile': 'inherited', 'provider': 'host', 'model': None}
        with self.assertRaisesRegex(ValueError, 'active ownership conflict'):
            schedule(plan(node('a', status='running', boundaries=['schema'], assigned_route=assigned), node('b', status='running', boundaries=['schema'], assigned_route=assigned)))

    def test_explicit_fallback_preserves_capability_requirements(self):
        value = plan(node('review', requires=['repository', 'review-tools']))
        value['runtime']['routing']['roles']['backend-agent'] = ['inherited', 'review']
        result = schedule(value)
        self.assertEqual(result['dispatch'][0]['route']['provider'], 'second')
        self.assertIn('capabilities', result['dispatch'][0]['route']['fallback_reasons'][0])
        value['runtime']['profiles']['review']['available'] = False
        self.assertEqual(selected(schedule(value)), [])

    def test_no_implicit_fallback_for_explicit_route(self):
        value = plan(node('restricted', profiles=['review']))
        value['runtime']['providers']['second']['available'] = False
        self.assertEqual(selected(schedule(value)), [])

    def test_profile_selection_precedence_and_unknown_profile(self):
        value = plan(node('first'))
        value['runtime']['routing']['priorities']['functional-critical-path'] = ['review']
        self.assertEqual(schedule(value)['dispatch'][0]['route']['profile'], 'review')
        value['runtime']['routing']['roles']['backend-agent'] = ['inherited']
        self.assertEqual(schedule(value)['dispatch'][0]['route']['profile'], 'inherited')
        value['nodes'][0]['profiles'] = ['typo']
        with self.assertRaisesRegex(ValueError, 'unknown profile'):
            schedule(value)

    def test_review_requires_exact_candidate_and_all_reviews_gate_acceptance(self):
        producer = node('write', status='succeeded', candidate_sha=CANDIDATE, result_ref='writer report')
        first = node('first', kind='review', scope=[], depends_on=['write'], candidate_from='write', status='succeeded', candidate_sha=CANDIDATE, result_ref='review report')
        second = node('second', kind='review', scope=[], depends_on=['write'], candidate_from='write')
        gate = node('gate', kind='gate', scope=[], depends_on=['first', 'second'], candidate_from='write')
        value = plan(producer, first, second, gate)
        self.assertEqual(selected(schedule(value)), ['second'])
        value['nodes'][1]['candidate_sha'] = BASE
        with self.assertRaisesRegex(ValueError, 'stale candidate'):
            schedule(value)

    def test_integration_queue_is_serial_even_for_disjoint_scopes(self):
        result = schedule(plan(node('first', kind='integration'), node('second', kind='integration')))
        self.assertEqual(selected(result), ['first'])

    def test_schedule_is_deterministic_and_does_not_mutate_state(self):
        value = plan(node('second'), node('first'))
        original = copy.deepcopy(value)
        expected = schedule(value)
        self.assertEqual(value, original)
        value['nodes'].reverse()
        self.assertEqual(schedule(value), expected)


class ManifestGraphTest(unittest.TestCase):
    def test_builds_full_graph_and_detects_source_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            for path in (*DEFAULT_SOURCES.values(), 'checkpoint.md', 'domain.md'):
                source = repo / path
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_text('approved source', encoding='utf-8')
            packages = []
            for identity, dependencies in (('core', []), ('consumer', ['core'])):
                manifest = generate('wallet API', [], repo, ['domain-ticket=domain.md'], 'checkpoint.md', [f'apps/{identity}/**'], dependencies=dependencies)
                manifest['source_alignment'] = {'confirmed_by_lead': True, 'decision_ids': ['Ticket 04'], 'adr_disposition': 'not-applicable'}
                manifest['ownership']['writer'] = 'backend-agent'
                (repo / f'{identity}.json').write_text(json.dumps(manifest), encoding='utf-8')
                packages.append({'id': identity, 'manifest': f'{identity}.json', 'depends_on': dependencies, 'base_sha': BASE, 'workspace': str(repo / identity), 'boundaries': ['wallet-ledger'], 'priority': 'integrity-security-compliance'})
            compiled = build_plan({'repo': str(repo), 'packages': packages, 'runtime': runtime(), 'max_parallel': 3}, repo)
            self.assertEqual(selected(schedule(compiled)), ['core::write'])
            consumer = next(item for item in compiled['nodes'] if item['id'] == 'consumer::write')
            self.assertEqual(consumer['depends_on'], ['core::integrate'])
            core_gate = next(item for item in compiled['nodes'] if item['id'] == 'core::accept')
            self.assertEqual(len(core_gate['depends_on']), 3)
            core_writer = next(item for item in compiled['nodes'] if item['id'] == 'core::write')
            core_writer.update(status='succeeded', candidate_sha=CANDIDATE, result_ref='writer report')
            review_batch = schedule(compiled)['dispatch']
            self.assertEqual(len(review_batch), 3)
            for item in compiled['nodes']:
                if item['id'] in {entry['id'] for entry in review_batch}:
                    item.update(status='succeeded', candidate_sha=CANDIDATE, result_ref='review report')
            self.assertEqual(selected(schedule(compiled)), ['core::accept'])
            core_gate.update(status='succeeded', candidate_sha=CANDIDATE, result_ref='acceptance report')
            self.assertEqual(selected(schedule(compiled)), ['core::integrate'])
            integration = next(item for item in compiled['nodes'] if item['id'] == 'core::integrate')
            integration.update(status='succeeded', candidate_sha='c' * 40, result_ref='integration report')
            result = schedule(compiled)
            self.assertEqual(selected(result), ['consumer::write'])
            self.assertEqual(result['dispatch'][0]['dependency_results']['core::integrate']['candidate_sha'], 'c' * 40)

            spec_path = repo / 'input.json'
            spec_path.write_text(json.dumps({'repo': str(repo), 'packages': packages, 'runtime': runtime(), 'max_parallel': 3}), encoding='utf-8')
            cli = str(Path(__file__).with_name('orchestrator.py'))
            subprocess.run([sys.executable, cli, 'build', str(spec_path), '--output', str(repo / 'plan.json')], check=True, capture_output=True, text=True)
            cli_result = subprocess.run([sys.executable, cli, 'schedule', str(repo / 'plan.json')], check=True, capture_output=True, text=True)
            self.assertEqual(selected(json.loads(cli_result.stdout)), ['core::write'])
            changed = copy.deepcopy(compiled)
            changed['nodes'][0]['scope'] = ['apps/other/**']
            with self.assertRaisesRegex(ValueError, 'graph contract changed'):
                schedule(changed)
            (repo / 'domain.md').write_text('changed source', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'source changed'):
                schedule(compiled)


if __name__ == '__main__':
    unittest.main()
