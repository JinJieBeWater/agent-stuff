"""Offline tests for scripts/agent-config: python3 -I skills/shared/agent-config/tests/test_agent_config.py

Every test builds a throwaway HOME and runs the script with HOME pointing at it, so
nothing on the real machine is read or written.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "agent-config"


def skill(root, name, frontmatter=""):
    d = root / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(f"---\nname: {name}\ndescription: test\n{frontmatter}---\nbody\n")
    return d


class Home:
    """A fake HOME with the four hosts' skill roots."""

    def __init__(self, tmp):
        self.home = Path(tmp)
        self.src = self.home / "src"
        self.agents = self.home / ".agents/skills"
        self.claude = self.home / ".claude/skills"
        self.codex = self.home / ".codex/skills"
        self.gemini = self.home / ".gemini/config/skills"
        for d in (self.src, self.agents, self.claude, self.codex, self.gemini):
            d.mkdir(parents=True)
        self.manifest("")

    def add(self, name, frontmatter=""):
        """A skill living in src/, linked into ~/.agents/skills like the real setup."""
        real = skill(self.src, name, frontmatter)
        (self.agents / name).symlink_to(real)
        return real

    def manifest(self, text):
        p = self.home / ".config/agent-config/skills.toml"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def run(self, *args):
        env = {"HOME": str(self.home), "PATH": os.environ["PATH"]}
        return subprocess.run([sys.executable, "-I", str(SCRIPT), *args], env=env, capture_output=True, text=True)


def link_target(p):
    return os.readlink(p) if p.is_symlink() else None


class LinkTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.h = Home(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_check_reports_missing_foreign_and_stale_codex_links(self):
        h = self.h
        h.add("a")
        h.add("b")
        h.add("c")
        (h.claude / "a").symlink_to("../../.agents/skills/a")
        (h.gemini / "a").symlink_to(h.agents / "a")  # absolute form, same target
        (h.gemini / "b").symlink_to(h.agents / "b")
        (h.gemini / "c").symlink_to(h.agents / "c")
        (h.claude / "c").mkdir()  # real dir copy: not ours
        (h.codex / "a").symlink_to("../../.agents/skills/a")
        r = h.run("check")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("MISSING claude b", r.stdout)
        self.assertIn("FOREIGN claude c", r.stdout)
        self.assertIn("STALE codex a", r.stdout)
        self.assertNotIn("claude a", r.stdout)
        self.assertNotIn("antigravity", r.stdout)

    def test_apply_fixes_owned_drift_and_leaves_foreign_alone(self):
        h = self.h
        h.add("a")
        h.add("b")
        (h.claude / "b").mkdir()
        (h.codex / "a").symlink_to("../../.agents/skills/a")
        (h.codex / "own").mkdir()  # Codex-only skill dir: not ours
        r = h.run("apply")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(link_target(h.claude / "a"), "../../.agents/skills/a")
        self.assertEqual(link_target(h.gemini / "a"), "../../../.agents/skills/a")
        self.assertTrue((h.claude / "a" / "SKILL.md").is_file())
        self.assertTrue((h.gemini / "a" / "SKILL.md").is_file())
        self.assertTrue((h.claude / "b").is_dir() and not (h.claude / "b").is_symlink())
        self.assertFalse((h.codex / "a").exists() or (h.codex / "a").is_symlink())
        self.assertTrue((h.codex / "own").is_dir())
        r = h.run("check")
        self.assertIn("FOREIGN claude b", r.stdout)
        self.assertEqual(r.returncode, 1)  # foreign stays drift until a human resolves it

    def test_check_is_clean_after_apply(self):
        h = self.h
        h.add("a")
        h.run("apply")
        r = h.run("check")
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_dry_run_writes_nothing(self):
        h = self.h
        h.add("a")
        (h.codex / "a").symlink_to("../../.agents/skills/a")
        r = h.run("apply", "--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("WOULD", r.stdout)
        self.assertFalse((h.claude / "a").is_symlink())
        self.assertTrue((h.codex / "a").is_symlink())

    def test_exclude_removes_owned_link_only_for_that_host(self):
        h = self.h
        h.add("a")
        h.run("apply")
        h.manifest('[exclude]\nclaude = ["a"]\n')
        r = h.run("check")
        self.assertIn("STALE claude a", r.stdout)
        h.run("apply")
        self.assertFalse((h.claude / "a").is_symlink())
        self.assertTrue((h.gemini / "a").is_symlink())

    def test_link_to_skill_removed_from_agents_is_stale(self):
        h = self.h
        h.add("a")
        h.run("apply")
        (h.agents / "a").unlink()
        r = h.run("check")
        # a dangling link pointing into ~/.agents/skills is ours to clean up
        self.assertIn("STALE claude a", r.stdout)
        h.run("apply")
        self.assertFalse((h.claude / "a").is_symlink())

    def test_broken_agents_entry_is_reported(self):
        h = self.h
        (h.agents / "gone").symlink_to(h.src / "gone")
        r = h.run("check")
        self.assertIn("BROKEN agents gone", r.stdout)
        self.assertEqual(r.returncode, 1)

    def test_link_through_another_path_to_same_dir_counts_as_ours(self):
        h = self.h
        real = h.add("a")
        (h.claude / "a").symlink_to(real)  # bypasses ~/.agents but same realpath
        r = h.run("check")
        self.assertNotIn("claude a", r.stdout)

    def test_names_not_in_agents_are_ignored(self):
        h = self.h
        (h.gemini / "ryugi-x").symlink_to(h.src)  # plugin link
        r = h.run("check")
        self.assertNotIn("ryugi-x", r.stdout)
        self.assertEqual(r.returncode, 0, r.stdout)


if __name__ == "__main__":
    unittest.main()
