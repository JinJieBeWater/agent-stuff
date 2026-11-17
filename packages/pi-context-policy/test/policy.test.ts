import { expect, test, vi } from "vite-plus/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import contextPolicy, { parsePolicy, registerPolicy } from "../index.ts";

type ExtensionMode = ExtensionContext["mode"];

const { isHerdrCoreTui } = vi.hoisted(() => ({ isHerdrCoreTui: vi.fn(async () => false) }));
vi.mock("../../../lib/herdr-core.ts", () => ({ isHerdrCoreTui }));

function harness(value: unknown, env: NodeJS.ProcessEnv = {}) {
  let handler: ((event: any, ctx: { mode: ExtensionMode }) => unknown) | undefined;
  registerPolicy(
    {
      on(name: string, callback: typeof handler) {
        expect(name).toBe("before_agent_start");
        handler = callback;
      },
    } as unknown as ExtensionAPI,
    parsePolicy(value),
    env,
  );
  return async (sections: Record<string, string> = {}, mode: ExtensionMode = "tui") => {
    const event = { systemPromptOptions: { sections } };
    await handler?.(event, { mode });
    return event.systemPromptOptions.sections;
  };
}

test("a forced system prompt receives both personal TUI sections exactly once", async () => {
  const config = parsePolicy(
    JSON.parse(
      await readFile(new URL("../../../config/pi/pi-context-policy.json", import.meta.url), "utf8"),
    ),
  );
  const core = config.sections?.find(({ id }) => id === "herdr-core");
  const emphasis = config.sections?.find(({ id }) => id === "emphasis");
  expect(core?.whenHost).toBe("herdr-core-tui");
  expect(emphasis?.whenHost).toBe("tui");
  let handler: ((event: any, ctx: { mode: ExtensionMode }) => unknown) | undefined;
  registerPolicy(
    {
      on: (_name: string, callback: typeof handler) => (handler = callback),
    } as unknown as ExtensionAPI,
    config,
  );
  const event = { systemPromptOptions: { sections: {}, forceSystemPrompt: "frozen" } };
  isHerdrCoreTui.mockResolvedValue(true);
  try {
    await handler?.(event, { mode: "tui" });
    await handler?.(event, { mode: "tui" });
  } finally {
    isHerdrCoreTui.mockReset();
  }
  expect(event.systemPromptOptions).toEqual({
    sections: {},
    forceSystemPrompt: [
      "frozen",
      `<context-policy-herdr-core>\n${core?.text}\n</context-policy-herdr-core>`,
      `<context-policy-emphasis>\n${emphasis?.text}\n</context-policy-emphasis>`,
    ].join("\n\n"),
  });
});

test("the default Core section requires ownership and the current prompt's TUI mode", async () => {
  const run = harness({}, { HC_TERMINAL_ID: "fixture", HC_TERMINAL_SOCKET: "/fixture/core.sock" });
  isHerdrCoreTui.mockClear();
  for (const mode of ["rpc", "json", "print"] as const) expect(await run({}, mode)).toEqual({});
  expect(isHerdrCoreTui).not.toHaveBeenCalled();
  expect(await run()).toEqual({});
  isHerdrCoreTui.mockResolvedValue(true);
  try {
    expect(Object.keys(await run({ herdr: "native" }))).toEqual([
      "herdr",
      "context-policy-herdr-core",
    ]);
    expect(await harness({ enabled: false })()).toEqual({});
    expect(await harness({ sections: [] })()).toEqual({});
    expect(await harness({ sections: [{ id: "team", text: "team text" }] })()).toEqual({
      "context-policy-team": "team text",
    });
  } finally {
    isHerdrCoreTui.mockReset();
  }
});

test("legacy Herdr markers do not provide a prompt section", async () => {
  expect(
    await harness({}, { HERDR_ENV: "1", HERDR_PANE_ID: "legacy" })({ herdr: "native" }),
  ).toEqual({
    herdr: "native",
  });
});

