# agent-stuff

个人 coding agent 工具箱与配置仓库。

## 内容

- `packages/`：9 个 [Pi](https://github.com/earendil-works/pi) 扩展和共享 TypeScript 配置 `@agent-stuff/config`。扩展声明在根 [package.json](package.json)，作为单个 Pi Git package 分发。
- `skills/shared/`：7 个跨宿主共享 Skills，不参与根 Pi 包发现。
- `config/antigravity/`：T3 Code 调起 Antigravity 时的包装脚本（`acp-wrapper.mjs`、`t3-mcp-shim.mjs`、`t3-tools.json`、`agents/lean.md`、`GEMINI.md`），通过 `config/antigravity/sync.sh` 同步到 `~/.gemini` 与 T3 profiles。
- `config/shared/`、`config/pi/`、`config/ryugi/`：跨宿主全局指令、Pi 软链配置文件和本机维护脚本。不随 `pi install` 安装；软链拓扑与恢复见 [config/shared/README.md](config/shared/README.md)。

## 安装 Pi 包

需要已安装 Pi 和 Git：

```sh
pi install git:github.com/JinJieBeWater/agent-stuff
pi config
```

如需在 `~/.pi/agent/settings.json` 中只启用部分入口，可在 `packages` 中指定 `extensions` 或 `skills`（`[]` 表示停用该类）：

```json
{
  "source": "git:github.com/JinJieBeWater/agent-stuff",
  "extensions": ["packages/pi-drop-session/index.ts"],
  "skills": []
}
```

配置型扩展从 `~/.pi/agent/`（遵循 `PI_CODING_AGENT_DIR`）读取同名 JSON，文件均可选。不要同时加载 Git package 和同一扩展的本地目录入口，也不要把被 `pi-context-policy` / `pi-tool-exposure` 托管的包留在原生入口中。修改后执行 `/reload` 或重开会话。

更新与卸载：

```sh
pi update git:github.com/JinJieBeWater/agent-stuff
pi remove git:github.com/JinJieBeWater/agent-stuff
```

## 许可

仓库暂未指定整体开源许可证。改编部分保留上游 MIT 许可：

- `packages/pi-auto-session-title`：改编自 `angristan/pi-extensions`，见 [LICENSE](packages/pi-auto-session-title/LICENSE)。
- `skills/shared/show-me`：基于 HumanLayer 原始 Skill，见 [LICENSE](skills/shared/show-me/LICENSE)。
- `skills/shared/babysit-pr`：基于 `t3dotgg/tstack`，见 [LICENSE](skills/shared/babysit-pr/LICENSE)。
