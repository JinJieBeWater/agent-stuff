import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isHerdrCoreTui } from "../../lib/herdr-core.ts";

interface RuntimeDependencies {
  statSocket?: (path: string) => Promise<{ dev: number; ino: number; isSocket(): boolean }>;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export default async function herdrTabTitle(pi: ExtensionAPI, deps: RuntimeDependencies = {}) {
  if (!(await isHerdrCoreTui(pi))) return;
  const env = process.env;
  const terminal = env.HC_TERMINAL_ID!;

  const appSocket = join(
    env.HERDR_APP_HOME || join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "herdr-app"),
    "herdr-app.sock",
  );
  const statSocket = deps.statSocket ?? stat;
  let sequence = 0;
  let pending = Promise.resolve();
  let closed = false;

  const json = async (command: string, args: string[]) => {
    const result = await pi.exec(command, args, { timeout: 3000 });
    if (result.code !== 0 || result.killed) throw new Error("Herdr command failed");
    const value: unknown = JSON.parse(result.stdout);
    if (object(value).error) throw new Error("Herdr command returned an error");
    return value;
  };

  const renameCore = async (title: string, current: () => boolean) => {
    const original = await statSocket(appSocket);
    if (!original.isSocket()) return;
    const target = object(await json("hc", ["get", terminal, "--json"]));
    const labels = object(target.labels);
    const space = labels["herdr.space"];
    const tab = labels["herdr.tab"];
    if (
      target.address !== terminal ||
      target.state !== "live" ||
      typeof space !== "string" ||
      !/^sp[0-9a-f]{32}$/.test(space) ||
      typeof tab !== "string" ||
      !/^tb[0-9a-f]{32}$/.test(tab)
    )
      return;
    // Each Pi keeps its own name on its terminal, so panes sharing a tab stay distinguishable.
    if (!current()) return;
    await json("hc", ["label", terminal, `pi.session=${title}`]);
    const world = object(await json("herdr-app", ["ls"]));
    if (!Array.isArray(world.spaces)) return;
    const matches = world.spaces.flatMap((value) => {
      const entry = object(value);
      if (entry.machine !== null || entry.id !== space || !Array.isArray(entry.tabs)) return [];
      return entry.tabs.filter((value) => {
        const entry = object(value);
        if (entry.id !== tab || !Array.isArray(entry.terminals)) return false;
        // The tab follows its first agent only; later agents in split panes would otherwise take turns renaming it.
        const owner = entry.terminals
          .map(object)
          .find((value) => value.terminal === terminal || typeof value.status === "string");
        return owner?.terminal === terminal;
      });
    });
    if (matches.length !== 1 || !current()) return;
    const latest = await statSocket(appSocket);
    if (
      !latest.isSocket() ||
      latest.dev !== original.dev ||
      latest.ino !== original.ino ||
      !current()
    )
      return;
    await json("herdr-app", ["do", "tab.rename", JSON.stringify({ id: tab, name: title })]);
  };

  const rename = (rawTitle: unknown) => {
    const request = ++sequence;
    const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
    const current = () => !closed && request === sequence;
    pending = pending
      .then(async () => {
        if (!title || !current()) return;
        await renameCore(title, current);
      })
      .catch(() => {
        // Title synchronization is best effort; a failed backend must not interrupt Pi.
      });
    return pending;
  };

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode === "tui") await rename(pi.getSessionName());
  });
  pi.on("session_info_changed", async (event, ctx) => {
    if (ctx.mode === "tui") await rename(event.name);
  });
  pi.on("session_shutdown", () => {
    closed = true;
    sequence++;
  });
}
