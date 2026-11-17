import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export interface MoveRuntime {
  current(signal?: AbortSignal): Promise<string>;
  verify(terminal: string, pid: number, signal?: AbortSignal): Promise<void>;
  launch(
    agentDir: string,
    args: string[],
    bind: (terminal: string) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void>;
}

export function createRuntime(
  exec: ExtensionAPI["exec"],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): MoveRuntime | undefined {
  const caller = env.HC_TERMINAL_ID;
  if (!env.HC_TERMINAL_SOCKET || !caller || !/^t[0-9a-z]+$/.test(caller)) return;

  const run = async (args: string[], signal?: AbortSignal): Promise<any> => {
    const result = await exec("hc", args, {
      cwd,
      signal,
      timeout: 10_000,
    });
    signal?.throwIfAborted();
    if (result.killed)
      throw new Error("Terminal command timed out; inspect live state before retrying");
    const raw = result.stdout.trim() || result.stderr.trim();
    let response;
    try {
      response = JSON.parse(raw);
    } catch {
      throw new Error("Terminal command returned invalid JSON: " + raw.slice(0, 500));
    }
    if (result.code !== 0 || response?.error)
      throw new Error(response?.error?.message || raw.slice(0, 500));
    if (!response || typeof response !== "object" || Array.isArray(response))
      throw new Error("Terminal command returned no result");
    return response;
  };

  const get = async (terminal: string, signal?: AbortSignal) => {
    const value = await run(["get", terminal, "--json"], signal);
    if (value.address !== terminal || value.state !== "live")
      throw new Error("Core terminal identity changed; inspect it before retrying");
    return value;
  };
  return {
    async current(signal) {
      await get(caller, signal);
      return caller;
    },
    async verify(terminal, pid, signal) {
      const deadline = Date.now() + 5_000;
      while (true) {
        const foreground = (await get(terminal, signal)).foreground?.pid;
        if (foreground === pid) return;
        // Pi can handle its initial command before Core has sampled its foreground process.
        if (foreground !== undefined || Date.now() >= deadline)
          throw new Error(
            `Core terminal ${terminal}: expected Pi PID ${pid}, foreground PID ${foreground ?? "unknown"}`,
          );
        await delay(50, undefined, { signal });
      }
    },
    async launch(agentDir, args, bind, signal) {
      const token = randomUUID().replaceAll("-", "");
      const result = await run(
        [
          "run",
          "--json",
          "--bg",
          "--cwd",
          cwd,
          "--no-parent",
          "--no-notify",
          "--label",
          `herdr.space=sp${token}`,
          "--label",
          `herdr.tab=tb${token}`,
          "--",
          // shortcut: env is native on macOS/Linux; use Core API env for Windows support.
          "/usr/bin/env",
          `PI_CODING_AGENT_DIR=${agentDir}`,
          process.execPath,
          process.argv[1]!,
          ...args,
        ],
        signal,
      );
      if (typeof result.address !== "string" || !/^t[0-9a-z]+$/.test(result.address))
        throw new Error("Core returned no local terminal address; inspect its terminals");
      // Core starts Pi before returning its address; the receiver waits for this binding.
      await bind(result.address);
    },
  };
}
