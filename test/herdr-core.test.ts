import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { isHerdrCoreTui } from "../lib/herdr-core.ts";

const streams = [process.stdin, process.stdout];
const ttyDescriptors = streams.map((stream) => Object.getOwnPropertyDescriptor(stream, "isTTY"));
let argv: string[];

function setTty(stream: NodeJS.ReadStream | NodeJS.WriteStream, enabled: boolean) {
  Object.defineProperty(stream, "isTTY", { configurable: true, value: enabled });
}

beforeEach(() => {
  argv = process.argv;
  process.argv = argv.slice(0, 2);
  for (const stream of streams) setTty(stream, true);
  vi.stubEnv("HC_TERMINAL_ID", "t18");
  vi.stubEnv("HC_TERMINAL_SOCKET", "/fixture/core.sock");
  vi.stubEnv("TERM_PROGRAM", undefined);
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

const live = { address: "t18", state: "live", foreground: { pid: process.pid } };

function result(value: unknown): Awaited<ReturnType<ExtensionAPI["exec"]>> {
  return { code: 0, killed: false, truncated: false, stdout: JSON.stringify(value), stderr: "" };
}

test.each([
  ["--mode", "rpc"],
  ["--mode", "json"],
  ["-p"],
  ["--print"],
  ["--help"],
  ["--version"],
  ["--list-models"],
  ["--export", "session.jsonl"],
  ["config"],
  ["--mode", "bad-mode"],
])("skips %s before requesting Core identity", async (...args) => {
  process.argv.push(...args.filter((arg): arg is string => typeof arg === "string"));
  const exec = vi.fn<ExtensionAPI["exec"]>();
  expect(await isHerdrCoreTui({ exec })).toBe(false);
  expect(exec).not.toHaveBeenCalled();
});

test.each([0, 1])("requires both TTYs when stream %i is redirected", async (index) => {
  setTty(streams[index]!, false);
  const exec = vi.fn<ExtensionAPI["exec"]>();
  expect(await isHerdrCoreTui({ exec })).toBe(false);
  expect(exec).not.toHaveBeenCalled();
});

test.each([
  ["HC_TERMINAL_ID", undefined],
  ["HC_TERMINAL_ID", "remote/t18"],
  ["HC_TERMINAL_SOCKET", undefined],
  ["HC_TERMINAL_SOCKET", " "],
])("requires a complete Core identity (%s=%s)", async (key, value) => {
  vi.stubEnv(key, value);
  const exec = vi.fn<ExtensionAPI["exec"]>();
  expect(await isHerdrCoreTui({ exec })).toBe(false);
  expect(exec).not.toHaveBeenCalled();
});

test.each([
  ["--", "--print", "--mode", "rpc"],
  ["--mode", "text"],
  ["--name", "--print"],
])("uses Pi argument semantics for interactive arguments %j", async (...args) => {
  process.argv.push(...args.filter((arg): arg is string => typeof arg === "string"));
  const exec = vi.fn<ExtensionAPI["exec"]>().mockResolvedValue(result(live));
  expect(await isHerdrCoreTui({ exec })).toBe(true);
  expect(exec).toHaveBeenCalledWith("hc", ["get", "t18", "--json"], { timeout: 1000 });
});

test.each([undefined, "t3code"])(
  "rejects inherited Core markers (TERM_PROGRAM=%s)",
  async (term) => {
    vi.stubEnv("TERM_PROGRAM", term);
    const exec = vi
      .fn<ExtensionAPI["exec"]>()
      .mockResolvedValue(
        result({ ...live, pid: process.pid + 5, foreground: { pid: process.pid + 1 } }),
      );
    expect(await isHerdrCoreTui({ exec })).toBe(false);
  },
);

test("accepts a Core worker even when it inherits a T3 terminal marker", async () => {
  vi.stubEnv("TERM_PROGRAM", "t3code");
  const exec = vi
    .fn<ExtensionAPI["exec"]>()
    .mockResolvedValue(result({ ...live, parent: "t2", pid: process.pid, foreground: null }));
  expect(await isHerdrCoreTui({ exec })).toBe(true);
});

test("retries while Core samples the foreground of a newly launched Pi", async () => {
  let sample = 0;
  const shell = process.pid + 1;
  const exec: ExtensionAPI["exec"] = async (command) => {
    if (command === "ps") return { ...result(null), code: 1 };
    sample++;
    if (sample === 1) return result({ ...live, foreground: null });
    if (sample === 2) return result({ ...live, pid: shell, foreground: { pid: shell } });
    return result(live);
  };
  expect(await isHerdrCoreTui({ exec })).toBe(true);
});

test.each([
  { ...live, address: "t19" },
  { ...live, state: "finished" },
  { ...live, error: "unavailable" },
  null,
])("requires a live response for the reported terminal (%j)", async (terminal) => {
  const exec = vi.fn<ExtensionAPI["exec"]>().mockResolvedValue(result(terminal));
  expect(await isHerdrCoreTui({ exec })).toBe(false);
});

test("a missing hc command stays inactive", async () => {
  const exec = vi.fn<ExtensionAPI["exec"]>().mockRejectedValue(new Error("ENOENT"));
  expect(await isHerdrCoreTui({ exec })).toBe(false);
});

test.skipIf(process.platform === "win32")(
  "accepts a Pi in the foreground group of a non-job-control Core shell",
  async () => {
    const shell = process.pid + 1;
    const exec: ExtensionAPI["exec"] = async (command) =>
      command === "ps"
        ? {
            ...result(null),
            stdout: `${shell} ttys047 ${shell} ${shell}\n${process.pid} ttys047 ${shell} ${shell}\n`,
          }
        : result({ ...live, pid: shell, foreground: { pid: shell } });
    expect(await isHerdrCoreTui({ exec })).toBe(true);
  },
);

test.skipIf(process.platform === "win32")(
  "rejects Pi in a nested PTY even when its enclosing Core shell is foreground",
  async () => {
    vi.stubEnv("TERM_PROGRAM", "t3code");
    const shell = process.pid + 1;
    const exec: ExtensionAPI["exec"] = async (command) =>
      command === "ps"
        ? {
            ...result(null),
            stdout: `${shell} ttys047 ${shell} ${shell}\n${process.pid} ttys052 ${process.pid} ${process.pid}\n`,
          }
        : result({ ...live, pid: shell, foreground: { pid: shell } });
    expect(await isHerdrCoreTui({ exec })).toBe(false);
  },
);
