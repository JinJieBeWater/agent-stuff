# 跨 agent 的个人配置

通用指令源是本目录的 [AGENTS.md](AGENTS.md)，Codex、Claude、Pi 共用这一份。Pi 专属的工具和路径写在 [APPEND_SYSTEM.md](../pi/APPEND_SYSTEM.md)，由 Pi 原生追加到系统提示词。

```text
~/.codex/AGENTS.md ──软链──┐
~/.claude/CLAUDE.md ─@导入──┴─→ ~/.agents/AGENTS.md → config/shared/AGENTS.md
~/.pi/agent/AGENTS.md ─────────软链─→ config/shared/AGENTS.md
~/.pi/agent/APPEND_SYSTEM.md ──软链─→ config/pi/APPEND_SYSTEM.md（Pi 增量）

~/.agents/skills/<name>/ → 原 skill 目录（含 references、scripts 等）
```

宿主不一定自动读取 `~/.agents/AGENTS.md`。需要时在其全局指令或项目 AGENTS.md 中加入：

```markdown
始终读取并遵循 `~/.agents/AGENTS.md`。
```

共享目录提供标准 skill 包，宿主原有的加载与调用方式保持不变；通用指令只保留明确的 skill 使用要求。通用 skill 维护在 `~/.agents/skills`，宿主专属的留在宿主目录，项目私有的留在项目目录；镜像用软链，同名同用途只维护一份。

## 本机整理与边界

- 共同规则只写在 AGENTS.md，写成任何宿主都能执行的说法：skill 用 `~/.agents/skills/<name>/SKILL.md` 路径引用，提问约定不绑定工具名称。只在 Pi 成立的工具名和路径写进 APPEND_SYSTEM.md，不在两处重复同一条。通用版不规定 skill 搜索或兜底查找机制，也不引入 Ryugi、Ponytail 的整套工作流。
- 写测试、代码风格、项目文档和 PR 格式的约定只在项目 AGENTS.md 里，由 [jinit 模板](../../skills/shared/jinit/assets/AGENTS.md)带入，全局只留对所有任务都成立的规则。坑：Ryugi 在各宿主都是 full 模式，没有这份项目文件的仓库会按 `ryugi:test-driven-development` 的默认来，也就是每处改动先写测试、每次跑全套。
- 项目里的 `.pi/APPEND_SYSTEM.md` 会整份顶替全局的 APPEND_SYSTEM.md，两者不合并；启动时带 `--append-system-prompt` 同样会跳过它。项目需要追加时，把 Pi 增量一并写进项目文件。
- KVM 重计算和 OmniWM 窗口管理是本机约定，不是 Pi 专属能力。KVM 重活由共享 skill `kvm-offload` 承担，目录布局以 KVM 上的 `~/work/README.md` 为准，skill 不缓存路径；OmniWM 在通用版保留使用原则。项目的本机环境约定写进用到它的 skill 或项目外层目录的 AGENTS.md，不进全局指令。
- 上游 skill 目录原样保留，整个目录软链进 `~/.agents/skills/`，不复制 `SKILL.md`。含本机或私有信息的 skill 留在机器本地，不进入公开仓库。
- Pi 扩展、工具注册、MCP、模型、认证、UI 和宿主生命周期配置仍归 Pi。通用 skill 可读不等于宿主具备其调用的工具；使用前按 skill 的前置条件核对。
- `skills/shared/show-me` 保持显式调用策略（`disable-model-invocation: true`）。
- `config/pi/` 下的文件均为 `~/.pi/agent/` 的软链源文件（恢复用 `ln -s ~/my/agent-stuff/config/pi/<路径> ~/.pi/agent/<路径>`）。

## 恢复

先按原来源安装 skill 与所需工具，把每个 skill 软链进 `~/.agents/skills/<目录名>`：

| 共享 skill                                                                                                                             | 来源路径                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `agent-config`、`babysit-pr`、`diagnose-pi-internals`、`herdr-session-recovery`、`jinit`、`pi-magpie-same-model-failover`、`show-me`   | `~/my/agent-stuff/skills/shared/<name>`                                                       |
| `skill-creator`                                                                                                                        | `~/.pi/agent/npm/node_modules/@howaboua/pi-skill-skill-creator/skills/skill-creator`          |
| `adversarial-qa`                                                                                                                       | `~/.pi/agent/npm/node_modules/@howaboua/pi-skill-adversarial-qa/skills/adversarial-qa`        |
| `agent-session-diagnostics`、`agent-tool-design`、`extension-design`、`harness-checklist`、`instruction-calibration`、`prompt-caching` | `~/.pi/agent/npm/node_modules/@howaboua/pi-skill-harness-and-agent-engineering/skills/<name>` |
| `ponytail-review`                                                                                                                      | `~/.pi/agent/git/github.com/DietrichGebert/ponytail/skills/ponytail-review`                   |
| `file-pr`、`full-send`、`full-stop`、`leaving-pr-comments`、`modernize`、`sol-loop`、`takeover`                                        | `~/.local/share/agent-sources/tstack/skills/<name>`                                           |

例如：

```sh
ln -s ~/.pi/agent/npm/node_modules/@howaboua/pi-skill-skill-creator/skills/skill-creator ~/.agents/skills/skill-creator
```

其余入口交给 [agent-config](../../skills/shared/agent-config/SKILL.md)：`skills/shared/agent-config/scripts/agent-config check` 列出缺的宿主链接、仅手动调用策略和提示词入口，`apply` 补齐其中归它管的部分，已有的普通文件和指向别处的链接只报告不覆盖。例外名单在 `~/.config/agent-config/skills.toml`，不入库。Antigravity 的 GEMINI.md、T3 profile 和 MCP 仍由 `config/antigravity/sync.sh` 处理。

这些入口只在当前机器生效；换机器需重新安装来源并调整路径。卸载 Pi 包或移动仓库会使相应软链失效。更新后重开目标 agent 会话；现有会话已经加载的指令不会自动刷新。
