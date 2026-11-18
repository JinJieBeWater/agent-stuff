// Stdio MCP server listed as `t3-code` in the T3 profile's mcp_config.json, so agy applies its
// native lazy loading, disabledTools and eager settings to T3's tools. acp-wrapper.mjs writes the
// bridge launch spec T3 sent with the session to $T3_AGY_MCP_STATE. agy starts this server once
// per process, but a fork can bring a new thread token, so the spec is re-read before each request
// and polled while idle, and the bridge restarted (handshake replayed) when it changes.
//
// agy usually starts this server at ACP authenticate, before any spec exists, and fixes a session's
// tools when the session is created. So the catalog starts empty, a new spec is announced with
// tools/list_changed, and once agy holds the real catalog for that spec the shim writes
// `<state>.ready` (spec hash). The wrapper holds session/new until then while `<state>.shim` exists.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const statePath = process.env.T3_AGY_MCP_STATE;
const REPLAY_ID = "__t3_shim_initialize__";
const POLL_MS = 50;
const EMPTY_RESULTS = {
  ping: {},
  "tools/list": { tools: [] },
  "resources/list": { resources: [] },
  "resources/templates/list": { resourceTemplates: [] },
  "prompts/list": { prompts: [] },
};

let initRequest = null;
let initialized = false;
// What agy last received from tools/list: null (never asked), "empty", or the bridge key it came from.
let listedFrom = null;
let bridge = null;

const writeLine = (line) => process.stdout.write(`${line}\n`);
const send = (msg) => writeLine(JSON.stringify(msg));
const isRequest = (msg) => msg !== null && "id" in msg && typeof msg.method === "string";
const isResponse = (msg) => msg !== null && "id" in msg && msg.method === undefined;
const specHash = (key) => createHash("sha256").update(key).digest("hex");

function readState() {
  if (!statePath) return null;
  try {
    const raw = readFileSync(statePath, "utf8");
    return { key: raw, spec: JSON.parse(raw) };
  } catch {
    return null;
  }
}

function markReady(key) {
  if (!statePath) return;
  try {
    const tmp = `${statePath}.ready.tmp`;
    writeFileSync(tmp, specHash(key), { mode: 0o600 });
    renameSync(tmp, `${statePath}.ready`);
  } catch {}
}

function startBridge({ key, spec }) {
  const proc = spawn(spec.command, spec.args ?? [], {
    env: { ...process.env, ...spec.env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const b = { proc, key, pending: new Set(), toolLists: new Set(), onReplay: null, done: false };
  const finish = () => {
    if (b.done) return;
    b.done = true;
    b.onReplay?.(null);
    if (bridge !== b) return;
    bridge = null;
    for (const id of b.pending) {
      send({ jsonrpc: "2.0", id, error: { code: -32000, message: "T3 Code MCP bridge exited" } });
    }
  };
  proc.on("error", (error) => {
    process.stderr.write(`t3-mcp-shim: ${error.message}\n`);
    finish();
  });
  proc.on("exit", finish);
  proc.stdin.on("error", () => {});
  createInterface({ input: proc.stdout, crlfDelay: Infinity }).on("line", (line) => {
    if (!line.trim()) return;
    let msg = null;
    try {
      msg = JSON.parse(line);
    } catch {}
    if (msg?.id === REPLAY_ID && isResponse(msg)) {
      b.onReplay?.(msg);
      return;
    }
    if (bridge !== b) return;
    if (isResponse(msg)) {
      b.pending.delete(msg.id);
      if (b.toolLists.delete(msg.id) && !msg.error) {
        listedFrom = b.key;
        markReady(b.key);
      }
    }
    writeLine(line);
  });
  return b;
}

function stopBridge(b) {
  b.done = true;
  b.proc.stdin.end();
  b.proc.kill();
}

async function syncBridge(msg) {
  if (bridge && bridge.pending.size > 0) return;
  const state = readState();
  if ((bridge?.key ?? null) === (state?.key ?? null)) return;
  if (bridge) {
    stopBridge(bridge);
    bridge = null;
  }
  if (!state) return;
  const b = startBridge(state);
  bridge = b;
  if (!initRequest || msg === initRequest) return;
  const reply = await new Promise((resolve) => {
    b.onReplay = resolve;
    b.proc.stdin.write(`${JSON.stringify({ ...initRequest, id: REPLAY_ID })}\n`);
  });
  b.onReplay = null;
  if (!reply || reply.error) {
    if (bridge === b) bridge = null;
    stopBridge(b);
    return;
  }
  if (initialized) {
    b.proc.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
  }
  if (listedFrom === "empty") {
    send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  } else if (listedFrom !== null) {
    // agy already holds T3's catalog; only the bridge's token changed.
    listedFrom = b.key;
    markReady(b.key);
  }
}

function answerEmpty(msg) {
  if (!isRequest(msg)) return;
  if (msg.method === "tools/list") listedFrom = "empty";
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "t3-code", version: "shim" },
      },
    });
  } else if (msg.method in EMPTY_RESULTS) {
    send({ jsonrpc: "2.0", id: msg.id, result: EMPTY_RESULTS[msg.method] });
  } else {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: "T3 Code is not attached" },
    });
  }
}

async function handleLine(line) {
  if (!line.trim()) return;
  let msg = null;
  try {
    msg = JSON.parse(line);
  } catch {}
  if (msg?.method === "initialize" && isRequest(msg)) initRequest = msg;
  if (msg?.method === "notifications/initialized") initialized = true;
  await syncBridge(msg);
  if (bridge) {
    if (isRequest(msg)) {
      bridge.pending.add(msg.id);
      if (msg.method === "tools/list") bridge.toolLists.add(msg.id);
    }
    bridge.proc.stdin.write(`${line}\n`);
  } else if (msg) {
    answerEmpty(msg);
  }
}

function finishInput() {
  if (bridge && !bridge.done) {
    const last = bridge;
    last.proc.on("exit", () => process.exit(0));
    last.proc.stdin.end();
  } else {
    process.exit(0);
  }
}

// Messages and idle polls run one at a time so a bridge restart never interleaves with a request.
let queue = Promise.resolve();
const enqueue = (task) => {
  queue = queue.then(task).catch((error) => {
    process.stderr.write(`t3-mcp-shim: ${error?.stack ?? error}\n`);
  });
};

if (statePath) {
  const alivePath = `${statePath}.shim`;
  writeFileSync(alivePath, String(process.pid), { mode: 0o600 });
  process.on("exit", () => rmSync(alivePath, { force: true }));
  let polling = false;
  setInterval(() => {
    if (polling || !initRequest) return;
    polling = true;
    enqueue(async () => {
      await syncBridge(null);
      polling = false;
    });
  }, POLL_MS).unref();
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => enqueue(() => handleLine(line)));
input.on("close", () => enqueue(finishInput));
