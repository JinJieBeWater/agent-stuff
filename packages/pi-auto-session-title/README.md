# pi-auto-session-title

自动维护 Pi 会话标题与隐藏焦点摘要；手动改名后暂停，`/title-refresh` 恢复，`/title-status` 查看状态，启动加 `--no-auto-title` 仅对当前进程关闭。

## 注意事项

- 配置文件为 `~/.pi/agent/auto-session-title.json`（遵循 `PI_CODING_AGENT_DIR`），支持多模型按顺序回退与自定义 `systemPrompt`。
- 若已安装 `angristan/pi-extensions`，停用其中的 `extensions/auto-session-title/index.ts`，避免两套实现同时改标题。
- Apple 端侧模型后端（`provider: "apple-foundation-models"`）需要 Apple Silicon、macOS 26+、Apple Intelligence 和本地 Swift 工具链。

## 来源与许可

改编自 [angristan/pi-extensions](https://github.com/angristan/pi-extensions/tree/81cf729923d408411dd5ea65650841332f3c314a/extensions/auto-session-title) 提交 `81cf729`。Copyright (c) 2025 Stanislas Lange；MIT 许可证见 [LICENSE](LICENSE)。
