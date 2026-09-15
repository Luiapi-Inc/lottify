import unittest

from lead_cycle_guard import evaluate


def snapshot(**changes):
    value = {
        'objective_id': 'release-v1',
        'status': 'ACTIVE',
        'evidence_fingerprint': 'e1',
        'state_fingerprint': 's1',
        'action': {
            'id': 'verify-release',
            'operation_id': 'release-check',
            'input_fingerprint': 'i1',
            'strategy_fingerprint': 'strategy-1',
            'retry_count': 0,
            'executable': True,
        },
    }
    value.update(changes)
    return value


class LeadCycleGuardTest(unittest.TestCase):
    def test_initial_executable_action_continues(self):
        self.assertTrue(evaluate(snapshot())['continue'])

    def test_explicit_wait_state_halts(self):
        result = evaluate(snapshot(status='WAITING_FOR_EVIDENCE'))
        self.assertFalse(result['continue'])
        self.assertEqual(result['state'], 'WAITING_FOR_EVIDENCE')

    def test_unchanged_cycle_does_not_repeat(self):
        result = evaluate(snapshot(), snapshot())
        self.assertFalse(result['continue'])
        self.assertIn('no new evidence', result['reason'])

    def test_retry_requires_new_strategy_input_or_evidence(self):
        previous = snapshot()
        current = snapshot(
            action={**previous['action'], 'retry_count': 1},
        )
        result = evaluate(current, previous)
        self.assertFalse(result['continue'])
        self.assertIn('no new evidence', result['reason'])
        current['action']['strategy_fingerprint'] = 'strategy-2'
        self.assertTrue(evaluate(current, previous)['continue'])

    def test_fourth_retry_is_blocked(self):
        current = snapshot(action={**snapshot()['action'], 'retry_count': 4})
        result = evaluate(current)
        self.assertFalse(result['continue'])
        self.assertEqual(result['state'], 'BLOCKED')

    def test_three_retries_are_allowed_when_each_changes_strategy(self):
        previous = snapshot()
        for retry_count in (1, 2, 3):
            current = snapshot(
                action={
                    **previous['action'],
                    'retry_count': retry_count,
                    'strategy_fingerprint': f'strategy-{retry_count + 1}',
                }
            )
            self.assertTrue(evaluate(current, previous)['continue'])
            previous = current

    def test_versioned_state_checkpoint_uses_canonical_states(self):
        current = {
            'checkpoint_version': 2,
            'objective_id': 'release-v2',
            'state': 'SOURCE_ALIGNMENT',
            'evidence_fingerprint': 'e2',
            'state_fingerprint': 's2',
            'action': {
                'id': 'align-source',
                'operation_id': 'source-check',
                'input_fingerprint': 'i2',
                'strategy_fingerprint': 'strategy-1',
                'retry_count': 0,
                'executable': True,
            },
        }
        previous = {**current, 'state': 'INIT', 'state_fingerprint': 's1'}
        self.assertTrue(evaluate(current, previous)['continue'])

    def test_versioned_state_checkpoint_rejects_invalid_transition(self):
        current = {
            'checkpoint_version': 2,
            'objective_id': 'release-v2',
            'state': 'DONE',
            'evidence_fingerprint': 'e2',
            'state_fingerprint': 's2',
        }
        previous = {**current, 'state': 'INIT', 'state_fingerprint': 's1'}
        with self.assertRaisesRegex(ValueError, 'invalid state transition'):
            evaluate(current, previous)

    def test_versioned_wait_and_conflict_states_stop(self):
        for state in ('WAITING_FOR_EVIDENCE', 'WAITING_FOR_ACCESS', 'BLOCKED_CONFLICT', 'FAILED_RETRY_LIMIT', 'REQUIREMENT_CONFLICT'):
            with self.subTest(state=state):
                current = {
                    'checkpoint_version': 2,
                    'objective_id': 'release-v2',
                    'state': state,
                    'evidence_fingerprint': 'e2',
                    'state_fingerprint': 's2',
                }
                result = evaluate(current)
                self.assertFalse(result['continue'])
                self.assertEqual(result['state'], 'BLOCKED_CONFLICT' if state == 'REQUIREMENT_CONFLICT' else state)


if __name__ == '__main__':
    unittest.main()
