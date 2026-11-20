---
name: jinit
description: "新建项目、给已有仓库套外壳：把 git 仓库放进同名的外层文件夹，用 `.workspace` 软链指向外层，再叠加 T3 Code 风格的 AGENTS.md。"
---

# jinit

布局：外层 `<路径>/foo/` 是普通文件夹，不进 git；仓库在 `<路径>/foo/foo`。仓库根目录的 `.workspace` 软链到外层的绝对路径，agent 把计划、调研和要保留的临时文件写进去。

动手前把计划给用户看；改全局配置和提交前，把 diff 给用户看。

## 新仓库

1. 确认外层路径和项目名，外层和仓库同名。
2. 确认脚手架命令。用户只描述了技术栈时，运行 `bunx create-better-t-stack@latest create --help`，按当前选项拼出完整命令请用户确认；每个选项都给值，漏掉的会让 CLI 停下来交互提问。
3. 在外层里执行脚手架，生成到 `<外层>/<项目名>`；不用脚手架就建这个空目录。没有 `.git` 时运行 `git init`。
4. 连接外层，写 AGENTS.md，提交 `chore: add agent layer`。

## 已有仓库

1. 确认外层：仓库原地不动，父目录和仓库同名时它就是外层，否则用用户给的路径。
2. 连接外层，写 AGENTS.md，提交 `chore: add agent layer`。

完成（两条流程）：`git status` 干净，最新提交是 `chore: add agent layer`；`.workspace` 指向外层；仓库里的指令文件只有 AGENTS.md，`grep -c '<!-- fill' AGENTS.md` 为 0。

## 连接外层

1. 仓库根目录建 `.workspace -> <外层绝对路径>`，在 `git rev-parse --git-path info/exclude` 指向的文件里加一行 `/.workspace`。
2. 把外层路径追加进 `~/.claude/settings.json` 的 `permissions.additionalDirectories`，和 `~/.codex/config.toml` 里 `[sandbox_workspace_write]` 的 `writable_roots`，已有就不加。
3. 外层包含仓库本身，vitest 会顺着 `.workspace` 把测试再跑一遍。仓库用 vitest 时，把 `**/.workspace/**` 连同默认的 `**/node_modules/**`、`**/.git/**` 加进 `test.exclude`。

## 写 AGENTS.md

- 没有指令文件：复制 [assets/AGENTS.md](assets/AGENTS.md) 到仓库根目录，用英文填 `<!-- fill: … -->` 槽位。只写查不到的：没写下来的约定、选择背后的理由、配置里看不出的坑。删掉不适用于这个技术栈的规则和填完仍为空的章节，删掉所有 `<!-- fill` 注释；保留的规则一字不改。
- 已有 AGENTS.md、CLAUDE.md、`.cursorrules` 这类指令文件：内容按模板组织并进一份 AGENTS.md，和模板重复的保留模板原文，冲突的逐条问用户。并完删掉其他指令文件，Claude Code 有 CLAUDE.md 时不读 AGENTS.md。
