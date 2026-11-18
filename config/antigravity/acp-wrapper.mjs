import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
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

  child.stdout.pipe(process.stdout);

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (line.trim()) {
      try {
        const msg = JSON.parse(line);
        if (
          msg &&
          (msg.method === "session/new" ||
            msg.method === "session/load" ||
            msg.method === "session/resume") &&
          msg.params &&
          Array.isArray(msg.params.mcpServers)
        ) {
          msg.params = {
            ...msg.params,
            mcpServers: wrapMcpServers(msg.params.mcpServers),
          };
          child.stdin.write(`${JSON.stringify(msg)}\n`);
          return;
        }
      } catch {
        // Forward unparsed lines unchanged.
      }
    }
    child.stdin.write(`${line}\n`);
  });
  rl.on("close", () => {
    child.stdin.end();
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}
