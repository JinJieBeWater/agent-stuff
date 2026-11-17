[简体中文](README.md) | [English](README.en.md)

# Pi Herdr tab title

Syncs the Pi session name to its Herdr Core / Herdr App tab. Registers only for interactive Pi terminals verified by Core and responds to `session_start` and `session_info_changed`. Empty names leave the tab unchanged.

Installed with the [repository Git package](../../README.en.md#installation), with `packages/pi-herdr-tab-title/index.ts` as its entry point. Disable it individually with `pi config`.

After reloading Pi, use `/name Title` to sync the name.

- After verifying `HC_TERMINAL_ID`, `HC_TERMINAL_SOCKET`, and terminal ownership,
  reads this terminal with `hc get <HC_TERMINAL_ID> --json` and requires its exact
  address and random `herdr.space` / `herdr.tab` labels to match the local
  `machine: null` space, tab, and terminal reported by `herdr-app ls`.
  Then calls `herdr-app do tab.rename` with explicit `id` / `name` arguments.
  Rechecks the App socket's identity before execution.
- When a tab contains multiple agents in split panes, only the first agent
  renames the tab to prevent competing updates. Every Pi writes its own session
  name to the terminal's `pi.session` label (`hc label`), which lets the sidebar
  distinguish agents within the same tab.
- Safely skips updates if the App is not running, the target does not match,
  labels are missing, or a command fails. Background workers do not borrow
  their parent terminal's labels. Does not start the App, create terminals, or change focus.
- Title updates run serially. Queued updates superseded by a newer title are skipped.

Run package checks with `bun run test` and `bun run check-types`. Tests replace
only external execution, socket, and filesystem side effects; they do not operate
on real tabs. Original upstream extension files are retained. Configuration selects
this package to avoid loading two title-sync extensions at once.
