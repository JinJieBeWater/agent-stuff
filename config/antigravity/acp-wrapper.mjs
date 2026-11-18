import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

const T3_SERVER_NAME = "t3-code";
const DEFAULT_AGENT = "lean";
const SESSION_METHODS = new Set(["session/new", "session/load", "session/resume", "session/fork"]);
const SHIM_READY_MS = Number(process.env.T3_AGY_MCP_READY_MS ?? 10_000);
const SHIM_SETTLE_MS = 100;
const STATE_SUFFIXES = ["", ".tmp", ".shim", ".ready", ".ready.tmp"];

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

// T3 hands its MCP bridge to agy per session, which skips agy's native lazy loading and per-tool
// config. Pull the stdio entry out and leave its launch spec in a private file; the profile's
// mcp_config.json starts bin/t3-mcp-shim, which reads that file and runs the real bridge.
// Returns the servers left for agy and the spec text written, or null when nothing was taken.
function takeT3Server(mcpServers, statePath) {
  const index = mcpServers.findIndex(
    (server) => server?.name === T3_SERVER_NAME && typeof server.command === "string",
  );
  if (index === -1) {
    if (mcpServers.some((server) => server?.name === T3_SERVER_NAME)) {
      process.stderr.write("antigravity wrapper: non-stdio t3-code MCP server left untrimmed\n");
    }
    return { mcpServers, written: null };
  }
  const server = mcpServers[index];
  const state = {
    command: server.command,
    args: server.args ?? [],
    env: Object.fromEntries((server.env ?? []).map((entry) => [entry.name, entry.value])),
  };
  const written = JSON.stringify(state);
  const tmp = `${statePath}.tmp`;
  writeFileSync(tmp, written, { mode: 0o600 });
  renameSync(tmp, statePath);
  return { mcpServers: mcpServers.filter((_, i) => i !== index), written };
}

// agy fixes a session's tools when the session is created, and a shim started at authenticate has
// no spec yet. While a shim is alive, hold the session request until it reports that agy has T3's
// catalog for this spec. Without a live shim agy starts it during this request, spec in place.
async function waitForShim(statePath, written) {
  if (!existsSync(`${statePath}.shim`)) return;
  const hash = createHash("sha256").update(written).digest("hex");
  const isReady = () => {
    try {
      return readFileSync(`${statePath}.ready`, "utf8") === hash;
    } catch {
      return false;
    }
  };
  if (isReady()) return;
  const deadline = Date.now() + SHIM_READY_MS;
  while (!isReady()) {
    if (Date.now() >= deadline) {
      process.stderr.write(
        "antigravity wrapper: t3-code shim not ready; session may lack T3 tools\n",
      );
      return;
    }
    await sleep(25);
  }
  // The shim marks ready as it hands agy the catalog; give agy a moment to take it in.
  await sleep(SHIM_SETTLE_MS);
}

// A wrapper that dies without its exit handler leaves a live bearer token behind.
function removeOrphanedStates(stateDir) {
  for (const name of readdirSync(stateDir)) {
    const pid = Number(/^(\d+)\.json(?:\.[a-z.]+)?$/.exec(name)?.[1]);
    if (!pid || pid === process.pid) continue;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") rmSync(join(stateDir, name), { force: true });
    }
  }
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function acpArgsFor(args) {
  const out = [...args];
  if (!out.includes("--disable-telemetry") && !out.includes("--disable_telemetry")) {
    out.push("--disable-telemetry");
  }
  const agent = process.env.AGY_T3_AGENT ?? DEFAULT_AGENT;
  const geminiDir = optionValue(out, "--gemini-dir");
  if (
    agent &&
    !out.includes("--agent") &&
    geminiDir &&
    existsSync(join(geminiDir, "config", "agents", `${agent}.md`))
  ) {
    out.push("--agent", agent);
  }
  return out;
}

const args = process.argv.slice(2);
const upstreamBin = resolveUpstreamBinary();

if (args[0] !== "acp") {
  const child = spawn(upstreamBin, args, { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
} else {
  const stateDir = process.env.T3_AGY_MCP_STATE_DIR || join(tmpdir(), "t3-agy-mcp");
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  removeOrphanedStates(stateDir);
  const statePath = join(stateDir, `${process.pid}.json`);
  const removeState = () => {
    for (const suffix of STATE_SUFFIXES) rmSync(`${statePath}${suffix}`, { force: true });
  };
  process.on("exit", removeState);

  const child = spawn(upstreamBin, acpArgsFor(args), {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, T3_AGY_MCP_STATE: statePath },
  });
  const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of forwardedSignals) process.on(signal, () => child.kill(signal));

  child.stdout.pipe(process.stdout);

  const forward = async (line) => {
    if (line.trim()) {
      let msg = null;
      try {
        msg = JSON.parse(line);
      } catch {
        // Forward unparsed lines unchanged.
      }
      if (SESSION_METHODS.has(msg?.method) && Array.isArray(msg.params?.mcpServers)) {
        let taken = null;
        try {
          taken = takeT3Server(msg.params.mcpServers, statePath);
        } catch (error) {
          process.stderr.write(`antigravity wrapper: ${error.message}\n`);
        }
        if (taken) {
          if (taken.written) await waitForShim(statePath, taken.written);
          msg.params = { ...msg.params, mcpServers: taken.mcpServers };
          child.stdin.write(`${JSON.stringify(msg)}\n`);
          return;
        }
      }
    }
    child.stdin.write(`${line}\n`);
  };
  // Lines keep their order while a session request waits for the shim.
  let queue = Promise.resolve();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    queue = queue.then(() => forward(line));
  });
  rl.on("close", () => {
    queue = queue.then(() => child.stdin.end());
  });

  child.on("exit", (code, signal) => {
    removeState();
    for (const forwarded of forwardedSignals) process.removeAllListeners(forwarded);
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}
