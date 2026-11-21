import { afterAll, afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// A throwaway home: this extension writes to ~/.cache and the agent's themes folder.
const home = mkdtempSync(join(tmpdir(), "herdr-theme-home-"));
process.env.HOME = home;
process.env.PI_CODING_AGENT_DIR = join(home, "agent");
if (homedir() !== home || getAgentDir() !== join(home, "agent")) throw new Error("not isolated");
const { default: herdrTheme } = await import("../index");
afterAll(() => rmSync(home, { recursive: true, force: true }));

const streams = [process.stdin, process.stdout];
const ttyDescriptors = streams.map((stream) => Object.getOwnPropertyDescriptor(stream, "isTTY"));
let argv: string[];
beforeEach(() => {
  argv = process.argv;
  process.argv = argv.slice(0, 2);
  for (const stream of streams) {
    Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
  }
  vi.stubEnv("HC_TERMINAL_ID", "t23");
  vi.stubEnv("HC_TERMINAL_SOCKET", "/fixture/core.sock");
});
afterEach(() => {
  process.argv = argv;
  vi.unstubAllEnvs();
  for (const [index, stream] of streams.entries()) {
    const descriptor = ttyDescriptors[index];
    if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
    else Reflect.deleteProperty(stream, "isTTY");
  }
});

const exportFile = join(home, ".cache", "herdr-app-theme.json");
const themeFile = join(home, "agent", "themes", "herdr.json");
const herdr = (background: string) => ({
  background,
  terminal_foreground: "#cdd6f4",
  accent: "#89b4fa",
  solid: "#eeeeef",
  muted: "#9b9ba2",
  dim: "#6d6d77",
  selected: "#ffffff17",
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`ansi${i}`, "#89b4fa"])),
});
const publish = (text: string) => writeFileSync(exportFile, text);
const publishColors = (background: string) =>
  publish(JSON.stringify({ colors: herdr(background) }));
const panel = () => JSON.parse(readFileSync(themeFile, "utf8")).colors.toolSuccessBg as string;

function createFakeWatch() {
  const watchers: {
    dir: string;
    closed: boolean;
    emit: (event: string, filename: string | null) => void;
    emitError: (error: Error) => void;
  }[] = [];
  const watchDir = (dir: string, listener: (event: string, filename: string | null) => void) => {
    const errorListeners: ((error: Error) => void)[] = [];
    const entry = {
      dir,
      closed: false,
      emit: (event: string, filename: string | null) => {
        if (!entry.closed) listener(event, filename);
      },
      emitError: (error: Error) => {
        for (const fn of errorListeners) fn(error);
      },
    };
    watchers.push(entry);
    return {
      close() {
        entry.closed = true;
      },
      on(event: string, fn: (...args: never[]) => void) {
        if (event === "error") errorListeners.push(fn as (error: Error) => void);
        return this;
      },
    };
  };
  return { watchDir, watchers };
}

test("工厂只同步一次，会话期间才监听，错误提示一次，关闭后停止", async () => {
  mkdirSync(join(home, ".cache"));
  publishColors("#101010");
  const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
  const { watchDir, watchers } = createFakeWatch();
  await herdrTheme(
    {
      on: (name: string, fn: never) => handlers.set(name, fn),
      exec: async () => ({
        code: 0,
        killed: false,
        truncated: false,
        stdout: JSON.stringify({ address: "t23", state: "live", foreground: { pid: process.pid } }),
        stderr: "",
      }),
    } as unknown as ExtensionAPI,
    watchDir as never,
  );
  const atFactory = panel();

  // No session yet: nothing watches, so this write goes unseen.
  publishColors("#303030");
  expect(watchers).toHaveLength(0);
  expect(panel()).toBe(atFactory);

  const notes: string[] = [];
  const ctx = { mode: "tui", ui: { notify: (message: string) => notes.push(message) } };
  handlers.get("session_start")!({}, ctx);
  expect(watchers).toHaveLength(1);
  expect(watchers[0]!.dir).toBe(join(home, ".cache"));
  const atStart = panel();
  expect(atStart).not.toBe(atFactory);

  // Unrelated files in ~/.cache are ignored.
  publishColors("#505050");
  watchers[0]!.emit("rename", "other.json");
  expect(panel()).toBe(atStart);

  watchers[0]!.emit("rename", "herdr-app-theme.json");
  expect(panel()).not.toBe(atStart);

  // Herdr's first write isn't atomic, so half a file stays quiet.
  publish("");
  watchers[0]!.emit("change", "herdr-app-theme.json");
  expect(notes).toEqual([]);

  // Valid JSON that can't build a theme is worth saying, once.
  publish("{}");
  watchers[0]!.emit("change", "herdr-app-theme.json");
  expect(notes).toHaveLength(1);
  publish("{ }");
  watchers[0]!.emit("change", "herdr-app-theme.json");
  expect(notes).toHaveLength(1);
  expect(notes[0]).toContain("Herdr theme");

  const beforeRecovery = panel();
  publishColors("#707070");
  watchers[0]!.emit("change", null);
  expect(panel()).not.toBe(beforeRecovery);

  handlers.get("session_shutdown")!({}, ctx);
  expect(watchers[0]!.closed).toBe(true);
  const closed = panel();
  publishColors("#909090");
  watchers[0]!.emit("rename", "herdr-app-theme.json");
  expect(panel()).toBe(closed);
});

test("Pi RPC never writes the Herdr theme or installs watchers", async () => {
  process.argv.push("--mode", "rpc");
  rmSync(themeFile, { force: true });
  mkdirSync(join(home, ".cache"), { recursive: true });
  publishColors("#101010");
  const handlers = new Map<string, unknown>();
  const { watchDir, watchers } = createFakeWatch();
  await herdrTheme(
    {
      on: (name: string, fn: unknown) => handlers.set(name, fn),
    } as unknown as ExtensionAPI,
    watchDir as never,
  );
  expect(() => readFileSync(themeFile, "utf8")).toThrow(/ENOENT/);
  expect(handlers.size).toBe(0);
  expect(watchers).toHaveLength(0);
});
