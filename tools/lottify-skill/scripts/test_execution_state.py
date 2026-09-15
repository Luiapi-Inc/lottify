import unittest

from execution_state import transition, validate_checkpoint


def checkpoint(state='INIT', **changes):
    value = {
        'checkpoint_version': 2,
        'objective_id': 'skill-evolution',
        'state': state,
        'evidence_fingerprint': 'e1',
        'state_fingerprint': 's1',
    }
    value.update(changes)
    return value


class ExecutionStateTest(unittest.TestCase):
    def test_validates_canonical_checkpoint_and_transition(self):
        validate_checkpoint(checkpoint())
        self.assertEqual(transition('INIT', 'SOURCE_ALIGNMENT'), 'SOURCE_ALIGNMENT')
        self.assertEqual(transition('REVIEW', 'ACCEPTED'), 'ACCEPTED')

    def test_rejects_invalid_transition(self):
        with self.assertRaisesRegex(ValueError, 'invalid state transition'):
            transition('INIT', 'RELEASE_READY')

    def test_wait_and_block_states_are_terminal_until_new_input(self):
        for state in ('WAITING_FOR_EVIDENCE', 'WAITING_FOR_ACCESS', 'BLOCKED_CONFLICT', 'FAILED_RETRY_LIMIT', 'REQUIREMENT_CONFLICT'):
            with self.subTest(state=state):
                self.assertFalse(transition(state, state))

    def test_rejects_missing_fingerprint_and_unknown_state(self):
        with self.assertRaisesRegex(ValueError, 'evidence_fingerprint'):
            validate_checkpoint(checkpoint(evidence_fingerprint=''))
        with self.assertRaisesRegex(ValueError, 'unsupported state'):
            validate_checkpoint(checkpoint('ACTIVE'))


if __name__ == '__main__':
    unittest.main()
