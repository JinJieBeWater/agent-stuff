# Pi

- Scans `~/.agents/skills` directly; Pi-only skills live in `~/.pi/agent/skills`. No links needed.
- Honors frontmatter `disable-model-invocation: true` (`disableModelInvocation` in pi-coding-agent's skill loader) and nothing else; it ignores `agents/openai.yaml` and has no setting that hides a skill but keeps it callable. `explicit_only` names show as `INFO pi`.
- `[exclude].pi` becomes `-<absolute path>/.agents/skills/<dir>` entries in the `skills` array of `~/.pi/agent/settings.json`. `apply` owns only `-` entries under `~/.agents/skills`; other entries stay in place. Pi writes that file without a trailing newline and `apply` keeps it that way.
- `config/pi/pi-skill-discovery.json` `coreSkills` decides which skills Pi lists up front; the rest are reached through skill search. A skill missing from the first listing is not missing.
- Prompts: `~/.pi/agent/AGENTS.md` links to `config/shared/AGENTS.md`, `~/.pi/agent/APPEND_SYSTEM.md` to `config/pi/APPEND_SYSTEM.md`. A project's `.pi/APPEND_SYSTEM.md` replaces the global one (see `config/shared/README.md`).

## Verify

`/reload` in an idle session, or start a new one, then ask Pi to list or search for the skill.
