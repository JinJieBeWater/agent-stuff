# 跨 agent 的个人配置

全局指令源是 [AGENTS.md](AGENTS.md)，Codex、Claude Code、Pi、Antigravity 共用这一份。宿主专属补充分别写在 [APPEND_SYSTEM.md](../pi/APPEND_SYSTEM.md)（Pi）、[GEMINI.md](../antigravity/GEMINI.md)（Antigravity）和 `~/.claude/CLAUDE.md`（Claude Code）。

```text
~/.codex/AGENTS.md ────────────软链──┐
~/.claude/CLAUDE.md ──────────@导入──┴─→ ~/.agents/AGENTS.md → config/shared/AGENTS.md
~/.pi/agent/AGENTS.md ─────────软链────→ config/shared/AGENTS.md
~/.pi/agent/APPEND_SYSTEM.md ──软链────→ config/pi/APPEND_SYSTEM.md
~/.gemini/config/AGENTS.md ────软链────→ config/shared/AGENTS.md（由 sync.sh 同步到 T3 profiles）
~/.gemini/GEMINI.md ───────────软链────→ config/antigravity/GEMINI.md

~/.agents/skills/<name>/ → 原 skill 目录（含 references、scripts 等）
```

## 边界与坑

- 共同规则只写在 `config/shared/AGENTS.md`，写成宿主无关的说法；只在某个宿主成立的工具和路径写进宿主专属文件，不重复。
- 测试、代码风格、项目文档和 PR 格式只在项目 `AGENTS.md`（由 [jinit 模板](../../skills/shared/jinit/assets/AGENTS.md)带入），全局只留对所有任务都成立的规则。没有项目 `AGENTS.md` 的仓库会退回 Ryugi 默认的每处先写测试、每次跑全套。
- 项目里的 `.pi/APPEND_SYSTEM.md` 会整份顶替全局 `APPEND_SYSTEM.md`，两者不合并；带 `--append-system-prompt` 启动同样跳过它。
- 上游 skill 整个目录软链进 `~/.agents/skills/`，不复制 `SKILL.md`；含本机或私有信息的 skill 留在本地，不入库。`skills/shared/show-me` 保持显式调用（`disable-model-invocation: true`）。
- `config/pi/` 下的文件均为 `~/.pi/agent/` 的软链源（恢复用 `ln -s ~/my/agent-stuff/config/pi/<路径> ~/.pi/agent/<路径>`）。

## 恢复

先安装各 skill 来源并软链进 `~/.agents/skills/<目录名>`：

| 共享 skill                                                                                                                             | 来源路径                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `agent-config`、`babysit-pr`、`diagnose-pi-internals`、`herdr-session-recovery`、`jinit`、`pi-magpie-same-model-failover`、`show-me`   | `~/my/agent-stuff/skills/shared/<name>`                                                       |
| `skill-creator`                                                                                                                        | `~/.pi/agent/npm/node_modules/@howaboua/pi-skill-skill-creator/skills/skill-creator`          |
| `adversarial-qa`                                                                                                                       | `~/.pi/agent/npm/node_modules/@howaboua/pi-skill-adversarial-qa/skills/adversarial-qa`        |
| `agent-session-diagnostics`、`agent-tool-design`、`extension-design`、`harness-checklist`、`instruction-calibration`、`prompt-caching` | `~/.pi/agent/npm/node_modules/@howaboua/pi-skill-harness-and-agent-engineering/skills/<name>` |
| `ponytail-review`                                                                                                                      | `~/.pi/agent/git/github.com/DietrichGebert/ponytail/skills/ponytail-review`                   |
| `file-pr`、`full-send`、`full-stop`、`leaving-pr-comments`、`modernize`、`sol-loop`、`takeover`                                        | `~/.local/share/agent-sources/tstack/skills/<name>`                                           |

随后运行 `skills/shared/agent-config/scripts/agent-config check` 与 `apply` 补齐各宿主链接、仅手动调用策略和提示词入口（例外名单在 `~/.config/agent-config/skills.toml`，不入库）。Antigravity 的 `GEMINI.md`、T3 profiles 和 MCP 由 `config/antigravity/sync.sh` 同步。变更后重开对应 agent 会话生效。
