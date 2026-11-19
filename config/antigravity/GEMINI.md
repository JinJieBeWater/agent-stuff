@[using-ryugi](~/.local/share/ryugi/install/plugins/agy/plugin/skills/using-ryugi/SKILL.md)

- 平台工具映射以 `references/antigravity-tools.md` 为准，文件写入与修改使用 `write_file`、`edit_file`（替代已废弃的 `write_to_file`、`replace_file_content`）；加载 skill 时直接 `read_file` 对应 `SKILL.md`。
- 常规终端命令调用 `run_command` 时设 `WaitMsBeforeAsync: 10000`，减少短命令转后台导致的宿主提前结轮。
