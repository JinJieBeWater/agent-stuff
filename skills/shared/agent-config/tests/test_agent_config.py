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
REPO = SCRIPT.parents[4]
SHARED_AGENTS = REPO / "config/shared/AGENTS.md"


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
        # prompt entry files, wired correctly
        hm = self.home
        (hm / ".agents/AGENTS.md").symlink_to(SHARED_AGENTS)
        (hm / ".codex/AGENTS.md").symlink_to(hm / ".agents/AGENTS.md")
        (hm / ".pi/agent").mkdir(parents=True)
        (hm / ".pi/agent/AGENTS.md").symlink_to(SHARED_AGENTS)
        (hm / ".pi/agent/APPEND_SYSTEM.md").symlink_to(REPO / "config/pi/APPEND_SYSTEM.md")
        (hm / ".gemini/config/AGENTS.md").symlink_to(SHARED_AGENTS)
        (hm / ".gemini/GEMINI.md").symlink_to(REPO / "config/antigravity/GEMINI.md")
        (hm / ".claude/CLAUDE.md").write_text("@~/.agents/AGENTS.md\n\nlocal notes\n")

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


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.h = Home(self._tmp.name)
        self.settings = self.h.home / ".claude/settings.json"
        self.settings.write_text(json.dumps({"model": "opus", "skillOverrides": {"code-review": "user-invocable-only"}}, indent=2) + "\n")

    def tearDown(self):
        self._tmp.cleanup()

    def overrides(self):
        return json.loads(self.settings.read_text()).get("skillOverrides", {})

    def yaml(self, name):
        p = self.h.src / name / "agents/openai.yaml"
        return p.read_text() if p.exists() else None

    def test_manifest_skill_gets_claude_override_and_codex_policy(self):
        h = self.h
        h.add("m")
        h.manifest('explicit_only = ["m"]\n')
        r = h.run("check")
        self.assertIn("POLICY claude m", r.stdout)
        self.assertIn("POLICY codex m", r.stdout)
        self.assertEqual(r.returncode, 1)
        h.run("apply")
        self.assertEqual(self.overrides(), {"code-review": "user-invocable-only", "m": "user-invocable-only"})
        self.assertIn("allow_implicit_invocation: false  # codex-skill-policy", self.yaml("m"))
        self.assertEqual(json.loads(self.settings.read_text())["model"], "opus")
        self.assertEqual(h.run("check").returncode, 0, h.run("check").stdout)

    def test_dropping_from_manifest_restores_both_hosts(self):
        h = self.h
        h.add("m")
        h.manifest('explicit_only = ["m"]\n')
        h.run("apply")
        h.manifest("")
        h.run("apply")
        self.assertEqual(self.overrides(), {"code-review": "user-invocable-only"})
        self.assertIsNone(self.yaml("m"))

    def test_existing_yaml_keeps_its_own_lines_on_hide_and_restore(self):
        h = self.h
        real = h.add("m")
        (real / "agents").mkdir()
        orig = "interface:\n  display_name: M\npolicy:\n  allow_implicit_invocation: true\n"
        (real / "agents/openai.yaml").write_text(orig)
        h.manifest('explicit_only = ["m"]\n')
        h.run("apply")
        self.assertIn("allow_implicit_invocation: false  # codex-skill-policy", self.yaml("m"))
        h.manifest("")
        h.run("apply")
        self.assertEqual(self.yaml("m"), orig)

    def test_frontmatter_declared_skill_needs_no_claude_key_but_gets_codex_policy(self):
        h = self.h
        h.add("f", "disable-model-invocation: true\n")
        r = h.run("check")
        self.assertNotIn("POLICY claude f", r.stdout)
        self.assertIn("POLICY codex f", r.stdout)
        h.run("apply")
        self.assertNotIn("f", self.overrides())

    def test_unmarked_false_policy_is_left_alone(self):
        h = self.h
        real = h.add("f", "disable-model-invocation: true\n")
        (real / "agents").mkdir()
        (real / "agents/openai.yaml").write_text("policy:\n  allow_implicit_invocation: false\n")
        r = h.run("check")
        self.assertNotIn("codex f", r.stdout)

    def test_codex_system_skills_are_left_alone(self):
        # Codex rewrites ~/.codex/skills/.system on every launch, so a policy there never sticks.
        h = self.h
        sysdir = skill(h.codex / ".system", "skill-installer")
        h.manifest('explicit_only = ["skill-installer"]\n')
        r = h.run("apply")
        self.assertFalse((sysdir / "agents/openai.yaml").exists())
        self.assertIn("WARN manifest skill-installer", r.stdout)

    def test_unknown_manifest_name_warns(self):
        h = self.h
        h.manifest('explicit_only = ["nope"]\n')
        r = h.run("check")
        self.assertIn("WARN manifest nope", r.stdout)
        self.assertEqual(r.returncode, 0)

    def test_manifest_only_names_are_info_gaps_for_pi_and_antigravity(self):
        h = self.h
        h.add("m")
        h.add("f", "disable-model-invocation: true\n")
        h.manifest('explicit_only = ["m", "f"]\n')
        h.run("apply")
        r = h.run("check")
        self.assertIn("INFO pi m", r.stdout)
        self.assertIn("INFO antigravity m", r.stdout)
        self.assertNotIn("INFO pi f", r.stdout)
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_settings_formatting_is_preserved(self):
        h = self.h
        h.add("m")
        h.manifest('explicit_only = ["m"]\n')
        body = '{\n  "model": "opus",\n  "note": "中文",\n  "skillOverrides": {\n    "code-review": "user-invocable-only"\n  }\n}\n'
        self.settings.write_text(body)
        h.run("apply")
        h.manifest("")
        h.run("apply")
        self.assertEqual(self.settings.read_text(), body)


class PiExcludeTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.h = Home(self._tmp.name)
        self.pi = self.h.home / ".pi/agent/settings.json"

    def tearDown(self):
        self._tmp.cleanup()

    def test_apply_writes_owned_entries_and_keeps_others(self):
        h = self.h
        h.add("show-me")
        h.add("old")
        old = f"-{h.agents}/old"
        self.pi.write_text(json.dumps({"theme": "x", "skills": ["+/elsewhere/x", old]}, indent=2))  # Pi writes no trailing newline
        h.manifest('[exclude]\npi = ["show-me"]\n')
        r = h.run("check")
        self.assertIn("EXCLUDE pi show-me", r.stdout)
        self.assertIn("EXCLUDE pi old", r.stdout)
        h.run("apply")
        text = self.pi.read_text()
        self.assertFalse(text.endswith("\n"))
        self.assertEqual(json.loads(text), {"theme": "x", "skills": ["+/elsewhere/x", f"-{h.agents}/show-me"]})
        self.assertNotIn("pi", h.run("check").stdout)

    def test_tilde_form_counts_as_the_same_entry(self):
        h = self.h
        h.add("show-me")
        self.pi.write_text(json.dumps({"skills": ["-~/.agents/skills/show-me"]}))
        h.manifest('[exclude]\npi = ["show-me"]\n')
        self.assertNotIn("EXCLUDE", h.run("check").stdout)

    def test_codex_exclude_is_info_only(self):
        h = self.h
        h.add("a")
        h.manifest('[exclude]\ncodex = ["a"]\n')
        h.run("apply")
        r = h.run("check")
        self.assertIn("INFO codex a", r.stdout)
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_unknown_exclude_name_warns(self):
        h = self.h
        h.manifest('[exclude]\npi = ["nope"]\n')
        self.assertIn("WARN manifest nope", h.run("check").stdout)


class PromptEntryTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.h = Home(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_correct_entries_are_clean(self):
        r = self.h.run("check")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertNotIn("PROMPT", r.stdout)

    def test_missing_entry_is_created_by_apply(self):
        p = self.h.home / ".codex/AGENTS.md"
        p.unlink()
        r = self.h.run("check")
        self.assertIn("PROMPT codex ~/.codex/AGENTS.md", r.stdout)
        self.assertEqual(r.returncode, 1)
        self.h.run("apply")
        self.assertEqual(os.path.realpath(p), os.path.realpath(SHARED_AGENTS))

    def test_regular_file_in_place_of_link_is_reported_not_replaced(self):
        p = self.h.home / ".pi/agent/AGENTS.md"
        p.unlink()
        p.write_text("my own\n")
        self.assertIn("PROMPT pi ~/.pi/agent/AGENTS.md", self.h.run("check").stdout)
        self.h.run("apply")
        self.assertEqual(p.read_text(), "my own\n")

    def test_antigravity_entries_are_check_only(self):
        p = self.h.home / ".gemini/GEMINI.md"
        p.unlink()
        r = self.h.run("apply")
        self.assertIn("PROMPT antigravity ~/.gemini/GEMINI.md", r.stdout)
        self.assertIn("sync.sh", r.stdout)
        self.assertFalse(p.is_symlink())

    def test_claude_md_without_import_is_reported(self):
        (self.h.home / ".claude/CLAUDE.md").write_text("nothing\n")
        self.assertIn("PROMPT claude ~/.claude/CLAUDE.md", self.h.run("check").stdout)


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.h = Home(self._tmp.name)
        self.settings = self.h.home / ".claude/settings.json"
        self.h.add("m")
        self.h.manifest('explicit_only = ["m"]\n')
        self.h.run("apply")

    def tearDown(self):
        self._tmp.cleanup()

    def test_missing_manifest_stops_before_touching_anything(self):
        (self.h.home / ".config/agent-config/skills.toml").unlink()
        before = self.settings.read_text()
        r = self.h.run("apply")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("skills.toml", r.stderr)
        self.assertEqual(self.settings.read_text(), before)

    def test_unknown_key_is_rejected(self):
        self.h.manifest('explicit-only = ["m"]\n')
        r = self.h.run("check")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("explicit-only", r.stderr)

    def test_string_instead_of_list_is_rejected(self):
        self.h.manifest('explicit_only = "m"\n')
        r = self.h.run("check")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("explicit_only must be a list of names", r.stderr)

    def test_exclude_value_must_be_a_list(self):
        self.h.manifest('[exclude]\npi = "m"\n')
        r = self.h.run("check")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("exclude.pi must be a list of names", r.stderr)


class WrongTargetTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.h = Home(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_link_to_another_skill_is_foreign(self):
        h = self.h
        h.add("a")
        h.add("b")
        (h.claude / "a").symlink_to("../../.agents/skills/b")
        r = h.run("apply")
        self.assertIn("FOREIGN claude a", r.stdout)
        self.assertEqual(os.readlink(h.claude / "a"), "../../.agents/skills/b")

    def test_alias_link_with_its_own_name_is_kept(self):
        h = self.h
        h.add("a")
        (h.claude / "my-alias").symlink_to("../../.agents/skills/a")
        h.run("apply")
        self.assertTrue((h.claude / "my-alias").is_symlink())


if __name__ == "__main__":
    unittest.main()
