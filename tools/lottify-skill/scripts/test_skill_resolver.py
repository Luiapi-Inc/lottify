import tempfile
import unittest
from pathlib import Path

from skill_resolver import load_registry, resolve, validate_registry


class SkillResolverTest(unittest.TestCase):
    def registry_path(self, text):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / 'registry.yaml'
        path.write_text(text, encoding='utf-8')
        return path

    def test_resolves_alias_to_installed_canonical_skill(self):
        path = self.registry_path(
            """
version: 1
skills:
  - canonical: lottify
    version: 1.2.0
    aliases: [lottify, lottify-multi-agent]
    status: installed
    path: SKILL.md
"""
        )
        registry = load_registry(path)
        self.assertEqual(resolve('lottify-multi-agent', registry), {
            'canonical': 'lottify',
            'version': '1.2.0',
            'status': 'installed',
        })

    def test_project_agent_alias_resolves_to_luiapi_agent(self):
        registry = load_registry(
            Path(__file__).resolve().parent.parent / 'skills' / 'registry.yaml'
        )
        self.assertEqual(resolve('project-agent', registry), {
            'canonical': 'luiapi-agent',
            'version': '1.0.0',
            'status': 'installed',
        })

    def test_rejects_unknown_alias_and_unavailable_skill(self):
        path = self.registry_path(
            """
version: 1
skills:
  - canonical: lottify
    version: 1.2.0
    aliases: [lottify]
    status: installed
    path: SKILL.md
  - canonical: future-skill
    version: 1.0.0
    aliases: [future-skill]
    status: advisory
"""
        )
        registry = load_registry(path)
        with self.assertRaisesRegex(ValueError, 'unknown skill'):
            resolve('testing', registry)
        with self.assertRaisesRegex(ValueError, 'not installed'):
            resolve('future-skill', registry)

    def test_rejects_version_mismatch_duplicate_alias_and_bad_registry(self):
        path = self.registry_path(
            """
version: 1
skills:
  - canonical: lottify
    version: 1.2.0
    aliases: [lottify]
    status: installed
    path: SKILL.md
"""
        )
        registry = load_registry(path)
        with self.assertRaisesRegex(ValueError, 'version mismatch'):
            resolve('lottify', registry, required_version='2.0.0')

        duplicate = self.registry_path(
            """
version: 1
skills:
  - canonical: first
    version: 1.0.0
    aliases: [first, same]
    status: installed
    path: first.md
  - canonical: second
    version: 1.0.0
    aliases: [second, same]
    status: installed
    path: second.md
"""
        )
        with self.assertRaisesRegex(ValueError, 'duplicate alias'):
            validate_registry(load_registry(duplicate))

    def test_advisory_candidate_is_known_but_not_loadable(self):
        registry = {
            'version': 1,
            'skills': [{
                'canonical': 'testing',
                'version': '0.0.0',
                'aliases': ['testing'],
                'status': 'advisory',
            }],
        }
        with self.assertRaisesRegex(ValueError, 'not installed'):
            resolve('testing', registry)


if __name__ == '__main__':
    unittest.main()
