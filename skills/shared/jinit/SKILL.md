---
name: jinit
description: "项目外层初始化。用于新建项目（可配 better-t-stack 脚手架），或给已有仓库套一层同名外层文件夹：接上 `.workspace` 软链，写入 T3 Code 风格的 AGENTS.md。"
---

# jinit

外层 `<路径>/foo/` 是不进 git 的普通文件夹，仓库在 `<路径>/foo/foo`，仓库根目录的 `.workspace` 软链到外层。

## 1. 定位外层和仓库

新仓库：

1. 和用户确认外层路径和项目名，两者同名。
2. 确认脚手架命令。用户只描述了技术栈时，运行 `bunx create-better-t-stack@latest create --help`，按当前选项拼出完整命令请用户确认；每个选项都给值，漏掉的会让 CLI 停下来交互提问。
3. 在外层里执行脚手架，生成到 `<外层>/<项目名>`；不用脚手架就建这个空目录。没有 `.git` 时运行 `git init`。

已有仓库：仓库原地不动。父目录和仓库同名时，父目录就是外层；否则用用户给的路径。

## 2. 连接外层

1. 仓库根目录建 `.workspace -> <外层绝对路径>`，在 `git rev-parse --git-path info/exclude` 指向的文件里加一行 `/.workspace`。
2. 外层路径要追加进 `~/.claude/settings.json` 的 `permissions.additionalDirectories`，和 `~/.codex/config.toml` 里 `[sandbox_workspace_write]` 的 `writable_roots`，已有就跳过。这是全局配置：写入前停下，在回复里列出每个文件要加的内容，用户同意后再写。
3. 外层包含仓库本身，vitest 会顺着 `.workspace` 把测试再跑一遍。仓库用 vitest 时，把 `**/.workspace/**` 连同默认的 `**/node_modules/**`、`**/.git/**` 加进 `test.exclude`。

完成：`readlink .workspace` 输出外层路径，`git status` 里没有 `.workspace`。

## 3. 写 AGENTS.md

- 没有指令文件：复制 [assets/AGENTS.md](assets/AGENTS.md) 到仓库根目录，用英文填 `<!-- fill: … -->` 槽位。只写查不到的：没写下来的约定、选择背后的理由、配置里看不出的坑。删掉不适用于这个技术栈的规则和填完仍为空的章节；保留的规则一字不改。
- 已有 AGENTS.md、CLAUDE.md、`.cursorrules` 这类指令文件：内容按模板组织并进一份 AGENTS.md，和模板重复的保留模板原文，冲突的逐条问用户。并完删掉其他指令文件：Claude Code 只要看到 CLAUDE.md 就不加载 AGENTS.md。

完成：仓库里的指令文件只有 AGENTS.md，`grep -c '<!-- fill' AGENTS.md` 为 0。

## 4. 提交

提交前停下，在回复里贴出 `git status --short` 和 AGENTS.md 里填写、合并进来的内容，用户同意后提交 `chore: add agent layer`。

完成：`git status` 干净，最新提交是 `chore: add agent layer`。
