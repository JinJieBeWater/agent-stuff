[简体中文](TESTING.md) | [English](TESTING.en.md)

# Session move testing

See the [development guide](../../docs/development.en.md#validation) for dependency setup and repository-wide checks. Run all commands below from `packages/pi-herdr-session-move/`.

## Default tests

```sh
bun run test
bun run check-types
```

`bun run test` runs only:

- [unit.test.ts](test/unit.test.ts): target directory validation, session copying, branch and provenance records, and related behavior.
- [lifecycle.test.ts](test/lifecycle.test.ts): tool and command entry points, handoff, cancellation, identity changes, drafts, message queues, and other lifecycle conditions.
- [runtime.test.ts](test/runtime.test.ts): Core terminal identifiers, native launch arguments, independent survival after source exit, private terminal binding, and process validation.

Tests run in Node through Vite+'s bundled Vitest. They use temporary files, the real SessionManager and Pi SDK, and replacements for Herdr transport and final model submission. They do not operate on the user's actual terminals or sessions.

## Manual process tests

The manual test requires local Node, project dependencies, and Herdr Core (`hc`). Default tests and CI omit this script.

- `node test/core-e2e.ts`: uses a separate `HC_SESSION` and temporary XDG directories to check moves with special paths, tool continuation, target survival, and trust blocks in real Core. Uses the CLI bundled with the project's Pi SDK and local Node, without depending on personal installation paths or starting the App. Cleans up its terminals, Core, and temporary directories when finished.

This test uses an offline provider and exercises handoff and application-level failure recovery on the current platform.

## Interpreting results

Passing tests does not mean an actual user move has completed. Completion requires confirming that the target session and cwd are correct, the source Pi has exited, and no other side is executing the task again. `staged`, `ready`, or existing handshake files alone are not proof of success.

To recover an unfinished actual move, follow [RECOVERY.en.md](RECOVERY.en.md) to verify identities and sessions. Rerunning test scripts is not a substitute for recovery.
