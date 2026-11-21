import { expect, test } from "vite-plus/test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrapperPath = join(root, "config", "antigravity", "bin", "antigravity");

function runProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.end();
  });
}

test("non-acp commands forward exact arguments without injecting acp flags", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agy-wrapper-cli-"));
  try {
    const fakeUpstream = join(dir, "fake-agy");
    await writeFile(
      fakeUpstream,
      `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)) + "\\n");\n`,
      "utf8",
    );
    await chmod(fakeUpstream, 0o755);

    const res = await runProcess(wrapperPath, ["--version"], {
      ...process.env,
      AGY_UPSTREAM_BIN: fakeUpstream,
    });
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout.trim())).toEqual(["--version"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("selects the newer semver binary between T3 managed runtime and ~/.local/bin/agy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agy-wrapper-ver-"));
  try {
    const target = `${process.platform === "win32" ? "win32" : process.platform}-${process.arch}`;
    const managedDir = join(dir, ".t3", "tools", "antigravity-acp", target);
    const verDir = join(managedDir, "versions", "rel-1");
    const localBinDir = join(dir, ".local", "bin");
    await mkdir(verDir, { recursive: true });
    await mkdir(localBinDir, { recursive: true });

    await writeFile(
      join(managedDir, "active.json"),
      JSON.stringify({ releaseId: "rel-1" }),
      "utf8",
    );
    const managedBin = join(verDir, process.platform === "win32" ? "agy.exe" : "antigravity");
    const localBin = join(localBinDir, process.platform === "win32" ? "agy.exe" : "agy");

    await writeFile(
      managedBin,
      `#!/usr/bin/env node\nprocess.stdout.write(process.argv.includes("--version") ? "1.5.9\\n" : "managed\\n");\n`,
      "utf8",
    );
    await writeFile(
      localBin,
      `#!/usr/bin/env node\nprocess.stdout.write(process.argv.includes("--version") ? "1.5.10\\n" : "local\\n");\n`,
      "utf8",
    );
    await chmod(managedBin, 0o755);
    await chmod(localBin, 0o755);

    const env: NodeJS.ProcessEnv = { ...process.env, HOME: dir };
    delete env.AGY_UPSTREAM_BIN;

    const resNewerLocal = await runProcess(wrapperPath, ["agents"], env);
    expect(resNewerLocal.code).toBe(0);
    expect(resNewerLocal.stdout.trim()).toBe("local");

    await writeFile(
      localBin,
      `#!/usr/bin/env node\nprocess.stdout.write(process.argv.includes("--version") ? "1.5.8\\n" : "local\\n");\n`,
      "utf8",
    );
    const resNewerManaged = await runProcess(wrapperPath, ["agents"], env);
    expect(resNewerManaged.code).toBe(0);
    expect(resNewerManaged.stdout.trim()).toBe("managed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const shimPath = join(root, "config", "antigravity", "bin", "t3-mcp-shim");

type Json = Record<string, any>;

function lineClient(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const waiters = new Map<unknown, (msg: Json) => void>();
  const notifications: Json[] = [];
  const decoder = new TextDecoder();
  let stdoutBuffer = "";
  const onStdoutLine = (raw: string) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    if ("id" in msg && waiters.has(msg.id)) {
      waiters.get(msg.id)!(msg);
      waiters.delete(msg.id);
    } else {
      notifications.push(msg);
    }
  };
  child.stdout.on("data", (chunk: Buffer | string) => {
    stdoutBuffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = stdoutBuffer.indexOf("\n")) !== -1) {
      onStdoutLine(stdoutBuffer.slice(0, idx));
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
    }
  });
  child.stdout.on("end", () => {
    stdoutBuffer += decoder.decode();
    if (stdoutBuffer.length > 0) onStdoutLine(stdoutBuffer);
  });
  const exited = new Promise<number | null>((resolveExit) => child.on("close", resolveExit));
  return {
    child,
    notifications,
    exited,
    stderr: () => stderr,
    write(msg: Json) {
      child.stdin.write(`${JSON.stringify(msg)}\n`);
    },
    request(msg: Json): Promise<Json> {
      return new Promise((resolveMsg, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timeout waiting for ${msg.id}; stderr=${stderr}`)),
          10000,
        );
        waiters.set(msg.id, (res) => {
          clearTimeout(timer);
          resolveMsg(res);
        });
        child.stdin.write(`${JSON.stringify(msg)}\n`);
      });
    },
    close() {
      child.stdin.end();
      return exited;
    },
  };
}

async function writeFakeAgy(dir: string) {
  const fakeAgy = join(dir, "fake-agy");
  await writeFile(
    fakeAgy,
    `#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line);
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
  if (msg.method === "initialize") {
    reply({ argv: process.argv.slice(2), statePath: process.env.T3_AGY_MCP_STATE ?? null });
  } else if (msg.method?.startsWith("session/")) {
    const path = process.env.T3_AGY_MCP_STATE;
    let state = null, mode = null;
    try { state = JSON.parse(readFileSync(path, "utf8")); mode = statSync(path).mode & 0o777; } catch {}
    reply({ mcpServers: msg.params.mcpServers, state, mode });
  }
}
`,
    "utf8",
  );
  await chmod(fakeAgy, 0o755);
  return fakeAgy;
}

const specHash = (path: string) =>
  createHash("sha256").update(readFileSync(path, "utf8")).digest("hex");
const readyHash = (statePath: string) => {
  try {
    return readFileSync(`${statePath}.ready`, "utf8");
  } catch {
    return null;
  }
};
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => boolean, what: string) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

const t3Server = (token: string) => ({
  name: "t3-code",
  command: "/Applications/T3.app/t3",
  args: ["bin.mjs", "acp-mcp-bridge"],
  env: [
    { name: "ELECTRON_RUN_AS_NODE", value: "1" },
    { name: "T3_ACP_MCP_ENDPOINT", value: "http://127.0.0.1:1/mcp" },
    { name: "T3_ACP_MCP_AUTHORIZATION", value: `Bearer ${token}` },
  ],
});

test("acp mode adds telemetry and lean agent flags, moves t3-code into a private state file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agy-wrapper-acp-"));
  try {
    const fakeAgy = await writeFakeAgy(dir);
    const geminiDir = join(dir, "profile");
    await mkdir(join(geminiDir, "config", "agents"), { recursive: true });
    await writeFile(
      join(geminiDir, "config", "agents", "lean.md"),
      "---\nname: lean\n---\n",
      "utf8",
    );
    const stateDir = join(dir, "state");
    await mkdir(stateDir, { recursive: true });
    const orphan = join(stateDir, "999999.json");
    await writeFile(orphan, "{}", "utf8");
    const client = lineClient(wrapperPath, ["acp", "--gemini-dir", geminiDir], {
      ...process.env,
      AGY_UPSTREAM_BIN: fakeAgy,
      T3_AGY_MCP_STATE_DIR: stateDir,
    });

    const init = await client.request({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(init.result.argv).toEqual([
      "acp",
      "--gemini-dir",
      geminiDir,
      "--disable-telemetry",
      "--agent",
      "lean",
    ]);
    const statePath = init.result.statePath;
    expect(statePath.startsWith(stateDir)).toBe(true);
    expect(existsSync(orphan)).toBe(false);

    const other = { name: "other", command: "other-mcp", args: [], env: [] };
    const created = await client.request({
      jsonrpc: "2.0",
      id: 2,
      method: "session/new",
      params: { cwd: dir, mcpServers: [t3Server("tokA"), other] },
    });
    expect(created.result.mcpServers).toEqual([other]);
    expect(created.result.mode).toBe(0o600);
    expect(created.result.state).toEqual({
      command: "/Applications/T3.app/t3",
      args: ["bin.mjs", "acp-mcp-bridge"],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        T3_ACP_MCP_ENDPOINT: "http://127.0.0.1:1/mcp",
        T3_ACP_MCP_AUTHORIZATION: "Bearer tokA",
      },
    });

    const forked = await client.request({
      jsonrpc: "2.0",
      id: 3,
      method: "session/fork",
      params: { sessionId: "s1", cwd: dir, mcpServers: [t3Server("tokB")] },
    });
    expect(forked.result.mcpServers).toEqual([]);
    expect(forked.result.state.env.T3_ACP_MCP_AUTHORIZATION).toBe("Bearer tokB");

    const http = { type: "http", name: "t3-code", url: "http://127.0.0.1:1/mcp", headers: [] };
    const httpSession = await client.request({
      jsonrpc: "2.0",
      id: 4,
      method: "session/new",
      params: { cwd: dir, mcpServers: [http] },
    });
    expect(httpSession.result.mcpServers).toEqual([http]);

    expect(await client.close()).toBe(0);
    expect(existsSync(statePath)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("acp mode leaves the agent alone when lean is missing or an agent is already chosen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agy-wrapper-agent-"));
  try {
    const fakeAgy = await writeFakeAgy(dir);
    const env = { ...process.env, AGY_UPSTREAM_BIN: fakeAgy, T3_AGY_MCP_STATE_DIR: join(dir, "s") };
    const noLean = lineClient(wrapperPath, ["acp", "--gemini-dir", join(dir, "empty")], env);
    const a = await noLean.request({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(a.result.argv).toEqual([
      "acp",
      "--gemini-dir",
      join(dir, "empty"),
      "--disable-telemetry",
    ]);
    await noLean.close();

    const geminiDir = join(dir, "profile");
    await mkdir(join(geminiDir, "config", "agents"), { recursive: true });
    await writeFile(
      join(geminiDir, "config", "agents", "lean.md"),
      "---\nname: lean\n---\n",
      "utf8",
    );
    const chosen = lineClient(
      wrapperPath,
      ["acp", "--gemini-dir", geminiDir, "--agent", "other", "--disable-telemetry"],
      env,
    );
    const b = await chosen.request({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(b.result.argv).toEqual([
      "acp",
      "--gemini-dir",
      geminiDir,
      "--agent",
      "other",
      "--disable-telemetry",
    ]);
    await chosen.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("acp mode holds session requests until a live shim has T3's catalog for the new spec", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agy-wrapper-ready-"));
  try {
    const fakeAgy = await writeFakeAgy(dir);
    const stateDir = join(dir, "state");
    const client = lineClient(wrapperPath, ["acp"], {
      ...process.env,
      AGY_UPSTREAM_BIN: fakeAgy,
      T3_AGY_MCP_STATE_DIR: stateDir,
      T3_AGY_MCP_READY_MS: "300",
    });
    const init = await client.request({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const statePath: string = init.result.statePath;

    // No live shim: agy starts it during session/new with the spec already in place.
    await client.request({
      jsonrpc: "2.0",
      id: 2,
      method: "session/new",
      params: { cwd: dir, mcpServers: [t3Server("tokA")] },
    });

    await writeFile(`${statePath}.shim`, "1", "utf8");
    const replies: unknown[] = [];
    const held = client
      .request({
        jsonrpc: "2.0",
        id: 3,
        method: "session/new",
        params: { cwd: dir, mcpServers: [t3Server("tokB")] },
      })
      .then((res) => replies.push(res.id));
    const after = client
      .request({ jsonrpc: "2.0", id: 4, method: "initialize", params: {} })
      .then((res) => replies.push(res.id));
    await until(
      () => existsSync(statePath) && readFileSync(statePath, "utf8").includes("tokB"),
      "spec",
    );
    await sleep(100);
    expect(replies).toEqual([]);
    await writeFile(`${statePath}.ready`, specHash(statePath), "utf8");
    await Promise.all([held, after]);
    expect(replies).toEqual([3, 4]);

    // A shim that never reports ready only delays the session.
    const started = Date.now();
    const late = await client.request({
      jsonrpc: "2.0",
      id: 5,
      method: "session/load",
      params: { sessionId: "s1", cwd: dir, mcpServers: [t3Server("tokC")] },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(late.result.state.env.T3_ACP_MCP_AUTHORIZATION).toBe("Bearer tokC");
    expect(client.stderr()).toContain("t3-code shim not ready");

    expect(await client.close()).toBe(0);
    for (const suffix of ["", ".shim", ".ready"])
      expect(existsSync(`${statePath}${suffix}`)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function writeFakeBridge(dir: string) {
  const bridge = join(dir, "fake-t3-bridge.mjs");
  await writeFile(
    bridge,
    `import { createInterface } from "node:readline";
let initialized = false;
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line);
  if (!("id" in msg)) continue;
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
  if (msg.method === "initialize") {
    initialized = true;
    reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "t3-code", version: "1" } });
  } else if (!initialized) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32002, message: "not initialized" } }) + "\\n");
  } else if (msg.method === "tools/list") {
    reply({ tools: [{ name: "delegate_task", inputSchema: { type: "object" } }] });
  } else if (msg.method === "tools/call") {
    reply({ content: [{ type: "text", text: process.env.T3_ACP_MCP_AUTHORIZATION + ":" + msg.params.name }] });
  }
}
`,
    "utf8",
  );
  return bridge;
}

const writeState = (path: string, bridge: string, token: string) =>
  writeFile(
    path,
    JSON.stringify({
      command: process.execPath,
      args: [bridge],
      env: { T3_ACP_MCP_AUTHORIZATION: `Bearer ${token}` },
    }),
    { mode: 0o600 },
  );

const callText = (res: Json) => res.result.content[0].text;

test("shim bridges to T3 and restarts with a replayed handshake when the token changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agy-shim-"));
  try {
    const bridge = await writeFakeBridge(dir);
    const statePath = join(dir, "state.json");
    await writeState(statePath, bridge, "tokA");
    const shim = lineClient(shimPath, [], { ...process.env, T3_AGY_MCP_STATE: statePath });

    const init = await shim.request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect(init.result.serverInfo.name).toBe("t3-code");
    expect(existsSync(`${statePath}.shim`)).toBe(true);
    expect(readyHash(statePath)).toBe(null);
    shim.write({ jsonrpc: "2.0", method: "notifications/initialized" });
    const listed = await shim.request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(listed.result.tools.map((t: Json) => t.name)).toEqual(["delegate_task"]);
    expect(readyHash(statePath)).toBe(specHash(statePath));
    const first = await shim.request({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "delegate_task", arguments: {} },
    });
    expect(callText(first)).toBe("Bearer tokA:delegate_task");

    await writeState(statePath, bridge, "tokB");
    // An idle shim picks up the new token on its own; agy already has the catalog.
    await until(() => readyHash(statePath) === specHash(statePath), "ready for tokB");
    const second = await shim.request({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "delegate_task", arguments: {} },
    });
    expect(callText(second)).toBe("Bearer tokB:delegate_task");
    expect(shim.notifications).toEqual([]);

    expect(await shim.close()).toBe(0);
    expect(existsSync(`${statePath}.shim`)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shim serves an empty catalog without state and switches to T3 once state appears", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agy-shim-empty-"));
  try {
    const bridge = await writeFakeBridge(dir);
    const statePath = join(dir, "state.json");
    const shim = lineClient(shimPath, [], { ...process.env, T3_AGY_MCP_STATE: statePath });

    const init = await shim.request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities.tools.listChanged).toBe(true);
    shim.write({ jsonrpc: "2.0", method: "notifications/initialized" });
    const empty = await shim.request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(empty.result.tools).toEqual([]);
    const ping = await shim.request({ jsonrpc: "2.0", id: 3, method: "ping" });
    expect(ping.result).toEqual({});

    await writeState(statePath, bridge, "tokC");
    // Without any request from agy the shim attaches and announces the new catalog.
    await until(() => shim.notifications.length > 0, "list_changed");
    expect(shim.notifications).toEqual([
      { jsonrpc: "2.0", method: "notifications/tools/list_changed" },
    ]);
    expect(readyHash(statePath)).toBe(null);
    const listed = await shim.request({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} });
    expect(listed.result.tools.map((t: Json) => t.name)).toEqual(["delegate_task"]);
    expect(readyHash(statePath)).toBe(specHash(statePath));
    const call = await shim.request({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "delegate_task", arguments: {} },
    });
    expect(callText(call)).toBe("Bearer tokC:delegate_task");

    expect(await shim.close()).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const writeHttpState = async (path: string, endpoint: string, token: string) => {
  const tmp = `${path}.tmp`;
  await writeFile(
    tmp,
    JSON.stringify({
      command: "/nonexistent/t3-bridge-must-not-spawn",
      args: ["acp-mcp-bridge"],
      env: {
        T3_ACP_MCP_ENDPOINT: endpoint,
        T3_ACP_MCP_AUTHORIZATION: `Bearer ${token}`,
      },
    }),
    { mode: 0o600 },
  );
  await rename(tmp, path);
};

test("shim forwards directly over HTTP/SSE without spawning a bridge process and rotates tokens via fs.watch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agy-shim-http-"));
  const requests: Array<{ headers: Record<string, string | string[] | undefined>; body: Json }> =
    [];
  let releaseBlockedCall: (() => void) | null = null;
  let sessionCounter = 0;

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json;
    requests.push({ headers: req.headers, body });

    if (body.method === "initialize") {
      sessionCounter += 1;
      res.writeHead(200, {
        "content-type": "application/json",
        "mcp-session-id": `sess-${sessionCounter}`,
      });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "t3-code", version: "http" },
          },
        }),
      );
      return;
    }

    if (body.method === "notifications/initialized") {
      res.writeHead(202);
      res.end();
      return;
    }

    if (body.method === "tools/list") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [{ name: "delegate_task", inputSchema: { type: "object" } }] },
        }),
      );
      return;
    }

    if (body.method === "tools/call") {
      const mode = body.params?.arguments?.mode;
      if (mode === "sse") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(
          `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { step: 1 } })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [
                {
                  type: "text",
                  text: `${req.headers.authorization}:${req.headers["mcp-session-id"]}:${body.params.arguments.text}`,
                },
              ],
            },
          })}\n\n`,
        );
        res.end();
        return;
      }
      if (mode === "block") {
        await new Promise<void>((resolve) => {
          releaseBlockedCall = resolve;
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { content: [{ type: "text", text: `unblocked:${req.headers.authorization}` }] },
          }),
        );
        return;
      }
      if (mode === "fail") {
        res.writeHead(500);
        res.end("boom");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [
              {
                type: "text",
                text: `${req.headers.authorization}:${req.headers["mcp-session-id"]}`,
              },
            ],
          },
        }),
      );
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const endpoint = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/mcp`;

  try {
    const statePath = join(dir, "state.json");
    await writeHttpState(statePath, endpoint, "tokA");
    const shim = lineClient(shimPath, [], { ...process.env, T3_AGY_MCP_STATE: statePath });

    const init = await shim.request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect(init.result.serverInfo.version).toBe("http");
    shim.write({ jsonrpc: "2.0", method: "notifications/initialized" });

    const listed = await shim.request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(listed.result.tools.map((t: Json) => t.name)).toEqual(["delegate_task"]);
    expect(readyHash(statePath)).toBe(specHash(statePath));
    expect(requests.at(-1)?.headers["mcp-session-id"]).toBe("sess-1");
    expect(requests.at(-1)?.headers["mcp-protocol-version"]).toBe("2025-06-18");

    // SSE response + U+2028/U+2029 preservation.
    const sseCall = await shim.request({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "delegate_task", arguments: { mode: "sse", text: "a\u2028b\u2029c" } },
    });
    expect(callText(sseCall)).toBe("Bearer tokA:sess-1:a\u2028b\u2029c");
    expect(shim.notifications).toEqual([
      { jsonrpc: "2.0", method: "notifications/progress", params: { step: 1 } },
    ]);

    // Idle token rotation via fs.watch.
    await writeHttpState(statePath, endpoint, "tokB");
    await until(() => readyHash(statePath) === specHash(statePath), "ready for tokB");

    // Concurrent calls + deferred state update while pending.
    const blockedPromise = shim.request({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "delegate_task", arguments: { mode: "block" } },
    });
    await until(() => releaseBlockedCall !== null, "blocked call reached server");

    // Second concurrent call resolves even while id=4 is blocked, and updates state mid-flight.
    const fastCall = await shim.request({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "delegate_task", arguments: {} },
    });
    expect(callText(fastCall)).toBe("Bearer tokB:sess-2");

    await writeHttpState(statePath, endpoint, "tokC");
    // While id=4 is still pending, shim defers switching to tokC.
    expect(readyHash(statePath)).not.toBe(specHash(statePath));
    releaseBlockedCall!();
    const blockedRes = await blockedPromise;
    expect(callText(blockedRes)).toBe("unblocked:Bearer tokB");

    // Once pending drains, deferred sync picks up tokC automatically.
    await until(() => readyHash(statePath) === specHash(statePath), "ready for tokC");
    const afterRotate = await shim.request({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "delegate_task", arguments: {} },
    });
    expect(callText(afterRotate)).toBe("Bearer tokC:sess-3");

    // HTTP 500 produces a JSON-RPC error response.
    const failed = await shim.request({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "delegate_task", arguments: { mode: "fail" } },
    });
    expect(failed.error.code).toBe(-32603);
    expect(failed.error.message).toContain("HTTP 500");

    expect(await shim.close()).toBe(0);
    expect(existsSync(`${statePath}.shim`)).toBe(false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
