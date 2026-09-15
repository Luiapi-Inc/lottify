#!/usr/bin/env python3
"""Fail-closed guard for Lottify Lead autonomous continuation."""

import argparse
import json
from pathlib import Path

from execution_state import WAIT_STATES as CANONICAL_WAIT_STATES
from execution_state import TERMINAL_STATES as CANONICAL_TERMINAL_STATES
from execution_state import canonical_state, transition, validate_checkpoint


WAIT_STATES = {
    'BLOCKED',
    'WAITING_FOR_EVIDENCE',
    'WAITING_FOR_ACCESS',
    'REQUIREMENT_CONFLICT',
    'WAITING_FOR_USER_DECISION',
    'EXTERNAL_DEPENDENCY',
}
TERMINAL_STATES = {'COMPLETE'}
ACTIVE_STATES = {'ACTIVE', 'HOLD', 'NOT_PASSED'}
ALL_STATES = WAIT_STATES | TERMINAL_STATES | ACTIVE_STATES


def _nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def _action(snapshot):
    action = snapshot.get('action')
    return action if isinstance(action, dict) else {}


def validate(snapshot, label):
    if not isinstance(snapshot, dict):
        raise ValueError(f'{label} must be a mapping')
    if snapshot.get('checkpoint_version') == 2:
        validate_checkpoint(snapshot)
        return
    for field in ('objective_id', 'status', 'evidence_fingerprint', 'state_fingerprint'):
        if not _nonempty(snapshot.get(field)):
            raise ValueError(f'{label}.{field} must be a nonempty string')
    if snapshot['status'] not in ALL_STATES:
        raise ValueError(f'{label}.status is unsupported: {snapshot["status"]}')
    action = _action(snapshot)
    if action:
        for field in ('id', 'operation_id', 'input_fingerprint', 'strategy_fingerprint'):
            if not _nonempty(action.get(field)):
                raise ValueError(f'{label}.action.{field} must be a nonempty string')
        if type(action.get('executable')) is not bool:
            raise ValueError(f'{label}.action.executable must be boolean')
        retry_count = action.get('retry_count')
        if type(retry_count) is not int or retry_count < 0:
            raise ValueError(f'{label}.action.retry_count must be a non-negative integer')


def evaluate(current, previous=None):
    validate(current, 'current')
    if previous is not None:
        validate(previous, 'previous')

    versioned = current.get('checkpoint_version') == 2
    status = canonical_state(current['state']) if versioned else current['status']
    if previous is not None and current.get('checkpoint_version') == 2 and previous.get('checkpoint_version') == 2:
        if current['state'] != previous['state']:
            transition(previous['state'], current['state'])
    if (versioned and status in CANONICAL_WAIT_STATES) or (not versioned and status in WAIT_STATES):
        return {'continue': False, 'state': status, 'reason': 'explicit wait/block state'}
    if (versioned and status in CANONICAL_TERMINAL_STATES) or (not versioned and status in TERMINAL_STATES):
        return {'continue': False, 'state': status, 'reason': 'objective is terminal'}

    action = _action(current)
    if not action or not action.get('executable'):
        return {'continue': False, 'state': 'WAITING_FOR_EVIDENCE', 'reason': 'no executable action'}
    if action['retry_count'] > 3:
        return {'continue': False, 'state': 'BLOCKED', 'reason': 'operation retry limit exceeded'}

    if previous is None or previous.get('objective_id') != current['objective_id']:
        return {'continue': True, 'state': 'ACTIVE', 'reason': 'executable action exists for current objective'}

    previous_action = _action(previous)
    evidence_changed = current['evidence_fingerprint'] != previous['evidence_fingerprint']
    state_changed = current['state_fingerprint'] != previous['state_fingerprint']
    action_changed = (
        action.get('id') != previous_action.get('id')
        or action.get('input_fingerprint') != previous_action.get('input_fingerprint')
        or action.get('strategy_fingerprint') != previous_action.get('strategy_fingerprint')
    )

    if not evidence_changed and not state_changed and not action_changed:
        return {
            'continue': False,
            'state': 'WAITING_FOR_EVIDENCE',
            'reason': 'no new evidence, executable action input, or authoritative state change',
        }

    if previous_action and action['operation_id'] == previous_action.get('operation_id'):
        previous_retry_count = previous_action.get('retry_count', 0)
        if action['retry_count'] < previous_retry_count:
            return {'continue': False, 'state': 'BLOCKED', 'reason': 'retry attempt did not advance'}
        if action['retry_count'] == previous_retry_count:
            return {'continue': True, 'state': 'ACTIVE', 'reason': 'authoritative state changed'}
        if action['retry_count'] != previous_retry_count + 1:
            return {'continue': False, 'state': 'BLOCKED', 'reason': 'retry attempt sequence is invalid'}
        strategy_changed = action['strategy_fingerprint'] != previous_action.get('strategy_fingerprint')
        input_changed = action['input_fingerprint'] != previous_action.get('input_fingerprint')
        if not (strategy_changed or input_changed or evidence_changed):
            return {
                'continue': False,
                'state': 'BLOCKED',
                'reason': 'retry requires changed strategy, input, or evidence',
            }

    return {'continue': True, 'state': 'ACTIVE', 'reason': 'new evidence/action/state permits continuation'}


def load(path):
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        raise ValueError(f'{path}: expected JSON object')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('current', type=Path)
    parser.add_argument('--previous', type=Path)
    args = parser.parse_args()
    try:
        result = evaluate(load(args.current), load(args.previous) if args.previous else None)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    print(json.dumps(result, indent=2))
    if not result['continue']:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
