#!/usr/bin/env python3
"""Validate the versioned Lottify Lead execution state contract."""


STATES = {
    'INIT',
    'SOURCE_ALIGNMENT',
    'PLAN_READY',
    'DISPATCHING',
    'WAITING_AGENT',
    'EVIDENCE_COLLECTION',
    'REVIEW',
    'ACCEPTED',
    'RELEASE_READY',
    'DONE',
    'WAITING_FOR_EVIDENCE',
    'WAITING_FOR_ACCESS',
    'BLOCKED_CONFLICT',
    'FAILED_RETRY_LIMIT',
}

# Older checkpoints used this name for the same stop condition.  Accepting it
# here keeps the state contract migratable without creating a second conflict
# path in the transition table.
STATE_ALIASES = {'REQUIREMENT_CONFLICT': 'BLOCKED_CONFLICT'}

WAIT_STATES = {'WAITING_FOR_EVIDENCE', 'WAITING_FOR_ACCESS', 'BLOCKED_CONFLICT', 'FAILED_RETRY_LIMIT'}
TERMINAL_STATES = {'DONE'}

ALLOWED_TRANSITIONS = {
    'INIT': {'SOURCE_ALIGNMENT'},
    'SOURCE_ALIGNMENT': {'PLAN_READY', 'WAITING_FOR_EVIDENCE', 'WAITING_FOR_ACCESS', 'BLOCKED_CONFLICT'},
    'PLAN_READY': {'DISPATCHING', 'WAITING_FOR_EVIDENCE', 'WAITING_FOR_ACCESS', 'BLOCKED_CONFLICT'},
    'DISPATCHING': {'WAITING_AGENT', 'EVIDENCE_COLLECTION', 'WAITING_FOR_ACCESS', 'BLOCKED_CONFLICT'},
    'WAITING_AGENT': {'EVIDENCE_COLLECTION', 'WAITING_FOR_ACCESS', 'BLOCKED_CONFLICT'},
    'EVIDENCE_COLLECTION': {'REVIEW', 'WAITING_FOR_EVIDENCE', 'WAITING_FOR_ACCESS', 'BLOCKED_CONFLICT'},
    'REVIEW': {'ACCEPTED', 'RELEASE_READY', 'WAITING_FOR_EVIDENCE', 'BLOCKED_CONFLICT'},
    'ACCEPTED': {'RELEASE_READY', 'DONE'},
    'RELEASE_READY': {'DONE', 'BLOCKED_CONFLICT'},
    'DONE': set(),
    'WAITING_FOR_EVIDENCE': {'SOURCE_ALIGNMENT', 'PLAN_READY', 'EVIDENCE_COLLECTION', 'REVIEW', 'BLOCKED_CONFLICT'},
    'WAITING_FOR_ACCESS': {'SOURCE_ALIGNMENT', 'PLAN_READY', 'DISPATCHING', 'EVIDENCE_COLLECTION', 'BLOCKED_CONFLICT'},
    'BLOCKED_CONFLICT': {'SOURCE_ALIGNMENT', 'PLAN_READY'},
    'FAILED_RETRY_LIMIT': {'SOURCE_ALIGNMENT', 'PLAN_READY'},
}


def canonical_state(state):
    return STATE_ALIASES.get(state, state)


def validate_checkpoint(checkpoint):
    if not isinstance(checkpoint, dict):
        raise ValueError('checkpoint must be a mapping')
    if checkpoint.get('checkpoint_version') != 2:
        raise ValueError('checkpoint_version must be 2')
    for field in ('objective_id', 'state', 'evidence_fingerprint', 'state_fingerprint'):
        value = checkpoint.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f'{field} must be a non-empty string')
    if canonical_state(checkpoint['state']) not in STATES:
        raise ValueError(f'unsupported state: {checkpoint["state"]}')
    action = checkpoint.get('action')
    if action is not None:
        if not isinstance(action, dict):
            raise ValueError('action must be a mapping')
        for field in ('id', 'operation_id', 'input_fingerprint', 'strategy_fingerprint'):
            if not isinstance(action.get(field), str) or not action[field].strip():
                raise ValueError(f'action.{field} must be a non-empty string')
        if type(action.get('executable')) is not bool:
            raise ValueError('action.executable must be boolean')
        if type(action.get('retry_count')) is not int or action['retry_count'] < 0 or action['retry_count'] > 3:
            raise ValueError('action.retry_count must be an integer from 0 through 3')


def transition(current, target):
    current = canonical_state(current)
    target = canonical_state(target)
    if current not in STATES or target not in STATES:
        raise ValueError('invalid state transition: unsupported state')
    if current in WAIT_STATES and current == target:
        return False
    if target not in ALLOWED_TRANSITIONS[current]:
        raise ValueError(f'invalid state transition: {current} -> {target}')
    return target
