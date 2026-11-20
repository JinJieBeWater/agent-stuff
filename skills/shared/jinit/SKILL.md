---
name: jinit
description: "Project outer-folder setup. Use when starting a new project (optionally scaffolded with better-t-stack) or wrapping an existing repo in a same-named outer folder: links `.workspace` to it and writes a T3 Code-style AGENTS.md."
---

# jinit

The outer folder `<path>/foo/` is a plain folder outside git. The repo lives at `<path>/foo/foo`, and `.workspace` at the repo root symlinks to the outer folder.

## 1. Locate the outer folder and the repo

New repo:

1. Confirm the outer path and project name with the user; the outer folder and the repo share the name.
2. Confirm the scaffold command. When the user only described a stack, run `bunx create-better-t-stack@latest create --help` and build the full command from the current options for the user to confirm. Give every option a value: a missing one makes the CLI stop and prompt.
3. Run the scaffold inside the outer folder so it generates `<outer>/<name>`; without a scaffold, create that empty directory. Run `git init` if there is no `.git`.

Existing repo: the repo stays where it is. If its parent folder has the same name, the parent is the outer folder; otherwise use the path the user gives.

## 2. Link the outer folder

1. Create `.workspace -> <absolute outer path>` at the repo root, and add `/.workspace` to the file `git rev-parse --git-path info/exclude` prints.
2. The outer path goes into `permissions.additionalDirectories` in `~/.claude/settings.json` and into `writable_roots` under `[sandbox_workspace_write]` in `~/.codex/config.toml`; skip a file that already has it. These are global configs: stop before writing, list what each file gains in your reply, and write once the user agrees.
3. The outer folder contains the repo, so vitest follows `.workspace` and runs every test twice. If the repo uses vitest, add `**/.workspace/**` to `test.exclude` along with the defaults `**/node_modules/**` and `**/.git/**`.

Done: `readlink .workspace` prints the outer path, and `git status` lists no `.workspace`.

## 3. Write AGENTS.md

- No instruction file: copy [assets/AGENTS.md](assets/AGENTS.md) to the repo root and fill the `<!-- fill: … -->` slots in English. Write only what a lookup can't find: unwritten conventions, the reasons behind choices, gotchas no config confesses. Delete rules that don't apply to this stack and sections still empty after filling; keep the remaining rules word for word.
- Existing instruction files (AGENTS.md, CLAUDE.md, `.cursorrules` and the like): merge their content into one AGENTS.md organized by the template. Where they repeat the template, keep the template's wording; ask the user about each conflict. Then delete the other instruction files: Claude Code skips AGENTS.md whenever a CLAUDE.md exists.

Done: AGENTS.md is the repo's only instruction file, and `grep -c '<!-- fill' AGENTS.md` prints 0.

## 4. Commit

Stop before committing: post `git status --short` and the content you filled in or merged into AGENTS.md, then commit `chore: add agent layer` once the user agrees.

Done: `git status` is clean, and the latest commit is `chore: add agent layer`.
