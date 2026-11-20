# Claude Code

- Reads skills from `~/.claude/skills` only, never from `~/.agents/skills`. Each skill needs its own link there; `apply` creates `../../.agents/skills/<dir>`. A link that resolves to the same directory by another route (absolute, or straight to the source as `skill-creator` does) counts as correct.
- `~/.claude/skills/synced` and `.trash` belong to Claude; plugin skills (Ryugi) come from `~/.claude/plugins`. `agent-config` ignores names absent from `~/.agents/skills`.
- `skillOverrides` in `~/.claude/settings.json` is keyed by the skill's **directory name**, not its frontmatter `name` (probed 2026-11-21: a key with the `name` value had no effect). Values seen: `user-invocable-only`, `off`. `apply` owns only keys that are `~/.agents/skills` names with value `user-invocable-only`; built-in keys (`code-review`, `simplify`, ...) and other values stay as they are.
- Known limit: the script cannot tell a built-in key from one of ours by name. A `~/.agents` skill that shares a built-in's name (`code-review`, `simplify`, `init`, ...) takes over that key, and `apply` deletes it unless the name is in `explicit_only`. Before adding such a skill, compare its name with the `skillOverrides` keys and add it to `explicit_only` to keep the built-in hidden.
- A skill with `disable-model-invocation: true` is missing from the model's skill list by design. `/<name>` still runs it. Absent from the list is no evidence of a broken link.
- `~/.claude/CLAUDE.md` is a regular file: `@~/.agents/AGENTS.md` plus Claude-only rules (subagent models). `check` only confirms the import line.
- A running session picked up new skill links mid-session on 2026-11-21; a new session is the reliable check.

## Verify

From an empty directory, cheapest model:

```bash
cd /tmp && claude -p --model haiku "Without using any tools, print the exact names of every skill in your available-skills list, one per line, nothing else." | grep -x -E '<name>|<other>'
```

A manual-only skill must be absent; a normal one present.
