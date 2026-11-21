// Stdio MCP server listed as `t3-code` in the T3 profile's mcp_config.json, so agy applies its
// native lazy loading, disabledTools and eager settings to T3's tools. acp-wrapper.mjs writes the
// MCP launch spec T3 sent with the session to $T3_AGY_MCP_STATE. agy starts this server once per
// process, but a fork can bring a new thread token, so the spec is re-read before each request and
// watched via fs.watch while idle, replaying the handshake when it changes.
//
// When spec.url or spec.env.T3_ACP_MCP_ENDPOINT is present (all T3 ACP sessions), this shim
// forwards JSON-RPC directly to T3's HTTP/SSE endpoint via fetch instead of spawning acp-mcp-bridge.
//
// agy usually starts this server at ACP authenticate, before any spec exists, and fixes a session's
// tools when the session is created. So the catalog starts empty, a new spec is announced with
// tools/list_changed, and once agy holds the real catalog for that spec the shim writes
// `<state>.ready` (spec hash). The wrapper holds session/new until then while `<state>.shim` exists.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, watch, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";

const statePath = process.env.T3_AGY_MCP_STATE;
const REPLAY_ID = "__t3_shim_initialize__";
const SSE_EVENT_SEPARATOR = /(?:\r\n|\r(?!\n)|\n){2}/u;
const SEPARATOR_OVERLAP = 3;
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
let syncDeferred = false;
let stateWatcher = null;
let triggerSync = () => {};

const writeLine = (line, onFlushed) => process.stdout.write(`${line}\n`, onFlushed);
const send = (msg) => writeLine(JSON.stringify(msg));
const isRequest = (msg) => msg !== null && "id" in msg && typeof msg.method === "string";
const isResponse = (msg) =>
  msg !== null && "id" in msg && ("result" in msg || "error" in msg) && msg.method === undefined;
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

function handleBridgeMessage(b, msg, rawLine) {
  if (bridge !== b || b.done) return;
  const line = rawLine ?? JSON.stringify(msg);
  if (isResponse(msg)) {
    b.pending.delete(msg.id);
    if (b.toolLists.delete(msg.id) && !msg.error) {
      listedFrom = b.key;
      markReady(b.key);
    }
  }
  writeLine(line);
  if (b.pending.size === 0 && syncDeferred) {
    syncDeferred = false;
    triggerSync();
  }
}

function sseEventData(rawEvent) {
  return rawEvent
    .split(/\r\n|\r|\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
}

async function* sseDataLines(reader) {
  const decoder = new TextDecoder();
  let eventParts = [];
  let unscanned = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    let text = unscanned + decoder.decode(value, { stream: true });
    let separator = SSE_EVENT_SEPARATOR.exec(text);
    while (separator !== null) {
      eventParts.push(text.slice(0, separator.index));
      const data = sseEventData(eventParts.join(""));
      eventParts = [];
      text = text.slice(separator.index + separator[0].length);
      if (data.length > 0) yield data;
      separator = SSE_EVENT_SEPARATOR.exec(text);
    }
    const scannedLength = Math.max(0, text.length - SEPARATOR_OVERLAP);
    eventParts.push(text.slice(0, scannedLength));
    unscanned = text.slice(scannedLength);
  }
}

function protocolVersionOf(entry) {
  const version = entry?.result?.protocolVersion;
  return typeof version === "string" && version.length > 0 ? version : null;
}

function httpTarget(spec) {
  if (typeof spec?.url === "string" && spec.url.length > 0) {
    const headers = {};
    if (spec.headers && typeof spec.headers === "object") {
      for (const [name, value] of Object.entries(spec.headers)) {
        if (typeof value === "string") headers[name.toLowerCase()] = value;
      }
    }
    return { endpoint: spec.url, headers };
  }
  const endpoint = spec?.env?.T3_ACP_MCP_ENDPOINT;
  if (typeof endpoint === "string" && endpoint.length > 0) {
    const headers = {};
    if (typeof spec.env.T3_ACP_MCP_AUTHORIZATION === "string") {
      headers.authorization = spec.env.T3_ACP_MCP_AUTHORIZATION;
    }
    return { endpoint, headers };
  }
  return null;
}

