@[using-ryugi](~/.gemini/config/plugins/ryugi/skills/using-ryugi/SKILL.md)

- 平台工具映射以 `references/antigravity-tools.md` 为准，文件写入与修改使用 `write_file`、`edit_file`（替代已废弃的 `write_to_file`、`replace_file_content`）；加载 skill 时直接 `read_file` 对应 `SKILL.md`。
- 常规终端命令调用 `run_command` 时设 `WaitMsBeforeAsync: 10000`，减少短命令转后台导致的宿主提前结轮。
- 在 T3 线程里打开 Ryugi 产物（`ryugi.cjs start --artifact …`）后，紧接着运行 `ryugi-t3-watch subscribe --artifact <type>/<id> --project <与 --project-dir 相同的目录>`，把提交和评论接回本线程；每次重新 start 都要再运行一次。用户说「这里」「这段」「选中的」却没给出位置时，先运行 `ryugi-t3-watch selection-context --cwd <同一目录>`；没有输出表示查看器里没有选区。
