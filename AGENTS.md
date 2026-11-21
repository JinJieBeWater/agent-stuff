# agent-stuff

Personal coding-agent toolkit and configuration repository containing Pi extensions, cross-agent skills, an Antigravity/T3 MCP wrapper, and shared host configurations. Maintained and used by a single developer on macOS.

## What we never compromise on

### Pi Git package boundary

The root `package.json` bundles only the nine `packages/pi-*` extensions and sets `"pi.skills": []`. Keep `skills/shared/` and `config/` out of Pi package discovery, and keep host-supplied Pi packages in `peerDependencies` (`*`).

### Live Antigravity runtime stability

T3 Code executes the active Antigravity provider directly through `config/antigravity/bin/antigravity`, `acp-wrapper.mjs`, and `t3-mcp-shim.mjs`, and watches `~/.t3/userdata/settings.json`. Never move or rename this repository or those wrapper files, and never edit `~/.t3/userdata/settings.json` during an active Antigravity turn.

## How we work

We like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences should be able to override anything here.

## A small glossary

We need to be on the same page with terminology. When communicating, use this language:

- **you** means the agent reading this file and changing this project.
- **we, us, and maintainers** mean the people building this project. These are who you are talking to now.
- **user** means the person using what this project ships.
- **live symlink target** means a file under `config/shared/`, `config/antigravity/`, or `config/pi/` that a host directory symlinks to directly; editing it changes live host behavior on reload or next session.

## Ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID you found by matching a name, path, or worktree string. Your own agent process has this worktree's path in its argv, and this machine runs several other dev servers at once. Kill only a PID you captured at spawn, or the owner of your port after confirming its cwd is your worktree.
2. **Touching live Antigravity wiring mid-turn.** Moving `~/my/agent-stuff`, renaming `config/antigravity/bin/`, `acp-wrapper.mjs`, or `t3-mcp-shim.mjs`, or running `config/antigravity/sync.sh --apply-t3-binary` interrupts the running T3 Antigravity session.
3. **Double-registering extensions or inverting load order.** Never load both the Git package and a local `./packages/*` entry for the same Pi extension. Packages managed by `pi-context-policy` or `pi-tool-exposure` must have `extensions: []` in Pi `settings.json`. Keep `pi-skill-discovery` before `@howaboua/pi-codex-conversion` in `packages`, or PCC renders the unfiltered skill catalog before discovery trims `options.skills`.
4. **Committing private machine state.** Keep `~/.config/agent-config/skills.toml`, work-only skills, credentials, and host-local paths out of this repository.

## Hit every surface

The most common defect is a change that works on the path you tested and is missing everywhere else. Before calling work done, walk this list and say which entries applied:

