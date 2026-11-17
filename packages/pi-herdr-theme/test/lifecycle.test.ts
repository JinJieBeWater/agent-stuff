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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (done: () => boolean) => {
  for (let i = 0; i < 100 && !done(); i++) await sleep(50);
  expect(done()).toBe(true);
};

test("工厂只同步一次，会话期间才监听，错误提示一次，关闭后停止", async () => {
  mkdirSync(join(home, ".cache"));
  publishColors("#101010");
  const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
  await herdrTheme({
    on: (name: string, fn: never) => handlers.set(name, fn),
    exec: async () => ({
      code: 0,
      killed: false,
      truncated: false,
      stdout: JSON.stringify({ address: "t23", state: "live", foreground: { pid: process.pid } }),
      stderr: "",
    }),
  } as unknown as ExtensionAPI);
  const atFactory = panel();

  // No session yet: nothing watches, so this write goes unseen.
  publishColors("#303030");
  await sleep(300);
  expect(panel()).toBe(atFactory);

  const notes: string[] = [];
  const ctx = { mode: "tui", ui: { notify: (message: string) => notes.push(message) } };
  handlers.get("session_start")!({}, ctx);
  const atStart = panel();
  expect(atStart).not.toBe(atFactory);

  publishColors("#505050");
  await until(() => panel() !== atStart);

  // Herdr's first write isn't atomic, so half a file stays quiet.
  publish("");
  await sleep(300);
  expect(notes).toEqual([]);

  // Valid JSON that can't build a theme is worth saying, once.
  publish("{}");
  await until(() => notes.length === 1);
  publish("{ }");
  await sleep(300);
  expect(notes.length).toBe(1);
  expect(notes[0]).toContain("Herdr theme");

  publishColors("#707070");
  const beforeShutdown = panel();
  await until(() => panel() !== beforeShutdown);

  handlers.get("session_shutdown")!({}, ctx);
  const closed = panel();
  publishColors("#909090");
  await sleep(300);
  expect(panel()).toBe(closed);
});

test("Pi RPC never writes the Herdr theme or installs watchers", async () => {
  process.argv.push("--mode", "rpc");
  rmSync(themeFile, { force: true });
  mkdirSync(join(home, ".cache"), { recursive: true });
  publishColors("#101010");
  const handlers = new Map<string, unknown>();
  await herdrTheme({
    on: (name: string, fn: unknown) => handlers.set(name, fn),
  } as unknown as ExtensionAPI);
  expect(() => readFileSync(themeFile, "utf8")).toThrow(/ENOENT/);
  expect(handlers.size).toBe(0);
});
