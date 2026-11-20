---
name: agent-config
description: "Maintain this Mac's agent setup across Claude Code, Codex, Pi and Antigravity: skill links, manual-only skills, global prompt files. Use when a skill is missing in a host, adding, removing or excluding a skill, making a skill manual-only, editing AGENTS.md / CLAUDE.md / GEMINI.md / APPEND_SYSTEM.md, restoring on a new machine, or checking config drift (skill 不见了、配置漂移)."
---

# Agent config

## Map

| What             | Source of truth                                                                                    | How hosts get it                                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global prompt    | `~/my/pi-stuff/config/shared/AGENTS.md`                                                            | `~/.agents/AGENTS.md` links to it; Codex and Pi link, Claude `@`-imports it from `~/.claude/CLAUDE.md`, Antigravity links via `config/antigravity/sync.sh` |
| Host-only prompt | `config/pi/APPEND_SYSTEM.md`, `config/antigravity/GEMINI.md`, the rest of `~/.claude/CLAUDE.md`    | linked or written per host                                                                                                                                 |
| Skills           | one entry per skill in `~/.agents/skills/<dir>`, a link to the skill's source                      | Claude and Antigravity: a link per skill; Codex and Pi scan `~/.agents/skills` themselves                                                                  |
| Exceptions       | `~/.config/agent-config/skills.toml`: `explicit_only`, `[exclude].<host>`, keyed by directory name | written into each host by `apply`                                                                                                                          |

Why the layout is this way, and what each host owns: `~/my/pi-stuff/config/shared/README.md`.

`ls` on this Mac is rewritten by rtk and misreports links; judge a link with `stat -f '%HT %Y' <path>` or `readlink`.

## Flow

Script: `scripts/agent-config` in this skill's directory.

1. `agent-config check`. Read every line. `FOREIGN`, `BROKEN`, and `PROMPT` lines that say `not touched`, `by hand` or `sync.sh` are a human's call; `apply` fixes the rest.
2. Change the source, never a host path: the manifest, a `~/.agents/skills` link, a prompt file in pi-stuff, or a skill's own frontmatter.
3. `agent-config apply --dry-run`; every `WOULD` line matches what you meant. Then `agent-config apply`.
4. `agent-config check` exits 0. `INFO` and `WARN` lines leave the exit code alone; read them anyway.
5. Start a new session in each host you changed and confirm there, as its reference says.

## Tasks

- **Add a skill**: install it from its source, `ln -s <source dir> ~/.agents/skills/<dir>`, then the flow.
- **Remove a skill**: delete its `~/.agents/skills/<dir>` link, then the flow; `apply` removes the host links.
- **Manual-only**: a skill you edit gets `disable-model-invocation: true` in its frontmatter (Claude, Pi and Antigravity read it; `apply` writes Codex's `openai.yaml`). An upstream skill you leave untouched goes in `explicit_only`: Claude and Codex hide it, Pi and Antigravity print `INFO` because they have no setting for it.
- **Keep a skill out of one host**: `[exclude].<host>`.
- **Edit a global prompt**: edit the source file in pi-stuff; `check` confirms every entry still points at it.
- **New machine**: restore `~/.config/agent-config/skills.toml` (not in the repo; `check` refuses to run without it), install skill sources and recreate `~/.agents/skills` links (sources: `docs/pi-shared-skills-audit-2026-11-09.md`), then the flow.
- **FOREIGN entry**: a real directory, or a link elsewhere, where a link to `~/.agents/skills` belongs. `diff -r` it against the `.agents` copy; replace it with the link only after the user agrees.

## Host details

When the task touches a host, read its reference first: [Claude Code](references/claude.md), [Codex](references/codex.md), [Pi](references/pi.md), [Antigravity](references/antigravity.md).