test("interactive sections follow the prompt mode and combine with environment conditions", async () => {
  const run = harness(
    {
      sections: [
        { id: "style", text: "terminal style", whenHost: "tui" },
        { id: "project", text: "project text", whenHost: "tui", whenEnv: { PROJECT: true } },
        { id: "shared", text: "shared text", whenEnv: { FLAG: true } },
      ],
    },
    { FLAG: "1" },
  );
  expect(await run()).toEqual({
    "context-policy-style": "terminal style",
    "context-policy-shared": "shared text",
  });
  for (const mode of ["rpc", "json", "print"] as const)
    expect(await run({}, mode)).toEqual({ "context-policy-shared": "shared text" });
});

test("configured sections use a private namespace, preserve other sections and are idempotent", async () => {
  const apply = harness(
    {
      sections: [
        { id: "team", text: "Use the documented team conventions." },
        { id: "second", text: "second configured section" },
      ],
    },
    {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "legacy",
      HC_TERMINAL_ID: "fixture",
      HC_TERMINAL_SOCKET: "/fixture/core.sock",
    },
  );
  const sections = await apply({ herdr: "host instructions", preamble: "native preamble" });
  expect(sections).toEqual({
    herdr: "host instructions",
    preamble: "native preamble",
    "context-policy-team": "Use the documented team conventions.",
    "context-policy-second": "second configured section",
  });
  expect(await apply(sections)).toEqual(sections);
});

test("all environment conditions must match; true means nonempty, strings compare exactly", async () => {
  const config = {
    sections: [
      { id: "conditional", text: "conditional text", whenEnv: { FEATURE: "1", INSTANCE: true } },
    ],
  };
  for (const flag of [undefined, "0", "1"])
    for (const instance of [undefined, "", "fixture"]) {
      const result = await harness(config, { FEATURE: flag, INSTANCE: instance })();
      expect(Boolean(result["context-policy-conditional"])).toBe(flag === "1" && Boolean(instance));
    }
  const env = { FEATURE: "0", INSTANCE: "fixture" };
  const apply = harness(config, env);
  expect(await apply()).toEqual({});
  env.FEATURE = "1";
  expect((await apply())["context-policy-conditional"]).toBe("conditional text");
});

test("invalid shapes, unknown fields, duplicate ids and malformed conditions fail visibly", () => {
  for (const value of [
    null,
    [],
    { enable: true },
    { enabled: "yes" },
    { sections: {} },
    { sections: null },
    { sections: [null] },
    { sections: [{ id: "Bad", text: "x" }] },
    { sections: [{ id: "x", text: "" }] },
    { sections: [{ id: "x", text: "x", extra: 1 }] },
    { sections: [{ id: "x", text: "x", whenHost: "rpc" }] },
    { sections: [{ id: "x", text: "x", whenHost: null }] },
    { sections: [{ id: "x", text: "x", whenEnv: null }] },
    { sections: [{ id: "x", text: "x", whenEnv: { FEATURE: 0 } }] },
    { sections: [{ id: "x", text: "x", whenEnv: { "bad=name": "1" } }] },
    {
      sections: [
        { id: "x", text: "a" },
        { id: "x", text: "b" },
      ],
    },
  ])
    expect(() => parsePolicy(value)).toThrow("pi-context-policy.json");
});

test("inherited object properties are not environment variables", async () => {
  const config = { sections: [{ id: "own", text: "restricted", whenEnv: { constructor: true } }] };
  expect(await harness(config, {})()).toEqual({});
  const env: NodeJS.ProcessEnv = {};
  Object.defineProperty(env, "constructor", { value: "configured", enumerable: true });
  expect((await harness(config, env)())["context-policy-own"]).toBe("restricted");
});

test("native entry reads only the configured agent directory; missing file uses defaults, malformed file fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-context-policy-test-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  let count = 0;
  const pi = {
    on() {
      count++;
    },
  } as unknown as ExtensionAPI;
  try {
    await contextPolicy(pi);
    expect(count).toBe(1);
    await writeFile(
      join(directory, "pi-context-policy.json"),
      '\uFEFF{"sections":[{"id":"sample","text":"configured"}]}',
    );
    await contextPolicy(pi);
    expect(count).toBe(2);
    await writeFile(join(directory, "pi-context-policy.json"), "{");
    await expect(contextPolicy(pi)).rejects.toThrow();
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(directory, { recursive: true });
  }
});