function startHttpBridge({ key }, target) {
  const { endpoint, headers: baseHeaders } = target;
  const controller = new AbortController();
  let sessionId = null;
  let protocolVersion = null;
  let sessionBarrier = Promise.resolve();
  let sessionBarrierPending = false;

  const b = {
    key,
    pending: new Set(),
    toolLists: new Set(),
    inFlight: new Set(),
    done: false,
    send: null,
    replayInitialize: null,
    stop: null,
    close: null,
  };

  async function postMessage(line, msg, isReplay = false) {
    const failPending = (message) => {
      if (isReplay || !isRequest(msg) || !b.pending.has(msg.id)) return;
      if (!b.done && bridge === b) {
        handleBridgeMessage(b, {
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32603, message },
        });
      } else {
        b.pending.delete(msg.id);
        b.toolLists.delete(msg.id);
      }
    };

    const headers = {
      ...baseHeaders,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (sessionId !== null) headers["mcp-session-id"] = sessionId;
    if (protocolVersion !== null) headers["mcp-protocol-version"] = protocolVersion;

    try {
      let response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: line,
          signal: controller.signal,
        });
      } catch (error) {
        if (isReplay) return null;
        failPending(`T3 Code MCP bridge request failed: ${error?.message ?? String(error)}`);
        return null;
      }

      sessionId = response.headers.get("mcp-session-id") ?? sessionId;
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const errMsg = `T3 Code MCP endpoint responded with HTTP ${response.status}.`;
        if (isReplay) return { error: { code: -32603, message: errMsg } };
        failPending(errMsg);
        return null;
      }

      if (response.status === 202 || response.status === 204 || !response.body) {
        await response.body?.cancel().catch(() => {});
        return null;
      }

      const mediaType = (response.headers.get("content-type") ?? "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();

      if (mediaType === "text/event-stream") {
        const reader = response.body.getReader();
        try {
          for await (const data of sseDataLines(reader)) {
            let payload;
            try {
              payload = JSON.parse(data);
            } catch {
              continue;
            }
            for (const entry of Array.isArray(payload) ? payload : [payload]) {
              protocolVersion = protocolVersionOf(entry) ?? protocolVersion;
              if (isReplay && entry?.id === REPLAY_ID && isResponse(entry)) {
                return entry;
              }
              if (!isReplay) handleBridgeMessage(b, entry);
            }
          }
        } catch (error) {
          failPending(`T3 Code MCP bridge request failed: ${error?.message ?? String(error)}`);
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        return null;
      }

      let text = "";
      try {
        text = await response.text();
      } catch (error) {
        failPending(`T3 Code MCP bridge request failed: ${error?.message ?? String(error)}`);
        return null;
      }

      if (!text.trim()) return null;
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        failPending(`T3 Code MCP bridge request failed: ${error?.message ?? String(error)}`);
        return null;
      }

      for (const entry of Array.isArray(payload) ? payload : [payload]) {
        protocolVersion = protocolVersionOf(entry) ?? protocolVersion;
        if (isReplay && entry?.id === REPLAY_ID && isResponse(entry)) {
          return entry;
        }
        if (!isReplay) handleBridgeMessage(b, entry);
      }
      return null;
    } finally {
      failPending("T3 Code MCP endpoint returned no response.");
    }
  }

  function track(promise) {
    b.inFlight.add(promise);
    promise.finally(() => b.inFlight.delete(promise));
    return promise;
  }

  b.send = (line, msg) => {
    const isHandshake = msg?.method === "initialize" || msg?.method === "notifications/initialized";
    if (isResponse(msg)) {
      track(postMessage(line, msg));
      return;
    }
    if (isHandshake) {
      const task = track(sessionBarrier.then(() => postMessage(line, msg)));
      sessionBarrier = task.catch(() => {});
      sessionBarrierPending = true;
      const currentBarrier = sessionBarrier;
      currentBarrier.finally(() => {
        if (sessionBarrier === currentBarrier) sessionBarrierPending = false;
      });
      return task;
    }
    const task = sessionBarrierPending
      ? sessionBarrier.then(() => postMessage(line, msg))
      : postMessage(line, msg);
    return track(task);
  };

  b.replayInitialize = (initMsg) =>
    postMessage(JSON.stringify({ ...initMsg, id: REPLAY_ID }), initMsg, true);

  b.stop = () => {
    b.done = true;
    controller.abort();
  };

  b.close = async () => {
    await Promise.allSettled(b.inFlight);
  };

  return b;
}

