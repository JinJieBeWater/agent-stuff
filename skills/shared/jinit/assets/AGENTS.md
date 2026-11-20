# <Project name>

<!-- fill: one or two sentences on what this project is and who uses it. -->

## What we never compromise on

<!-- fill: the few properties users rely on, one short subsection each. Delete this section if there are none yet. -->

## How we work

We like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences should be able to override anything here.

## A small glossary

We need to be on the same page with terminology. When communicating, use this language:

- **you** means the agent reading this file and changing this project.
- **we, us, and maintainers** mean the people building this project. These are who you are talking to now.
- **user** means the person using what this project ships.

<!-- fill: project terms that are easy to confuse. -->

## Ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID you found by matching a name, path, or worktree string. Your own agent process has this worktree's path in its argv, and this machine runs several other dev servers at once. Kill only a PID you captured at spawn, or the owner of your port after confirming its cwd is your worktree.

<!-- fill: live data you must not write to, settings that silently break things. -->

## Hit every surface

The most common defect is a change that works on the path you tested and is missing everywhere else. Before calling work done, walk this list and say which entries applied:

- **Entry points.** A behavior reachable from one place is usually also reachable from others. Fixing one is not fixing the feature.
- **Agents.** A capability a user can trigger is usually one an agent should reach through tools, and scheduled tasks run the same paths. That only works when it is a service method, not handler code.
- **Contracts.** Anything crossing a process or network boundary is typed in one place. Change the schema and every consumer follows.
- **Reverse states.** If you added a way in, add the way out and the way to see it. Snooze needs unsnooze. Close needs reopen. A one-way door is a bug.
- **Docs.** Check whether the change makes existing guidance inaccurate. Apply the [documentation rules](#documentation) before adding anything.

<!-- fill: this project's surfaces (clients, providers, locales, connection modes). -->

## Dev servers

<!-- fill: install, start, ports — only what scripts and config don't already say. -->

- Stop what you started, by the PID you tracked. See "Killing by pattern".
- Run dev servers and builds from your own shell so they end with your session. Do not detach them with `systemd-run`, `nohup`, `setsid`, or `tmux` unless the user asks for one that outlives the session. Detached servers ran for weeks and filled RAM and swap.
- Need a second checkout? `git worktree add` it next to this worktree, not in `/tmp`. Remove it when done.

## Test data

An empty database is a bad test. Seed your sandbox with a copy of real data instead of pointing at live state. Copy in, never symlink. Data flows one way: into your sandbox, never back out.

## Verifying

<!-- fill: the fast check to run before pushing, and how to run a single test file. -->

- Test behavior that can break, such as orchestration, protocol translation, auth and permission guards, persistence and migrations, external-format parsing, race fixes, and the logic a bug fix changed. Leave out tests for what types already guarantee, trivial logic, copy text, smoke runs, mock-call mirrors, callback wiring, and props rendered to static markup.
- Extend before you add. When an existing test or table covers the behavior, add a row or an assertion there. Write a new test only when no case fits.
- Test at one layer: the lowest one that fails on `main`. Do not repeat the case in a wrapper test, at each call site, or in copies of the same logic.
- Write a browser test only for behavior that needs a real browser: layout and scrolling, focus and pointer input, real workers, or a component wired to its hooks. Logic a component calls gets a unit test beside it.
- **Do not run repo-wide checks** unless asked. CI owns the full suite.
- Backend behavior changes ship with focused tests for that behavior.
- Proof for a bug fix depends on the bug. Logic, data, state, and protocol bugs get a failing test first (the fewest that fail on `main` for that reason, in an existing case where one fits), then the fix. Purely visual bugs (spacing, colour, alignment, a layout shift) get before/after captures as their proof and no test. A server-only fix with no visible surface ships the test plus a short runtime transcript.
- Never wait on sleeps or polling. Await the event, promise, or queue item that marks the milestone. A test that needs a timeout to pass is wrong.
  - No per-test timeout argument or `retry`. Flaky tests are fixed, not retried.
  - No `performance.now()` or `Date.now()` deltas. Assert on events and counts, not elapsed time.
  - `it.skip` and friends need a tracking issue on the line above: `// quarantine: #1234 <why>`.
- User-visible changes get one integrated pass in a real client. The primary agent does this once after integrating. Subagents do not launch their own dev servers.
- Real agent turns cost money. Use a free replay or mock provider when one exists. Use a real provider only when the change depends on that provider's behavior, and then pick its cheapest model.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- `origin` is not always GitHub. Check `git remote get-url origin` before your first forge command and use that forge's CLI and skill.
- Conventional commit titles, plain language: `fix(web): new threads no longer spike CPU`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images. Motion or timing needs a short video.
- Upload PR evidence to the forge. Never commit PR-only screenshots or assets.
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

<!-- fill: the few sentences of architecture an agent can't get from one file. Delete if obvious. -->

## Where code lives

<!-- fill: boundaries the directory names don't show. -->

- `.repos/` - vendored read-only references. Prefer their patterns over invented ones. Never edit or import from them. Refresh one when you bump the dependency it mirrors.

## Taste

- Complexity belongs at the adapter boundary. Orchestration stays pure, UI stays dumb.
- Server features are services; transports stay thin. An RPC handler, HTTP route, or MCP tool decodes input, calls one service method, and maps errors.
- UI library components own their look. Pick a `variant` or `size`; do not restyle one with `className`. If none fits and the look is a generic concept, add a variant to the component; a look that belongs to one feature stays in that feature's own component. Layout classes (width, flex, margin, position) belong on the parent.
- Inferred types over annotations. `any` is the enemy.
- Default to no comment. Write one only for a constraint, an external quirk, or an invariant the code can't show, in one line where you can and four at most. Don't restate names or signatures, narrate steps, record history, or explain the fix you just made; the PR carries that.
- React effects are for synchronizing with something outside React. Derive in render and act in handlers instead of syncing state, but don't hide real lifecycle work in refs or stores to dodge one.
- No continuously repainting animations; they peg the GPU on high-refresh displays.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.

<!-- fill: project-specific patterns. Where a lint rule enforces a rule in this file, name the lint rule beside it. -->

## Additional tips

- Security is important, but should not be over-indexed on, especially for dev mode/maintainer-only features.
- Before a security audit or triaging a vulnerability report, read [SECURITY.md](SECURITY.md) for the trust model and what is intended.
