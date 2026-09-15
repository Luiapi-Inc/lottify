import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from execution_plan import build_plan
from manifest_generator import DEFAULT_SOURCES, generate
from orchestrator import schedule
from source_alignment_check import check


def runtime():
    return {
        'providers': {'host': {'available': True, 'max_parallel': 4}},
        'profiles': {
            'inherited': {
                'provider': 'host', 'model': None, 'available': True,
                'capabilities': ['repository', 'tools'],
            },
        },
        'routing': {'default': ['inherited'], 'roles': {}, 'priorities': {}},
    }


class ContractPipelineTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.repo = Path(self.directory.name)
        self.addCleanup(self.directory.cleanup)
        for path in (*DEFAULT_SOURCES.values(), 'checkpoint.md', 'domain.md'):
            target = self.repo / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('approved source', encoding='utf-8')
        release = self.repo / '.scratch/lottify-v1-specification/issues/13-non-functional-targets-and-release-gates.md'
        release.parent.mkdir(parents=True, exist_ok=True)
        release.write_text('approved release source', encoding='utf-8')
        subprocess.run(['git', 'init', '-q', str(self.repo)], check=True)
        subprocess.run(['git', '-C', str(self.repo), 'add', '-A'], check=True)
        subprocess.run([
            'git', '-C', str(self.repo), '-c', 'user.name=Lottify Tests',
            '-c', 'user.email=tests@lottify.local', 'commit', '-qm', 'fixture',
        ], check=True)
        self.candidate = subprocess.check_output(
            ['git', '-C', str(self.repo), 'rev-parse', 'HEAD'], text=True,
        ).strip()

    def production_manifest(self):
        manifest = generate(
            'production deploy release candidate', [], self.repo,
            ['domain-ticket=domain.md'], 'checkpoint.md', ['deploy/**'],
        )
        manifest['source_alignment'] = {
            'confirmed_by_lead': True,
            'decision_ids': ['Ticket 13', 'Ticket 16'],
            'adr_disposition': 'not-applicable',
        }
        manifest['ownership']['writer'] = 'qa-agent'
        return manifest

    def test_manifest_to_schedule_to_acceptance_uses_one_candidate(self):
        manifest = self.production_manifest()
        self.assertEqual(check(manifest, self.repo, 'delegation'), [])

        manifest_path = self.repo / 'manifest.json'
        manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
        plan = build_plan({
            'repo': str(self.repo),
            'packages': [{
                'id': 'release',
                'manifest': 'manifest.json',
                'depends_on': [],
                'base_sha': 'a' * 40,
                'workspace': str(self.repo / 'writer'),
                'boundaries': ['release'],
                'priority': 'recovery-operations',
            }],
            'runtime': runtime(),
            'max_parallel': 1,
        }, self.repo)
        self.assertEqual([item['id'] for item in schedule(plan)['dispatch']], ['release::write'])

        acceptance = json.loads(json.dumps(manifest))
        acceptance['acceptance'] = {
            'status': 'verified', 'candidate_sha': self.candidate,
            'level': 'production-go', 'gaps': [],
        }
        acceptance['evidence']['records'] = [{
            'requirement_id': 'Ticket 16', 'acceptance_id': 'AC-production',
            'scenario_id': 'production-release', 'level': 'integration',
            'environment': 'CI', 'build_id': 'build-1',
            'candidate_sha': self.candidate, 'result': 'passed',
            'executed_at': '2026-09-15T00:00:00Z', 'artifact': 'ci://run/1',
            'implementation': ['deploy/release-plan.yaml'],
            'actual_result': 'all mandatory release evidence passed',
            'covers': list(acceptance['evidence']['required']),
        }]
        acceptance['reviews']['records'] = [
            {'agent': agent, 'result': 'passed', 'candidate_sha': self.candidate, 'report': f'report://{agent}'}
            for agent in acceptance['reviews']['required']
        ]
        self.assertEqual(check(acceptance, self.repo, 'acceptance'), [])

        acceptance['evidence']['records'][0]['candidate_sha'] = 'c' * 40
        problems = check(acceptance, self.repo, 'acceptance')
        self.assertTrue(any('different candidate' in problem for problem in problems))


if __name__ == '__main__':
    unittest.main()
