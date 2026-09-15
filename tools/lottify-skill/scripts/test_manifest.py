import tempfile
import unittest
from pathlib import Path

from manifest_generator import (
    DEFAULT_SOURCES,
    PRODUCTION_RELEASE_EVIDENCE,
    PRODUCTION_RELEASE_REQUIRED_REVIEWERS,
    PRODUCTION_RELEASE_SUBSKILLS,
    generate,
)
from source_alignment_check import check


class ManifestTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.repo = Path(self.directory.name)
        for path in DEFAULT_SOURCES.values():
            source = self.repo / path
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text('approved', encoding='utf-8')
        self.checkpoint = 'docs/implementation/current.md'
        self.domain = 'docs/domain/withdrawal.md'
        for path in (self.checkpoint, self.domain):
            source = self.repo / path
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text('current', encoding='utf-8')

    def tearDown(self):
        self.directory.cleanup()

    def manifest(self, files=()):
        return generate(
            'withdrawal API approval', files, self.repo,
            [f'domain-ticket={self.domain}'], self.checkpoint,
            ['apps/api/src/withdrawal/**'],
        )

    def test_routes_financial_and_api_without_granting_writer(self):
        manifest = self.manifest()
        self.assertIn('financial-integrity-agent', manifest['routing']['agents'])
        self.assertIn('api-contract-agent', manifest['routing']['agents'])
        self.assertIsNone(manifest['ownership']['writer'])
        self.assertFalse(manifest['source_alignment']['confirmed_by_lead'])
        self.assertTrue(check(manifest, self.repo, 'delegation'))

    def test_generated_manifest_has_versioned_contract_and_resolved_skill(self):
        manifest = self.manifest()
        self.assertEqual(manifest['contract'], {
            'name': 'lottify-agent-execution-manifest',
            'version': 2,
        })
        self.assertEqual(manifest['skills']['resolved'][0]['canonical'], 'lottify')
        self.assertEqual(manifest['execution']['state'], 'SOURCE_ALIGNMENT')

    def test_delegation_rejects_stale_skill_resolution(self):
        manifest = self.manifest()
        manifest['source_alignment'] = {
            'confirmed_by_lead': True,
            'decision_ids': ['Ticket 10'],
            'adr_disposition': 'not-applicable',
        }
        manifest['ownership']['writer'] = 'backend-agent'
        manifest['skills']['resolved'][0]['canonical'] = 'stale-skill'
        self.assertTrue(any(
            'skill resolution missing or stale' in problem
            for problem in check(manifest, self.repo, 'delegation')
        ))

    def test_source_drift_and_scope_block_delegation(self):
        manifest = self.manifest(['apps/api/src/withdrawal/handler.ts', 'apps/admin-web/page.tsx'])
        manifest['source_alignment'] = {'confirmed_by_lead': True, 'decision_ids': ['Ticket 04'], 'adr_disposition': 'not-applicable'}
        manifest['ownership']['writer'] = 'backend-agent'
        problems = check(manifest, self.repo, 'delegation')
        self.assertTrue(any('outside allowed scope' in problem for problem in problems))
        (self.repo / self.domain).write_text('changed', encoding='utf-8')
        problems = check(manifest, self.repo, 'delegation')
        self.assertTrue(any('source changed' in problem for problem in problems))

    def test_acceptance_requires_auditable_coverage(self):
        manifest = self.manifest(['apps/api/src/withdrawal/handler.ts'])
        manifest['source_alignment'] = {'confirmed_by_lead': True, 'decision_ids': ['Ticket 04'], 'adr_disposition': 'not-applicable'}
        manifest['ownership']['writer'] = 'backend-agent'
        candidate = 'a' * 40
        manifest['acceptance'] = {'status': 'verified', 'candidate_sha': candidate, 'gaps': []}
        manifest['reviews']['records'] = [
            {'agent': agent, 'result': 'passed', 'candidate_sha': candidate, 'report': 'review artifact'}
            for agent in manifest['reviews']['required']
        ]
        manifest['evidence']['records'] = [{
            'requirement_id': 'Ticket 04', 'acceptance_id': 'AC-1', 'scenario_id': 'S-1',
            'level': 'integration', 'environment': 'CI/PostgreSQL', 'build_id': candidate,
            'candidate_sha': candidate,
            'result': 'passed', 'executed_at': '2026-09-14T12:00:00Z',
            'artifact': 'CI run 1', 'implementation': ['apps/api/src/withdrawal/handler.ts'],
            'actual_result': 'one finalization', 'covers': manifest['evidence']['required'],
        }]
        self.assertEqual(check(manifest, self.repo, 'acceptance'), [])
        manifest['reviews']['records'].pop()
        self.assertTrue(any('required reviewer result missing' in problem for problem in check(manifest, self.repo, 'acceptance')))
        manifest['reviews']['records'] = [
            {'agent': agent, 'result': 'passed', 'candidate_sha': candidate, 'report': 'review artifact'}
            for agent in manifest['reviews']['required']
        ]
        manifest['evidence']['records'][0]['covers'] = []
        self.assertTrue(any('required evidence not covered' in problem for problem in check(manifest, self.repo, 'acceptance')))

    def test_acceptance_rejects_review_for_different_candidate(self):
        manifest = self.manifest(['apps/api/src/withdrawal/handler.ts'])
        manifest['source_alignment'] = {'confirmed_by_lead': True, 'decision_ids': ['Ticket 04'], 'adr_disposition': 'not-applicable'}
        manifest['ownership']['writer'] = 'backend-agent'
        candidate = 'a' * 40
        manifest['acceptance'] = {'status': 'verified', 'candidate_sha': candidate, 'gaps': []}
        manifest['reviews']['records'] = [
            {'agent': agent, 'result': 'passed', 'candidate_sha': 'b' * 40, 'report': 'stale review artifact'}
            for agent in manifest['reviews']['required']
        ]
        manifest['evidence']['records'] = [{
            'requirement_id': 'Ticket 04', 'acceptance_id': 'AC-1', 'scenario_id': 'S-1',
            'level': 'integration', 'environment': 'CI/PostgreSQL', 'build_id': candidate,
            'candidate_sha': candidate,
            'result': 'passed', 'executed_at': '2026-09-14T12:00:00Z',
            'artifact': 'CI run 1', 'implementation': ['apps/api/src/withdrawal/handler.ts'],
            'actual_result': 'one finalization', 'covers': manifest['evidence']['required'],
        }]
        problems = check(manifest, self.repo, 'acceptance')
        self.assertTrue(any('required reviewer result missing' in problem for problem in problems))

    def test_acceptance_rejects_evidence_for_different_candidate(self):
        manifest = self.manifest(['apps/api/src/withdrawal/handler.ts'])
        manifest['source_alignment'] = {'confirmed_by_lead': True, 'decision_ids': ['Ticket 04'], 'adr_disposition': 'not-applicable'}
        manifest['ownership']['writer'] = 'backend-agent'
        candidate = 'a' * 40
        manifest['acceptance'] = {'status': 'verified', 'candidate_sha': candidate, 'gaps': []}
        manifest['reviews']['records'] = [
            {'agent': agent, 'result': 'passed', 'candidate_sha': candidate, 'report': 'review artifact'}
            for agent in manifest['reviews']['required']
        ]
        manifest['evidence']['records'] = [{
            'requirement_id': 'Ticket 04', 'acceptance_id': 'AC-1', 'scenario_id': 'S-1',
            'level': 'integration', 'environment': 'CI/PostgreSQL', 'build_id': candidate,
            'candidate_sha': 'b' * 40, 'result': 'passed', 'executed_at': '2026-09-14T12:00:00Z',
            'artifact': 'CI run 1', 'implementation': ['apps/api/src/withdrawal/handler.ts'],
            'actual_result': 'one finalization', 'covers': manifest['evidence']['required'],
        }]
        problems = check(manifest, self.repo, 'acceptance')
        self.assertTrue(any('different candidate' in problem for problem in problems))

    def test_migration_requires_rollout_compatibility_review(self):
        manifest = generate(
            'add database migration', [], self.repo,
            [f'domain-ticket={self.domain}'], self.checkpoint,
            ['packages/database/**'],
        )
        self.assertIn('database-migration-review', manifest['routing']['subskills'])
        self.assertIn('release-gate-agent', manifest['routing']['agents'])
        self.assertIn('old/new application compatibility result', manifest['evidence']['required'])

    def test_production_release_requires_ticket_16_release_matrix(self):
        release_source = self.repo / '.scratch/lottify-v1-specification/issues/13-non-functional-targets-and-release-gates.md'
        release_source.parent.mkdir(parents=True, exist_ok=True)
        release_source.write_text('approved', encoding='utf-8')
        manifest = generate(
            'production deploy release candidate', [], self.repo,
            [f'domain-ticket={self.domain}'], self.checkpoint,
            ['deploy/**'],
        )
        self.assertTrue(manifest['risk_assessment']['production_release'])
        self.assertIn('release-gate', {source['kind'] for source in manifest['task']['source_of_truth']})
        for subskill in PRODUCTION_RELEASE_SUBSKILLS:
            self.assertIn(subskill, manifest['routing']['subskills'])
        for evidence in PRODUCTION_RELEASE_EVIDENCE:
            self.assertIn(evidence, manifest['evidence']['required'])
        for reviewer in PRODUCTION_RELEASE_REQUIRED_REVIEWERS:
            self.assertIn(reviewer, manifest['reviews']['required'])

    def test_release_checker_rejects_manifest_that_weakens_mandatory_matrix(self):
        release_source = self.repo / '.scratch/lottify-v1-specification/issues/13-non-functional-targets-and-release-gates.md'
        release_source.parent.mkdir(parents=True, exist_ok=True)
        release_source.write_text('approved', encoding='utf-8')
        manifest = generate(
            'production deploy release candidate', [], self.repo,
            [f'domain-ticket={self.domain}'], self.checkpoint,
            ['deploy/**'],
        )
        manifest['source_alignment'] = {'confirmed_by_lead': True, 'decision_ids': ['Ticket 13', 'Ticket 16'], 'adr_disposition': 'not-applicable'}
        manifest['ownership']['writer'] = 'qa-agent'
        manifest['evidence']['required'].remove(PRODUCTION_RELEASE_EVIDENCE[0])
        manifest['routing']['subskills'].remove(PRODUCTION_RELEASE_SUBSKILLS[0])
        manifest['reviews']['required'].remove(PRODUCTION_RELEASE_REQUIRED_REVIEWERS[0])
        problems = check(manifest, self.repo, 'delegation')
        self.assertTrue(any('mandatory evidence requirement' in problem for problem in problems))
        self.assertTrue(any('required subskill' in problem for problem in problems))
        self.assertTrue(any('required reviewer' in problem for problem in problems))


if __name__ == '__main__':
    unittest.main()
