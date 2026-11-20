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
- 项目里的 `.pi/APPEND_SYSTEM.md` 会整份顶替全局的 APPEND_SYSTEM.md，两者不合并；启动时带 `--append-system-prompt` 同样会跳过它。项目需要追加时，把 Pi 增量一并写进项目文件。
- KVM 重计算和 OmniWM 窗口管理是本机约定，不是 Pi 专属能力。KVM 重活由共享 skill `kvm-offload` 承担，目录布局以 KVM 上的 `~/work/README.md` 为准，skill 不缓存路径；OmniWM 在通用版保留使用原则。项目的本机环境约定写进用到它的 skill 或项目外层目录的 AGENTS.md，不进全局指令。
- 本次从 Pi 安装来源暴露的通用 skill、依赖和未导出原因见[审计清单](../../docs/pi-shared-skills-audit-2026-11-09.md)。上游目录原样保留，整个目录软链，不复制 SKILL.md。
- 含本机网络地址的 `configure-kvm-moshi-via-tailscale` 实体保留在 `~/.agents/skills`，由 Pi/Codex/Claude 软链使用；它和项目外层的本机环境说明均不进入公开仓库，换机器时私下恢复。
- Pi 扩展、工具注册、MCP、模型、认证、UI 和宿主生命周期配置仍归 Pi。通用 skill 可读不等于宿主具备其调用的工具；使用前按 skill 的前置条件核对。
- show-me 保留[既有两个版本](../../skills/README.md)：共享版保持显式调用策略，Pi 版保留自动发现和原生渲染适配。

## 恢复

先按原来源安装 skill 与所需工具，再链接；软链指向的源必须存在。下面是尚未建立入口时的命令，已有文件先对比合并，不直接覆盖：

```sh
ln -s ~/my/pi-stuff/config/shared/AGENTS.md ~/.agents/AGENTS.md
ln -s ~/my/pi-stuff/config/shared/AGENTS.md ~/.pi/agent/AGENTS.md
ln -s ~/my/pi-stuff/config/pi/APPEND_SYSTEM.md ~/.pi/agent/APPEND_SYSTEM.md
```

各 skill 的源路径见审计清单；目录软链例如：

```sh
ln -s ~/.pi/agent/npm/node_modules/@howaboua/pi-skill-skill-creator/skills/skill-creator ~/.agents/skills/skill-creator
ln -s ../../.agents/skills/skill-creator ~/.codex/skills/skill-creator
ln -s ../../.agents/skills/skill-creator ~/.claude/skills/skill-creator
```

这些入口只在当前机器生效；换机器需重新安装来源并调整路径。卸载 Pi 包或移动仓库会使相应软链失效。更新后重开目标 agent 会话；现有会话已经加载的指令不会自动刷新。
