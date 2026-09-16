import tempfile
import unittest
from pathlib import Path

from install_runtime import install_runtime


SKILL = """---
name: {name}
description: Test skill.
---

# {name}
"""


class RuntimeInstallerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.repo = self.root / "repo"
        self.home = self.root / "home"
        for name, path in (
            ("luiapi-agent", self.repo / "tools/luiapi-agent"),
            ("lottify", self.repo / "tools/lottify-skill"),
        ):
            path.mkdir(parents=True)
            (path / "SKILL.md").write_text(SKILL.format(name=name), encoding="utf-8")
        (self.repo / "tools/luiapi-agent/skills").mkdir()
        (self.repo / "tools/luiapi-agent/skills/runtime-skill-packs.yaml").write_text(
            """version: 1
role_defaults:
  lead-agent: [code-review, native-only]
action_packs:
  implementation: [tdd]
action_signals:
  implementation: [implement]
guarded_skills: {}
""",
            encoding="utf-8",
        )
        for name in ("code-review", "tdd"):
            source = self.home / ".agents/skills" / name
            source.mkdir(parents=True)
            (source / "SKILL.md").write_text(SKILL.format(name=name), encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_installs_hermes_and_shared_skills(self):
        result = install_runtime("hermes", self.repo, self.home)
        self.assertTrue((self.home / ".hermes/skills/software-development/luiapi-agent").is_symlink())
        self.assertTrue((self.home / ".hermes/skills/software-development/lottify").is_symlink())
        self.assertTrue((self.home / ".hermes/skills/code-review").is_symlink())
        self.assertTrue((self.home / ".hermes/skills/tdd").is_symlink())
        self.assertIn("native-only", result["inventory"]["unresolved_runtime_pack_skills"])
        self.assertIn("luiapi-agent", result["inventory"]["available_skills"])
        self.assertIn("lottify", result["inventory"]["available_skills"])

    def test_migrates_legacy_project_agent_symlink(self):
        legacy_source = self.repo / 'tools/project-agent'
        legacy_source.mkdir(parents=True)
        (legacy_source / 'SKILL.md').write_text(SKILL.format(name='project-agent'), encoding='utf-8')
        legacy = self.home / '.codex/skills/project-agent'
        legacy.parent.mkdir(parents=True)
        legacy.symlink_to(legacy_source, target_is_directory=True)

        result = install_runtime(
            'codex', self.repo, self.home, migrate_existing=True, timestamp='fixture'
        )
        self.assertFalse(legacy.exists() or legacy.is_symlink())
        self.assertTrue((self.home / '.codex/skills/luiapi-agent').is_symlink())
        retired = next(
            item for item in result['actions']
            if item['target'].endswith('/project-agent')
        )
        self.assertEqual(retired['action'], 'legacy-retired')

    def test_codex_preserves_native_skill_and_migrates_existing_lottify(self):
        native = self.home / ".codex/skills/native-only"
        native.mkdir(parents=True)
        (native / "SKILL.md").write_text(SKILL.format(name="native-only"), encoding="utf-8")
        old = self.home / ".codex/skills/lottify"
        old.mkdir(parents=True)
        (old / "SKILL.md").write_text(SKILL.format(name="old-lottify"), encoding="utf-8")

        result = install_runtime(
            "codex", self.repo, self.home, migrate_existing=True, timestamp="fixture"
        )
        self.assertTrue((self.home / ".codex/skills/lottify").is_symlink())
        backup = self.home / ".local/share/luiapi-agent/backups/codex/fixture/lottify"
        self.assertTrue((backup / "SKILL.md").is_file())
        self.assertEqual((native / "SKILL.md").read_text(), SKILL.format(name="native-only"))
        self.assertIn("native-only", result["inventory"]["available_skills"])

    def test_existing_runtime_skill_is_preserved(self):
        existing = self.home / ".codex/skills/code-review"
        existing.mkdir(parents=True)
        (existing / "SKILL.md").write_text(SKILL.format(name="code-review"), encoding="utf-8")
        result = install_runtime("codex", self.repo, self.home)
        record = next(item for item in result["actions"] if item["target"].endswith("/code-review"))
        self.assertEqual(record["action"], "preserved")
        self.assertFalse(existing.is_symlink())

    def test_dry_run_does_not_mutate_runtime(self):
        install_runtime("hermes", self.repo, self.home, dry_run=True)
        self.assertFalse((self.home / ".hermes").exists())
        self.assertFalse((self.home / ".local/share/luiapi-agent/hermes-inventory.json").exists())


if __name__ == "__main__":
    unittest.main()
