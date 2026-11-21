# agent-stuff

[简体中文](README.md) | [English](README.en.md)

个人 coding agent 工具箱与配置仓库，包含 [Pi](https://github.com/earendil-works/pi) 扩展、跨宿主共享 Skills、Antigravity 与 T3 Code 的 MCP 包装层，以及共享和本机配置。

[目录结构](#目录结构) · [Pi 扩展](#pi-扩展) · [跨 Agent Skills](#跨-agent-skills) · [Antigravity 与 T3 MCP 包装层](#antigravity-与-t3-mcp-包装层) · [共享与个人配置](#共享与个人配置) · [安装](#安装) · [开发指南](docs/development.md)

## 目录结构

| 目录                                         | 内容                                                                        | 分发方式                             |
| -------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------ |
| [`packages/`](packages/)                     | 9 个 Pi 扩展包与共享 TypeScript 配置 `@agent-stuff/config`                  | 随根 `package.json` 的 Pi 包分发     |
| [`skills/`](skills/)                         | 7 个跨宿主共享 Skills（`skills/shared/`）与 Pi 版 `show-me`（`skills/pi/`） | 根 Pi 包只注册 `skills/pi/show-me`   |
| [`config/antigravity/`](config/antigravity/) | Antigravity 的 ACP 与 T3 MCP 包装脚本、精简 agent 配置与同步脚本            | 由 `config/antigravity/sync.sh` 同步 |
| [`config/shared/`](config/shared/)           | Codex、Claude Code、Pi、Antigravity 共用的全局指令源文件                    | 通过软链和 `agent-config` 接入       |
| [`config/pi/`](config/pi/)                   | Pi 专属追加指令、扩展 JSON 配置、Shepherdr 预设和 `settings.json` 快照      | 按需软链或对比合并                   |
| [`config/ryugi/`](config/ryugi/)             | 本机 `ryugi-maintain` 更新与检查脚本                                        | 本机手动使用                         |
| [`config/rpiv-todo/`](config/rpiv-todo/)     | `rpiv-todo` 的任务追踪指引配置                                              | 本机手动使用                         |
| [`docs/`](docs/)                             | 开发指南与本机个人配置清单                                                  | 文档参考                             |

## Pi 扩展

| 扩展                                                    | 用途                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| [pi-borderless-tables](packages/pi-borderless-tables)   | 无框对齐表格                                                     |
| [pi-herdr-session-move](packages/pi-herdr-session-move) | 把当前 Pi 对话搬到另一个已有目录                                 |
| [pi-herdr-tab-title](packages/pi-herdr-tab-title)       | 在 Herdr Core/App 中同步 Pi 标签页名称                           |
| [pi-herdr-theme](packages/pi-herdr-theme)               | 让 Pi 配色跟随 Herdr App 主题，含调色板                          |
| [pi-auto-session-title](packages/pi-auto-session-title) | 自动维护会话标题，支持用户语言、自定义提示词、模型回退和端侧模型 |
| [pi-drop-session](packages/pi-drop-session)             | 新建会话后将旧会话文件移至废纸篓                                 |
| [pi-context-policy](packages/pi-context-policy)         | 按运行环境选择提示词、托管扩展、工具和 Skill                     |
| [pi-tool-exposure](packages/pi-tool-exposure)           | 按配置调整工具暴露方式，用原生 package discovery 查找入口        |
| [pi-skill-discovery](packages/pi-skill-discovery)       | 只在系统提示词中展示核心 Skill，其余通过 `skill_search` 按需查找 |

这 9 个扩展和 `skills/pi/show-me` 一起声明在根 [package.json](package.json) 中，作为单个 Pi Git package 分发。

## 跨 Agent Skills

| Skill                                                                                 | 用途                                                                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [agent-config](skills/shared/agent-config/SKILL.md)                                   | 跨 Claude Code、Codex、Pi 和 Antigravity 维护 skill 软链、仅手动调用策略和提示词入口 |
| [babysit-pr](skills/shared/babysit-pr/SKILL.md)                                       | 跟进 GitHub 和 Gitea PR 的 CI 与审查直到就绪                                         |
| [diagnose-pi-internals](skills/shared/diagnose-pi-internals/SKILL.md)                 | 从任意宿主排查 Pi 运行时故障                                                         |
| [herdr-session-recovery](skills/shared/herdr-session-recovery/SKILL.md)               | 重启后恢复 Herdr Core 保存的会话、层级关系和关注状态                                 |
| [jinit](skills/shared/jinit/SKILL.md)                                                 | 初始化项目外层文件夹、`.workspace` 软链和项目级 `AGENTS.md`                          |
| [pi-magpie-same-model-failover](skills/shared/pi-magpie-same-model-failover/SKILL.md) | 在 Pi 中配置并验证 Magpie 同型号后备                                                 |
| [show-me（通用）](skills/shared/show-me/SKILL.md)                                     | 用代码草图、Mermaid 图或聚焦 HTML 解释概念，仅显式调用                               |
| [show-me（Pi）](skills/pi/show-me/SKILL.md)                                           | 随根 Pi 包注册的版本，支持自动发现并附带 Pi 原生渲染说明                             |

两版 `show-me` 的差异、调用方式和绘图依赖见 [Skills 说明](skills/README.md)。

## Antigravity 与 T3 MCP 包装层

[`config/antigravity/`](config/antigravity/) 解决 T3 Code 调用 Antigravity 时的二进制版本选择、精简工具集和 MCP 工具加载问题：

- `bin/antigravity` 与 `acp-wrapper.mjs` 包装实际的 Antigravity 可执行文件，选择最新版本，按需附加 `--agent lean`（定义在 `agents/lean.md`），并在会话建立前把 T3 下发的 MCP 启动配置写入状态文件交给本地 shim。
- `bin/t3-mcp-shim` 与 `t3-mcp-shim.mjs` 在 profile 的 `mcp_config.json` 中注册为 `t3-code` stdio MCP server，把 JSON-RPC 请求转发给 T3 的 HTTP/SSE 端点或在必要时拉起桥接进程，让 Antigravity 原生的工具懒加载生效，并按 `t3-tools.json` 配置 `eagerTools` 和 `disabledTools`。
- `GEMINI.md` 存放 Antigravity 专属补充规则。
- `sync.sh` 把全局指令、技能目录、`lean` agent、`mcp_config.json` 和关闭 `swarm` 插件的配置同步到 `~/.gemini` 与 `~/.t3/userdata/providers/antigravity/*`。传入 `--apply-t3-binary` 时再写入 `~/.t3/userdata/settings.json` 中的 `binaryPath`，执行前需确认当前没有运行中的 Antigravity 回合。

该包装层的行为由 [`test/antigravity-t3-wrapper.test.ts`](test/antigravity-t3-wrapper.test.ts) 覆盖验证。

## 共享与个人配置

- [跨 agent 配置](config/shared/README.md)：[`config/shared/AGENTS.md`](config/shared/AGENTS.md) 是 Codex、Claude Code、Pi 和 Antigravity 共用的全局指令源。日常的软链同步、仅手动调用策略和漂移检查由 [`skills/shared/agent-config/scripts/agent-config`](skills/shared/agent-config/scripts/agent-config) 执行，本机例外清单放在 `~/.config/agent-config/skills.toml`，不入库。
- [个人 Pi 配置](config/README.md)：[`config/pi/`](config/pi/) 保留 Pi 专属的 `APPEND_SYSTEM.md`、核心扩展 JSON、Shepherdr 角色预设，以及本机 `settings.json` 快照。本机启用的第三方包清单见[个人配置清单](docs/personal-setup.md)。
- [Ryugi 维护脚本](config/ryugi/README.md)：`config/ryugi/ryugi-maintain` 更新并检查本机 Ryugi 集成，避免 Codex 远程插件目录拉取超时。
- `config/rpiv-todo/config.json` 保存任务追踪指引，不含任务数据。

`config/` 下的所有文件都不会随 `pi install` 自动加载，按目标机器需要软链或对比合并。

## 安装

只安装 Pi 扩展和 Pi 版 `show-me` 时，需要已安装 Pi 和 Git。Pi 会自行下载源码并处理运行依赖，无需手动 clone 或安装 Bun：

```sh
pi install git:github.com/JinJieBeWater/agent-stuff
pi config
```

默认启用全部 9 个 Pi 扩展和 `skills/pi/show-me`，不会安装 `skills/shared/`、`config/` 或[个人配置清单](docs/personal-setup.md)中的第三方包。在 `pi config` 中关闭不需要的入口，随后在已有会话执行 `/reload` 或重开会话。不要同时加载这个 Git package 和同一扩展或 Skill 的本地目录入口，避免重复注册。

### 选择扩展与配置

也可直接编辑 Pi 用户目录 `settings.json` 中本包的 `packages` 条目。例如只启用 `/drop` 并停用本包 Skills：

```json
{
  "source": "git:github.com/JinJieBeWater/agent-stuff",
  "extensions": ["packages/pi-drop-session/index.ts"],
  "skills": []
}
```

省略 `extensions` 或 `skills` 时加载该类型的全部入口，设为 `[]` 时停用该类型。

配置型扩展从 Pi 用户目录读取同名 JSON，默认为 `~/.pi/agent/`，遵循 `PI_CODING_AGENT_DIR`。配置文件均可省略，具体字段和限制见各扩展 README：

- [会话搬迁](packages/pi-herdr-session-move/README.md#使用)：在 Herdr Core 交互终端中通过 `hc` 搬迁。
- [标签页名称](packages/pi-herdr-tab-title/README.md)：把 Pi 会话名称同步到连接该 Core 终端的 Herdr App 标签页。
- [自动标题](packages/pi-auto-session-title/README.md)：读取 `auto-session-title.json`，启用前停用其他包中的同名扩展。
- [`/drop`](packages/pi-drop-session/README.md#使用)：需要可信的回收站命令，默认从 `PATH` 查找 `trash`。
- [Skill 发现](packages/pi-skill-discovery/README.md#配置)：默认核心名单为空，所有可自动调用的 Skills 都按需查找，原生 `/skill:name` 保持可用。

修改 JSON 或包过滤后，执行 `/reload` 或重开会话。

### 更新与卸载

```sh
pi update git:github.com/JinJieBeWater/agent-stuff
pi remove git:github.com/JinJieBeWater/agent-stuff
```

使用 `@tag` 或 `@commit` 安装时，`pi update` 会停留在指定引用。`pi remove` 只移除 package，保留用户目录下的 JSON 配置。操作完成后执行 `/reload` 或重开会话。

本仓库未发布 npm 包。源码开发、本地加载、检查命令和测试说明见[开发指南](docs/development.md)。

## 许可

仓库暂未指定整体开源许可证。部分内容保留上游 MIT 许可：

- `pi-auto-session-title` 改编自 `angristan/pi-extensions`，来源与 MIT 许可见 [扩展说明](packages/pi-auto-session-title/README.md#来源与许可证)。
- `show-me` 基于 HumanLayer 原始 Skill，来源与 MIT 许可见 [Skills 说明](skills/README.md#来源和许可)。
- `babysit-pr` 基于 `t3dotgg/tstack`，原始 MIT 许可见 [`skills/shared/babysit-pr/LICENSE`](skills/shared/babysit-pr/LICENSE)。

第三方依赖遵循各自许可证。
