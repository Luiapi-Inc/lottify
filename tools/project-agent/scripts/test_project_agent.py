import unittest
from pathlib import Path

from next_action import resolve_next_action
from project_profile import load_profile
from runtime_skill_router import load_config, route_skills


ROOT = Path(__file__).resolve().parents[3]
PROFILE = ROOT / 'tools' / 'lottify-skill' / 'project-profile.yaml'
SKILL_CONFIG = ROOT / 'tools' / 'project-agent' / 'skills' / 'runtime-skill-packs.yaml'


class ProjectAgentTest(unittest.TestCase):
    def setUp(self):
        self.profile = load_profile(PROFILE)
        self.skills = load_config(SKILL_CONFIG)

    def test_runtime_router_combines_role_and_action_skills(self):
        result = route_skills(
            'implement withdrawal fix', ['backend-agent'], self.skills,
            explicit_actions=['implementation'],
        )
        self.assertEqual(result['skills'], ['tdd', 'code-review', 'implement-spec'])

    def test_runtime_inventory_filters_unavailable_skills(self):
        result = route_skills(
            'implement withdrawal fix', ['backend-agent'], self.skills,
            explicit_actions=['implementation'], available_skills=['tdd'],
        )
        self.assertEqual(result['skills'], ['tdd'])
        self.assertEqual(result['unavailable_skills'], ['code-review', 'implement-spec'])

    def test_thai_next_action_intent_routes_advisory_skill(self):
        result = route_skills('ควรทำอะไรต่อ', ['lead-agent'], self.skills)
        self.assertIn('advice', result['action_types'])
        self.assertIn('ask-matt', result['skills'])
        self.assertIn('codebase-design', result['skills'])

    def test_specification_skills_require_change_request(self):
        blocked = route_skills(
            'create specification', ['lead-agent'], self.skills,
            explicit_actions=['specification'], change_request=False,
        )
        self.assertNotIn('to-spec', blocked['skills'])
        self.assertNotIn('to-tickets', blocked['skills'])
        self.assertEqual(blocked['guarded_skills_skipped'], ['to-spec', 'to-tickets'])

        allowed = route_skills(
            'Change Request create specification', ['lead-agent'], self.skills,
            explicit_actions=['specification'], change_request=True,
        )
        self.assertIn('to-spec', allowed['skills'])
        self.assertIn('to-tickets', allowed['skills'])

    def test_next_action_picks_highest_priority_executable_action(self):
        state = {
            'version': 1,
            'objective': 'close acceptance gaps',
            'current_state': 'implementation returned',
            'actions': [
                {
                    'id': 'ux', 'title': 'polish admin spacing', 'status': 'pending',
                    'priority': 'non-critical-ux', 'owner': 'frontend-agent',
                    'depends_on': [], 'blockers': [], 'gaps': ['visual polish'],
                    'project_subskills': ['frontend-accessibility-review'],
                    'evidence_required': ['visual result'], 'action_types': ['implementation'],
                    'expected_result': 'approved polish',
                },
                {
                    'id': 'financial', 'title': 'collect withdrawal concurrency evidence', 'status': 'pending',
                    'priority': 'integrity-security-compliance', 'owner': 'qa-agent',
                    'depends_on': [], 'blockers': [], 'gaps': ['evidence missing'],
                    'project_subskills': ['payment-ledger-review'],
                    'evidence_required': ['candidate-bound evidence'], 'action_types': ['testing'],
                    'expected_result': 'deterministic evidence',
                },
            ],
        }
        result = resolve_next_action(state, self.profile, self.skills)
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(result['recommended_action']['id'], 'financial')
        self.assertEqual(result['recommended_action']['owner'], 'qa-agent')
        self.assertIn('playwright', result['recommended_action']['runtime_skills'])
        self.assertIn('tdd', result['recommended_action']['runtime_skills'])

    def test_next_action_reports_runtime_skill_gaps(self):
        state = {
            'version': 1,
            'objective': 'collect test evidence',
            'current_state': 'QA is ready',
            'actions': [
                {
                    'id': 'qa', 'title': 'test browser workflow', 'status': 'pending',
                    'priority': 'functional-critical-path', 'owner': 'qa-agent',
                    'depends_on': [], 'blockers': [], 'gaps': ['E2E evidence missing'],
                    'project_subskills': ['e2e-playwright-review'],
                    'evidence_required': ['E2E result'], 'action_types': ['testing'],
                    'expected_result': 'candidate-bound E2E result',
                },
            ],
        }
        result = resolve_next_action(
            state, self.profile, self.skills,
            available_skills=['diagnosing-bugs', 'code-review', 'tdd'],
        )
        action = result['recommended_action']
        self.assertNotIn('playwright', action['runtime_skills'])
        self.assertIn('playwright', action['unavailable_runtime_skills'])
        self.assertIn('tdd', action['runtime_skills'])

    def test_next_action_continues_active_work(self):
        state = {
            'version': 1,
            'objective': 'continue current delivery',
            'current_state': 'writer running',
            'actions': [
                {
                    'id': 'active', 'title': 'implement API contract', 'status': 'running',
                    'priority': 'functional-critical-path', 'owner': 'backend-agent',
                    'depends_on': [], 'blockers': [], 'gaps': ['implementation incomplete'],
                    'project_subskills': ['api-contract-review'],
                    'evidence_required': ['contract result'], 'action_types': ['implementation'],
                    'expected_result': 'candidate returned',
                },
            ],
        }
        result = resolve_next_action(state, self.profile, self.skills)
        self.assertEqual(result['status'], 'in-progress')
        self.assertEqual(result['recommended_action']['id'], 'active')

    def test_generic_profile_supports_non_lottify_project(self):
        profile = {
            'version': 1,
            'project': {'id': 'shop', 'name': 'Shop', 'entry_skill': 'shop'},
            'sources': {'required': {'roadmap': 'docs/roadmap.md'}, 'status_globs': []},
            'priorities': ['security', 'critical-path', 'ux'],
            'roles': {'lead': 'lead-agent'},
            'runtime_skills': {'config': 'tools/project-agent/skills/runtime-skill-packs.yaml'},
        }
        state = {
            'version': 1,
            'objective': 'complete checkout',
            'current_state': 'checkout API is incomplete',
            'actions': [
                {
                    'id': 'ux', 'title': 'polish checkout', 'status': 'pending',
                    'priority': 'ux', 'owner': 'frontend-agent',
                    'depends_on': [], 'blockers': [], 'gaps': ['visual gap'],
                    'project_subskills': ['shop-ux-review'],
                    'evidence_required': ['visual evidence'], 'action_types': ['implementation'],
                    'expected_result': 'polished checkout',
                },
                {
                    'id': 'api', 'title': 'implement checkout API', 'status': 'pending',
                    'priority': 'critical-path', 'owner': 'backend-agent',
                    'depends_on': [], 'blockers': [], 'gaps': ['API missing'],
                    'project_subskills': ['shop-api-review'],
                    'evidence_required': ['contract evidence'], 'action_types': ['implementation'],
                    'expected_result': 'working checkout API',
                },
            ],
        }
        from project_profile import validate_profile
        validate_profile(profile)
        result = resolve_next_action(state, profile, self.skills)
        self.assertEqual(result['recommended_action']['id'], 'api')
        self.assertEqual(result['recommended_action']['project_subskills'], ['shop-api-review'])
        self.assertNotIn('lottify', str(result).lower())

    def test_next_action_returns_wait_condition_instead_of_inventing_work(self):
        state = {
            'version': 1,
            'objective': 'release candidate',
            'current_state': 'waiting for CI',
            'actions': [
                {
                    'id': 'release', 'title': 'run release gate', 'status': 'waiting',
                    'priority': 'integrity-security-compliance', 'owner': 'release-gate-agent',
                    'depends_on': [], 'blockers': ['CI evidence missing'], 'gaps': ['CI evidence missing'],
                    'project_subskills': ['production-readiness-review'],
                    'evidence_required': ['green CI'], 'action_types': ['review'],
                    'expected_result': 'release review',
                },
            ],
        }
        result = resolve_next_action(state, self.profile, self.skills)
        self.assertEqual(result['status'], 'waiting')
        self.assertIsNone(result['recommended_action'])
        self.assertIn('CI evidence missing', result['gap'])
        self.assertIn('authoritative state change', result['resume_condition'])


if __name__ == '__main__':
    unittest.main()
