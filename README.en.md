# agent-stuff

[简体中文](README.md) | [English](README.en.md)

Personal coding-agent toolkit and configuration repository containing [Pi](https://github.com/earendil-works/pi) extensions, cross-agent skills, an Antigravity and T3 Code MCP wrapper, and shared configuration.

[Repository layout](#repository-layout) · [Pi extensions](#pi-extensions) · [Cross-agent skills](#cross-agent-skills) · [Antigravity and T3 MCP wrapper](#antigravity-and-t3-mcp-wrapper) · [Shared and personal configuration](#shared-and-personal-configuration) · [Installation](#installation) · [Development](docs/development.en.md)

## Repository layout

| Directory                                    | Contents                                                                             | Distribution                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| [`packages/`](packages/)                     | Nine Pi extensions and the shared TypeScript config `@agent-stuff/config`            | Bundled in the root Pi Git package      |
| [`skills/`](skills/)                         | Seven shared skills (`skills/shared/`) and the Pi `show-me` variant (`skills/pi/`)   | Only `skills/pi/show-me` is bundled     |
| [`config/antigravity/`](config/antigravity/) | Antigravity ACP and T3 MCP wrapper scripts, lean agent profile, and sync script      | Synced via `config/antigravity/sync.sh` |
| [`config/shared/`](config/shared/)           | Shared global instructions for Codex, Claude Code, Pi, and Antigravity               | Wired by symlinks and `agent-config`    |
| [`config/pi/`](config/pi/)                   | Pi-only appended instructions, extension JSON, Shepherdr profiles, settings snapshot | Symlinked or merged manually            |
| [`config/ryugi/`](config/ryugi/)             | Local `ryugi-maintain` update and doctor wrapper                                     | Run manually on this machine            |
| [`config/rpiv-todo/`](config/rpiv-todo/)     | Task tracking guidance config for `rpiv-todo`                                        | Copied or symlinked manually            |
| [`docs/`](docs/)                             | Development guide, local setup inventory, and dated audit notes                      | Documentation only                      |

## Pi extensions

| Extension                                                            | Purpose                                                                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [pi-borderless-tables](packages/pi-borderless-tables/README.en.md)   | Display aligned tables without borders                                                                      |
| [pi-herdr-session-move](packages/pi-herdr-session-move/README.en.md) | Move the current Pi conversation to another existing directory                                              |
| [pi-herdr-tab-title](packages/pi-herdr-tab-title/README.en.md)       | Sync Pi tab names in Herdr Core/App                                                                         |
| [pi-herdr-theme](packages/pi-herdr-theme/README.en.md)               | Make Pi follow the Herdr App theme, palette included                                                        |
| [pi-auto-session-title](packages/pi-auto-session-title/README.en.md) | Maintain session titles with language selection, custom prompts, model fallback, and Apple on-device models |
| [pi-drop-session](packages/pi-drop-session/README.en.md)             | Start a new session and send the previous session file to the trash                                         |
| [pi-context-policy](packages/pi-context-policy/README.en.md)         | Select prompts, managed extensions, tools, and skills for the current environment                           |
| [pi-tool-exposure](packages/pi-tool-exposure/README.en.md)           | Control direct versus deferred tool exposure through native package discovery                               |
| [pi-skill-discovery](packages/pi-skill-discovery/README.en.md)       | Show only configured core skills upfront and find the rest on demand through `skill_search`                 |

The root [package.json](package.json) declares these nine extensions and `skills/pi/show-me` as a single Pi Git package.

## Cross-agent skills

| Skill                                                                                 | Purpose                                                                                                              |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [agent-config](skills/shared/agent-config/SKILL.md)                                   | Keep skill symlinks, manual-only policies, and prompt entries aligned across Claude Code, Codex, Pi, and Antigravity |
| [babysit-pr](skills/shared/babysit-pr/SKILL.md)                                       | Follow a GitHub or Gitea pull request through CI and review until ready                                              |
| [diagnose-pi-internals](skills/shared/diagnose-pi-internals/SKILL.md)                 | Diagnose Pi runtime faults from any host                                                                             |
| [herdr-session-recovery](skills/shared/herdr-session-recovery/SKILL.md)               | Recover saved Herdr Core agent sessions, parent links, and attention state after a reboot                            |
| [jinit](skills/shared/jinit/SKILL.md)                                                 | Set up a project outer folder, `.workspace` symlink, and project `AGENTS.md`                                         |
| [pi-magpie-same-model-failover](skills/shared/pi-magpie-same-model-failover/SKILL.md) | Configure and verify Magpie fallback within the selected model in Pi                                                 |
| [show-me (shared)](skills/shared/show-me/SKILL.md)                                    | Explain concepts with code sketches, Mermaid diagrams, or focused HTML on explicit invocation                        |
| [show-me (Pi)](skills/pi/show-me/SKILL.md)                                            | Variant bundled in the root Pi package with automatic discovery and Pi rendering notes                               |

See the [Skills guide](skills/README.en.md) for invocation rules, drawing dependencies, and attribution for both `show-me` variants.

## Antigravity and T3 MCP wrapper

[`config/antigravity/`](config/antigravity/) wraps Antigravity when T3 Code launches it so version selection, tool scoping, and MCP lazy loading work predictably:

- `bin/antigravity` and `acp-wrapper.mjs` locate the newest Antigravity binary, pass `--agent lean` when `agents/lean.md` is present, and write the T3 MCP launch spec to a state file for the local shim before the session starts.
- `bin/t3-mcp-shim` and `t3-mcp-shim.mjs` run as the `t3-code` stdio MCP server in each profile's `mcp_config.json`. The shim forwards JSON-RPC requests to T3's HTTP/SSE endpoint or falls back to a bridge process, so Antigravity applies native lazy loading along with `eagerTools` and `disabledTools` from `t3-tools.json`.
- `GEMINI.md` holds Antigravity-specific instructions.
- `sync.sh` links global instructions, the shared skills directory, the `lean` agent, `mcp_config.json`, and the disabled `swarm` plugin config into `~/.gemini` and `~/.t3/userdata/providers/antigravity/*`. Pass `--apply-t3-binary` when no Antigravity turn is running to point `binaryPath` in `~/.t3/userdata/settings.json` at the wrapper.

[`test/antigravity-t3-wrapper.test.ts`](test/antigravity-t3-wrapper.test.ts) tests the wrapper and shim behavior.

## Shared and personal configuration

- [Cross-agent setup](config/shared/README.md) (Chinese): [`config/shared/AGENTS.md`](config/shared/AGENTS.md) is the single source of global instructions for Codex, Claude Code, Pi, and Antigravity. [`skills/shared/agent-config/scripts/agent-config`](skills/shared/agent-config/scripts/agent-config) checks and repairs host links and manual-only rules against `~/.config/agent-config/skills.toml`, which stays outside the repo.
- [Personal Pi configuration](config/README.en.md): [`config/pi/`](config/pi/) holds Pi-only `APPEND_SYSTEM.md`, extension JSON configs, Shepherdr role profiles, and a snapshot of `settings.json`. See the [personal setup](docs/personal-setup.en.md) for third-party packages used on this machine.
- [Ryugi maintenance](config/ryugi/README.md): `config/ryugi/ryugi-maintain` updates and verifies local Ryugi integrations while narrowing Codex marketplace queries to avoid remote timeouts.
- `config/rpiv-todo/config.json` stores task tracking guidance without task data.

Nothing under `config/` installs automatically with `pi install`. Symlink or merge files per machine.

## Installation

To install the nine Pi extensions and Pi `show-me`, make sure Pi and Git are installed. Pi downloads the source and handles runtime dependencies without manual cloning or Bun:

```sh
pi install git:github.com/JinJieBeWater/agent-stuff
pi config
```

Default installation registers only the nine Pi extensions and `skills/pi/show-me`. It excludes `skills/shared/`, `config/`, and the third-party packages listed in [personal setup](docs/personal-setup.en.md). Disable unneeded entries in `pi config`, then run `/reload` in an idle session or start a new one. Avoid loading this Git package alongside local paths for the same extensions or skill, because both will register.

### Selecting extensions and configuration

You can filter entries directly in `packages` inside your Pi `settings.json`. For example, to enable only `/drop` and disable bundled skills:

```json
{
  "source": "git:github.com/JinJieBeWater/agent-stuff",
  "extensions": ["packages/pi-drop-session/index.ts"],
  "skills": []
}
```

Omitting `extensions` or `skills` loads all entries of that type; `[]` disables that type.

Configurable extensions read matching JSON files from `~/.pi/agent/`, or from `PI_CODING_AGENT_DIR` when set. Every JSON file is optional. See each extension README for defaults and limits:

- [Session move](packages/pi-herdr-session-move/README.en.md): uses `hc` to move a conversation in an interactive Herdr Core terminal.
- [Tab titles](packages/pi-herdr-tab-title/README.en.md): syncs the Pi session name to the Herdr App tab connected to its Core terminal.
- [Automatic titles](packages/pi-auto-session-title/README.en.md): reads `auto-session-title.json`. Disable duplicate title extensions in other packages before enabling it.
- [`/drop`](packages/pi-drop-session/README.en.md): requires a trusted trash command and searches `PATH` for `trash` by default.
- [Skill discovery](packages/pi-skill-discovery/README.en.md): keeps the core list empty by default, so auto-invocable skills are found on demand while native `/skill:name` commands keep working.

Run `/reload` or restart Pi after editing JSON or package filters.

### Update and uninstall

```sh
pi update git:github.com/JinJieBeWater/agent-stuff
pi remove git:github.com/JinJieBeWater/agent-stuff
```

Packages installed with `@tag` or `@commit` remain pinned on updates. `pi remove` removes the package and keeps user JSON configs in place. Run `/reload` or restart Pi afterward.

This repository has no npm release. See the [development guide](docs/development.en.md) for local loading, checks, and tests.

## License

No repository-wide open-source license has been assigned yet. Adapted components retain their upstream MIT licenses:

- `pi-auto-session-title` is adapted from `angristan/pi-extensions`; see its [extension README](packages/pi-auto-session-title/README.en.md#source-and-license).
- `show-me` is based on HumanLayer's original skill; see the [Skills guide](skills/README.en.md#source-and-license).
- `babysit-pr` is based on `t3dotgg/tstack`; see [`skills/shared/babysit-pr/LICENSE`](skills/shared/babysit-pr/LICENSE).

Third-party dependencies keep their own licenses.
