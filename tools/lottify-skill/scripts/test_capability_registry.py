import tempfile
import unittest
from pathlib import Path

from capability_registry import load_registry, route, validate_registry


class CapabilityRegistryTest(unittest.TestCase):
    def registry_path(self, text):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / 'capabilities.yaml'
        path.write_text(text, encoding='utf-8')
        return path

    def test_routes_financial_boundary_with_owner_reviewers_and_exclusive_lock(self):
        path = self.registry_path(
            """
version: 1
capabilities:
  - id: financial
    owner: financial-integrity-agent
    reviewers: [security-agent, quality-gate-agent]
    exclusive_boundary: true
    signals: [wallet, ledger]
    evidence: [ledger invariant verification]
"""
        )
        registry = load_registry(path)
        self.assertEqual(route('add ledger reservation', registry), {
            'id': 'financial',
            'owner': 'financial-integrity-agent',
            'reviewers': ['security-agent', 'quality-gate-agent'],
            'exclusive_boundary': True,
            'evidence': ['ledger invariant verification'],
        })

    def test_rejects_duplicate_signal_and_missing_owner(self):
        path = self.registry_path(
            """
version: 1
capabilities:
  - id: first
    owner: backend-agent
    reviewers: [quality-gate-agent]
    exclusive_boundary: false
    signals: [api]
    evidence: [contract]
  - id: second
    owner: ''
    reviewers: [quality-gate-agent]
    exclusive_boundary: false
    signals: [api]
    evidence: [contract]
"""
        )
        with self.assertRaisesRegex(ValueError, 'owner'):
            validate_registry(load_registry(path))

    def test_schema_and_migration_are_distinct_boundaries(self):
        path = self.registry_path(
            """
version: 1
capabilities:
  - id: schema
    owner: backend-agent
    reviewers: [quality-gate-agent]
    exclusive_boundary: true
    signals: [prisma]
    evidence: [schema review]
  - id: migration
    owner: backend-agent
    reviewers: [release-gate-agent]
    exclusive_boundary: true
    signals: [migration]
    evidence: [compatibility]
"""
        )
        registry = load_registry(path)
        self.assertEqual(route('prisma schema review', registry)['id'], 'schema')
        self.assertEqual(route('database migration review', registry)['id'], 'migration')


if __name__ == '__main__':
    unittest.main()
