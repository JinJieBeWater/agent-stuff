# Antigravity

- Reads skills from `~/.gemini/config/skills`; each skill needs a link there. `apply` creates `../../../.agents/skills/<dir>`. T3 Code's Antigravity profiles link that whole directory, so they follow.
- `ryugi-*` links in that directory come from the Ryugi plugin import (`~/.gemini/config/plugins/ryugi`); `agent-config` ignores them.
- Honors frontmatter `disable-model-invocation: true` (the agy binary parses it). No setting hides a skill otherwise; `explicit_only` names show as `INFO antigravity`.
- `config/antigravity/sync.sh` owns `~/.gemini/GEMINI.md`, `~/.gemini/config/AGENTS.md`, the `lean` agent, T3 profiles, MCP and the swarm plugin switch. `check` reports those entries; fix them by running `sync.sh`, also after T3 creates a new Antigravity profile.

## Verify

Start a new `agy` session and ask it to list its skills; no non-interactive listing has been verified yet.
