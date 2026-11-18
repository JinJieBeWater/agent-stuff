import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const filterScript = join(here, "t3-mcp-filter.mjs");

function readSemver(binPath) {
  try {
    const out = execFileSync(binPath, ["--version"], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(out);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  } catch {
    return null;
  }
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function resolveUpstreamBinary() {
  if (process.env.AGY_UPSTREAM_BIN) return process.env.AGY_UPSTREAM_BIN;
  const home = process.env.HOME || homedir();
  const target = `${process.platform === "win32" ? "win32" : process.platform}-${process.arch}`;
  const managedRoot = join(home, ".t3", "tools", "antigravity-acp", target);
  const activeFile = join(managedRoot, "active.json");
  let managedBin = null;
  if (existsSync(activeFile)) {
    try {
      const { releaseId } = JSON.parse(readFileSync(activeFile, "utf8"));
      const binName = process.platform === "win32" ? "agy.exe" : "antigravity";
      const candidate = join(managedRoot, "versions", releaseId, binName);
      if (existsSync(candidate)) managedBin = candidate;
    } catch {
      // Fall back to user agy CLI.
    }
  }
  const localBin = join(home, ".local", "bin", process.platform === "win32" ? "agy.exe" : "agy");
  if (!managedBin) return localBin;
  if (!existsSync(localBin)) return managedBin;

  const managedVer = readSemver(managedBin);
  const localVer = readSemver(localBin);
  if (localVer && (!managedVer || compareSemver(localVer, managedVer) > 0)) {
    return localBin;
  }
  return managedBin;
}

function wrapMcpServers(mcpServers) {
  if (!Array.isArray(mcpServers)) return mcpServers;
  return mcpServers.map((server) => {
    if (
      !server ||
      typeof server !== "object" ||
      server.name !== "t3-code" ||
      typeof server.command !== "string"
    ) {
      return server;
    }
    const existingEnv = Array.isArray(server.env) ? server.env : [];
    const filteredEnv = existingEnv.filter(
      (entry) => entry?.name !== "T3_ORIG_MCP_COMMAND" && entry?.name !== "T3_ORIG_MCP_ARGS_JSON",
    );
    return {
      ...server,
      args: [filterScript],
      env: [
        ...filteredEnv,
        { name: "T3_ORIG_MCP_COMMAND", value: server.command },
        { name: "T3_ORIG_MCP_ARGS_JSON", value: JSON.stringify(server.args ?? []) },
      ],
    };
  });
}

const args = process.argv.slice(2);
const upstreamBin = resolveUpstreamBinary();

if (args[0] !== "acp") {
  const child = spawn(upstreamBin, args, { stdio: "inherit" });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
} else {
  const acpArgs =
    args.includes("--disable-telemetry") || args.includes("--disable_telemetry")
      ? args
      : [...args, "--disable-telemetry"];
  const child = spawn(upstreamBin, acpArgs, {
    stdio: ["pipe", "pipe", "inherit"],
  });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));

  const bridge = process.env.RYUGI_T3_WATCH_BIN || join(homedir(), ".local/bin/ryugi-t3-watch");
  const execute = promisify(execFile);
  const opening = new Map();
  const sessions = new Map();
  const prompts = new Map();

  async function discover(server, cwd) {
    const marker = server.args?.indexOf("acp-mcp-bridge") ?? -1;
    const env = Object.fromEntries((server.env || []).map(({ name, value }) => [name, value]));
    if (marker < 0 || !env.T3_ACP_MCP_ENDPOINT || !env.T3_ACP_MCP_AUTHORIZATION) return;
    try {
      const args = [
        ...server.args.slice(0, marker),
        "acp-mcp-call",
        "orchestrator_capabilities",
        "{}",
      ];
      const { stdout } = await execute(server.command, args, {
        env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: "1" },
        cwd,
        timeout: 5000,
        killSignal: "SIGKILL",
        maxBuffer: 4 * 1024 * 1024,
      });
      const result = JSON.parse(stdout);
      const value =
        result.structuredContent ??
        (result.content?.[0]?.text ? JSON.parse(result.content[0].text) : result);
      if (typeof value.parentThreadId === "string") return value.parentThreadId;
    } catch {
      /* The ACP stream is authoritative even if discovery fails. */
    }
  }

  async function lifecycle(op, state, extra = [], timeout = 8000) {
    if (!state.thread) return "";
    try {
      const args = [
        op,
        "--cwd",
        state.cwd,
        "--host",
        "Antigravity",
        "--thread",
        state.thread,
        ...extra,
      ];
      const { stdout } = await execute(bridge, args, { timeout, killSignal: "SIGKILL" });
      return stdout.trimEnd();
    } catch {
      return "";
    }
  }

  async function incoming(line) {
    const msg = JSON.parse(line);
    const params = msg?.params;
    if (["session/new", "session/load", "session/resume"].includes(msg.method)) {
      if (params?.sessionId) sessions.delete(params.sessionId);
      if (!Array.isArray(params?.mcpServers)) return line;
      const server = params.mcpServers.find(
        (s) => s?.name === "t3-code" && typeof s.command === "string",
      );
      if (server && typeof params.cwd === "string" && existsSync(bridge)) {
        const state = { cwd: params.cwd, thread: null, calls: new Map() };
        state.ready = discover(server, state.cwd).then((thread) => {
          state.thread = thread;
          if (thread) void lifecycle("session-start", state);
        });
        opening.set(msg.id, { state, sessionId: params.sessionId });
      }
      params.mcpServers = wrapMcpServers(params.mcpServers);
      return JSON.stringify(msg);
    }
    if (msg.method === "session/prompt" && Array.isArray(params?.prompt)) {
      const state = sessions.get(params.sessionId);
      if (state) {
        const deadline = Date.now() + 1500;
        let timer;
        await Promise.race([
          state.ready,
          new Promise((r) => {
            timer = setTimeout(r, 1500);
          }),
        ]);
        clearTimeout(timer);
        prompts.set(msg.id, state);
        const text = params.prompt
          .filter((p) => p?.type === "text")
          .map((p) => p.text)
          .join("\n");
        const budget = deadline - Date.now();
        const context =
          budget > 0 &&
          (await lifecycle(
            "selection-context",
            state,
            ["--session-id", params.sessionId, "--prompt=" + text],
            budget,
          ));
        if (context) {
          params.prompt.unshift({ type: "text", text: context });
          return JSON.stringify(msg);
        }
      }
    }
    return line;
  }

  function outgoing(msg) {
    if (!msg || typeof msg !== "object") return;
    if (!msg.method && opening.has(msg.id)) {
      const { state, sessionId } = opening.get(msg.id);
      opening.delete(msg.id);
      const id = msg.result?.sessionId || sessionId;
      if (!msg.error && id) sessions.set(id, state);
    }
    if (!msg.method && prompts.has(msg.id)) {
      const state = prompts.get(msg.id);
      prompts.delete(msg.id);
      state.calls.clear();
      void lifecycle("turn-end", state);
    }
    if (msg.method !== "session/update") return;
    const state = sessions.get(msg.params?.sessionId);
    const update = msg.params?.update;
    if (
      !state?.thread ||
      !update ||
      !["tool_call", "tool_call_update"].includes(update.sessionUpdate) ||
      update.kind === "edit" ||
      update.kind === "read"
    )
      return;
    if (![...prompts.values()].includes(state)) return; // load can replay historical tool calls
    const id = update.toolCallId;
    if (!id) return;
    const rawIn = update.rawInput && typeof update.rawInput === "object" ? update.rawInput : null;
    const rawOut =
      update.rawOutput && typeof update.rawOutput === "object" ? update.rawOutput : null;
    const command =
      rawIn?.CommandLine ??
      rawIn?.command_line ??
      rawIn?.commandLine ??
      rawIn?.command ??
      rawOut?.commandLine ??
      rawOut?.command_line;
    const cwd = rawIn?.Cwd ?? rawIn?.cwd ?? rawIn?.WorkingDirectory ?? rawIn?.working_dir;
    if (
      typeof command === "string" &&
      command.includes("--artifact") &&
      command.includes("ryugi")
    ) {
      const prev = state.calls.get(id);
      state.calls.set(id, { command, cwd: cwd || prev?.cwd || state.cwd });
    }
    if (["completed", "failed", "cancelled"].includes(update.status)) {
      const call = state.calls.get(id);
      state.calls.delete(id);
      if (update.status === "completed" && call?.command) {
        void lifecycle("observe-command", { ...state, cwd: call.cwd }, [
          "--command=" + call.command,
        ]);
      }
    }
  }

  // Forward bytes directly. The second reader observes JSON frames only.
  child.stdout.pipe(process.stdout, { end: false });
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  output.on("line", (line) => {
    try {
      outgoing(JSON.parse(line));
    } catch {
      /* Non-protocol output still passes through. */
    }
  });
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  child.on("close", (code, signal) => {
    input.close();
    process.stdin.pause();
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code ?? 0;
  });
  child.stdin.on("error", () => input.close());
  for await (const line of input) {
    let forwarded = line;
    try {
      forwarded = await incoming(line);
    } catch {
      /* Forward unchanged on bridge errors. */
    }
    if (!child.stdin.destroyed) child.stdin.write(forwarded + "\n");
  }
  child.stdin.end();
}