function startStdioBridge({ key, spec }) {
  const proc = spawn(spec.command, spec.args ?? [], {
    env: { ...process.env, ...spec.env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const b = {
    key,
    pending: new Set(),
    toolLists: new Set(),
    done: false,
    onReplay: null,
    send: (line) => {
      proc.stdin.write(`${line}\n`);
    },
    replayInitialize: (initMsg) =>
      new Promise((resolve) => {
        b.onReplay = resolve;
        proc.stdin.write(`${JSON.stringify({ ...initMsg, id: REPLAY_ID })}\n`);
      }),
    stop: () => {
      b.done = true;
      proc.stdin.end();
      proc.kill();
    },
    close: () =>
      new Promise((resolve) => {
        if (proc.exitCode !== null || proc.signalCode !== null) {
          resolve();
          return;
        }
        proc.on("exit", () => resolve());
        proc.stdin.end();
      }),
  };
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
  listenLines(
    proc.stdout,
    (line) => {
      if (!line.trim()) return;
      let msg = null;
      try {
        msg = JSON.parse(line);
      } catch {}
      if (msg?.id === REPLAY_ID && isResponse(msg)) {
        b.onReplay?.(msg);
        return;
      }
      handleBridgeMessage(b, msg, line);
    },
    () => {},
  );
  return b;
}

function startBridge(state) {
  const target = httpTarget(state.spec);
  if (target) return startHttpBridge(state, target);
  return startStdioBridge(state);
}

async function syncBridge(msg) {
  if (bridge && bridge.pending.size > 0) {
    syncDeferred = true;
    return;
  }
  const state = readState();
  if ((bridge?.key ?? null) === (state?.key ?? null)) return;
  if (bridge) {
    bridge.stop();
    bridge = null;
  }
  if (!state) return;
  const b = startBridge(state);
  bridge = b;
  if (!initRequest || msg === initRequest) return;
  const reply = await b.replayInitialize(initRequest);
  if (!reply || reply.error) {
    if (bridge === b) bridge = null;
    b.stop();
    return;
  }
  if (initialized) {
    const notif = { jsonrpc: "2.0", method: "notifications/initialized" };
    await b.send(JSON.stringify(notif), notif);
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
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (msg?.method === "initialize" && isRequest(msg)) initRequest = msg;
  if (msg?.method === "notifications/initialized") initialized = true;
  await syncBridge(msg);
  if (bridge) {
    if (isRequest(msg)) {
      bridge.pending.add(msg.id);
      if (msg.method === "tools/list") bridge.toolLists.add(msg.id);
    }
    bridge.send(line, msg);
  } else if (msg) {
    answerEmpty(msg);
  }
}

async function finishInput() {
  stateWatcher?.close();
  stateWatcher = null;
  if (bridge && !bridge.done) {
    await bridge.close();
  }
  process.exit(0);
}

// Split strictly on LF/CRLF rather than node:readline, which splits on U+2028/U+2029 inside JSON strings.
function listenLines(stream, onLine, onClose) {
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (raw) => onLine(raw.endsWith("\r") ? raw.slice(0, -1) : raw);
  stream.on("data", (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      flush(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  });
  stream.on("end", () => {
    buffer += decoder.decode();
    if (buffer.length > 0) flush(buffer);
    onClose();
  });
}

// Messages and watch-triggered syncs run one at a time so a bridge switch never interleaves with a request.
let queue = Promise.resolve();
const enqueue = (task) => {
  queue = queue.then(task).catch((error) => {
    process.stderr.write(`t3-mcp-shim: ${error?.stack ?? error}\n`);
  });
};

if (statePath) {
  const stateDir = dirname(statePath);
  const stateBase = basename(statePath);
  const alivePath = `${statePath}.shim`;
  writeFileSync(alivePath, String(process.pid), { mode: 0o600 });
  process.on("exit", () => rmSync(alivePath, { force: true }));

  let syncQueued = false;
  triggerSync = () => {
    if (syncQueued || !initRequest) return;
    syncQueued = true;
    enqueue(async () => {
      syncQueued = false;
      await syncBridge(null);
    });
  };
  try {
    stateWatcher = watch(stateDir, (_event, filename) => {
      if (!filename || filename === stateBase) triggerSync();
    });
    stateWatcher.on("error", () => {});
    stateWatcher.unref();
  } catch {
    // State directory unavailable; handleLine still refreshes on each request.
  }
}

listenLines(
  process.stdin,
  (line) => enqueue(() => handleLine(line)),
  () => enqueue(finishInput),
);
