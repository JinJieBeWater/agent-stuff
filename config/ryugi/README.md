# Ryugi maintenance on this Mac

Run `ryugi-maintain` to update the CLI and all registered integrations. Run
`ryugi-maintain doctor` to check the native registrations. The updater uses
Ryugi's own installer and preserves each integration's configured mode.

The helper narrows Ryugi's `codex plugin list --json` child command to the
local `ryugi-managed` marketplace. An unfiltered list can time out waiting for
Codex's remote catalogs, even though the local plugin is available. This does
not change normal Codex commands or its config. Remove the helper when Ryugi
queries its Codex marketplace directly.
