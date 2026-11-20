# Codex

- Codex 0.171 loads skills from several roots, each shown in the session as an alias: `r0` `~/.codex/skills`, `r1` `~/.agents/skills`, `r2` `~/.codex/skills/.system`, then plugin caches and the project's `.agents/skills`. So Codex needs no per-skill links; `apply` removes links in `~/.codex/skills` that point into `~/.agents/skills`. Real directories there are Codex-only skills and stay.
- Manual-only lives in each skill's `agents/openai.yaml`: `policy.allow_implicit_invocation: false`. `apply` writes it for every skill that is manual-only (frontmatter or `explicit_only`) and lacks it, marking its lines `# codex-skill-policy`; it removes or restores only marked lines, so a skill's own `openai.yaml` is safe. When the skill sits in a git checkout, `apply` adds the written file to that checkout's `.git/info/exclude`.
- `explicit_only` also reaches Codex's own skills under `~/.codex/skills/.system` (e.g. `skill-installer`).
- Excluding a skill from Codex has no link to drop. Codex's `~/.codex/config.toml` accepts `[[skills.config]]` entries with a `name` or a `path` selector (not both) and `enabled = false`; add one by hand. `check` prints `INFO` for `[exclude].codex`.
- `~/.codex/AGENTS.md` links to `~/.agents/AGENTS.md`.

## Verify

The newest session log lists every skill with its root alias:

```bash
f=$(find ~/.codex/sessions -name '*.jsonl' -mtime -1 | xargs ls -t | head -1)
grep -o '`r[0-9]` = `[^`]*' "$f" | sort -u     # roots
grep -o '(file: r[0-9]/<name>/SKILL.md)' "$f"    # the skill was offered
```