- **Entry points.** A behavior reachable from one place is usually also reachable from others. Fixing one is not fixing the feature.
- **Agents.** A capability a user can trigger is usually one an agent should reach through tools, and scheduled tasks run the same paths. That only works when it is a service method, not handler code.
- **Contracts.** Anything crossing a process or network boundary is typed in one place. Change the schema and every consumer follows.
- **Reverse states.** If you added a way in, add the way out and the way to see it. Snooze needs unsnooze. Close needs reopen. A one-way door is a bug.
- **Docs.** Check whether the change makes existing guidance inaccurate. Apply the [documentation rules](#documentation) before adding anything.

Project surfaces: Pi (interactive TUI and RPC), Claude Code, Codex, Antigravity (CLI and T3 Code profiles), and Herdr Core/App integration (`packages/pi-herdr-*`, plus the `~/.cache/herdr-app-theme.json` contract shared with `herdr-t3`).

## Verifying

Fast check before committing: `bun run check` (format, lint, and type-check across root and all workspaces). Run a single test file with `bunx vp test run <path>`, or a single package from its directory with `bun run test`. After editing `skills/shared/agent-config`, also run `skills/shared/agent-config/scripts/agent-config check`.

- Test behavior that can break, such as orchestration, protocol translation, auth and permission guards, persistence and migrations, external-format parsing, race fixes, and the logic a bug fix changed. Leave out tests for what types already guarantee, trivial logic, copy text, smoke runs, mock-call mirrors, callback wiring, and props rendered to static markup.
- Extend before you add. When an existing test or table covers the behavior, add a row or an assertion there. Write a new test only when no case fits.
- Test at one layer: the lowest one that fails on `main`. Do not repeat the case in a wrapper test, at each call site, or in copies of the same logic.
- **Do not run repo-wide checks** unless asked. CI owns the full suite.
- Proof for a bug fix depends on the bug. Logic, data, state, and protocol bugs get a failing test first (the fewest that fail on `main` for that reason, in an existing case where one fits), then the fix. Purely visual bugs (spacing, colour, alignment, a layout shift) get before/after captures as their proof and no test. A server-only fix with no visible surface ships the test plus a short runtime transcript.
- Never wait on sleeps or polling. Await the event, promise, or queue item that marks the milestone. A test that needs a timeout to pass is wrong.
  - No per-test timeout argument or `retry`. Flaky tests are fixed, not retried.
  - No `performance.now()` or `Date.now()` deltas. Assert on events and counts, not elapsed time.
  - `it.skip` and friends need a tracking issue on the line above: `// quarantine: #1234 <why>`.
- Real agent turns cost money. Use a free replay or mock provider when one exists. Use a real provider only when the change depends on that provider's behavior, and then pick its cheapest model.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- `origin` is not always GitHub. Check `git remote get-url origin` before your first forge command and use that forge's CLI and skill.
- Conventional commit titles, plain language: `fix(web): new threads no longer spike CPU`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- One request is one PR. Split it only when the maintainer asks.
- When babysitting: do not poll or sleep. Verify each bot finding against the source, fix real ones, dismiss false positives with a written reason. Stay quiet when nothing is new. Stop when the bots are green on the latest commit.

## Documentation

Most code changes do not need an internal documentation change. Agents can read the code.

- Internal docs are for architectural decisions and their reasons, constraints that span components, and implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields or methods, narrate control flow, maintain file catalogs, or append PR summaries. Types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- A local reason the code can't show goes in a short nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new internal page needs a distinct, durable reason to exist.
- User docs help users accomplish tasks. Give each major feature a concise section explaining what it does, how to start, and anything unintuitive. A settings path is useful; descriptions of visible buttons, icons, layouts, animations, or every UI state are not. Before adding text, ask what task or decision it helps the user with.
- Keep user docs in the shipped product's voice, without implementation details or contributor tooling. Update the relevant feature section when how to use it changes. A UI tweak does not need a documentation entry, and a new control does not need its own page.
- Operations docs hold maintainer setup, release, and debugging procedures. Instructions for operating what users install belong in user docs.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary working material outside the worktree.
- Track active maintainer work in the issue or project item that owns it.
- A merged PR is the implementation record. Close or update its tracking item when the work lands; do not preserve a second checklist in the repository.

## How it works

- `lib/extension-packages.ts` lets `pi-context-policy` and `pi-tool-exposure` wrap third-party Pi packages via Pi's native `DefaultPackageManager` discovery while verifying realpaths to refuse double-loading any entry still enabled natively.
- `config/antigravity/acp-wrapper.mjs` intercepts T3's per-session MCP launch spec into a private state file so `t3-mcp-shim.mjs` (registered as `t3-code` in each profile's `mcp_config.json`) forwards JSON-RPC to T3's HTTP/SSE endpoint while letting Antigravity apply native lazy loading and `t3-tools.json` rules.
- `skills/shared/agent-config/scripts/agent-config` reconciles `~/.agents/skills`, host symlinks, manual-only policies, and global prompt links against `~/.config/agent-config/skills.toml`.

## Where code lives

- `skills/shared/`: cross-agent skills symlinked into `~/.agents/skills`; kept out of Pi package discovery via `"pi.skills": []` in root `package.json`.
- `config/pi/`: live symlink targets for `~/.pi/agent/` (`APPEND_SYSTEM.md`, `pi-skill-discovery.json`, `pi-tool-exposure.json`, `pi-context-policy.json`, `shepherdr/profiles/`, `skills/multi-agent-review/`).
- `config/antigravity/sync.sh`: owns `~/.gemini/` and T3 Antigravity profile symlinks, `mcp_config.json`, and swarm plugin settings; `agent-config check` reports drift there but leaves repair to `sync.sh`.

## Taste

- Inferred types over annotations. `any` is the enemy.
- Default to no comment. Write one only for a constraint, an external quirk, or an invariant the code can't show, in one line where you can and four at most. Don't restate names or signatures, narrate steps, record history, or explain the fix you just made; the PR carries that.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.

## Additional tips

- Security is important, but should not be over-indexed on, especially for dev mode/maintainer-only features.
