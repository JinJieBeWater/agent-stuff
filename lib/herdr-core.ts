import { parseArgs, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setTimeout as delay } from "node:timers/promises";

const nonSessionCommands = new Set([
  "auth",
  "config",
  "install",
  "list",
  "mcp",
  "remove",
  "uninstall",
  "update",
]);

async function sharesForegroundGroup(
  pi: Pick<ExtensionAPI, "exec">,
  foreground: number,
): Promise<boolean> {
  if (process.platform === "win32" || !Number.isSafeInteger(foreground) || foreground <= 0) {
    return false;
  }

  try {
    const leader = String(foreground);
    const self = String(process.pid);
    const result = await pi.exec(
      "ps",
      ["-o", "pid=", "-o", "tty=", "-o", "pgid=", "-o", "tpgid=", "-p", `${self},${leader}`],
      { timeout: 500 },
    );
    if (result.code !== 0 || result.killed || result.truncated) return false;
    const rows = result.stdout
      .trim()
      .split("\n")
      .map((row) => row.trim().split(/\s+/));
    const piProcess = rows.find(([pid]) => pid === self);
    const groupLeader = rows.find(([pid]) => pid === leader);
    if (!piProcess || !groupLeader) return false;
    const [, tty, group, ttyGroup] = piProcess;
    const [, leaderTty, leaderGroup] = groupLeader;
    return Boolean(
      tty &&
      !/^[?-]+$/.test(tty) &&
      tty === leaderTty &&
      group === leader &&
      ttyGroup === leader &&
      leaderGroup === leader,
    );
  } catch {
    return false;
  }
}

/** Check before an extension registers Core controls or touches shared terminal state. */
export async function isHerdrCoreTui(pi: Pick<ExtensionAPI, "exec">): Promise<boolean> {
  const { HC_TERMINAL_ID: terminal, HC_TERMINAL_SOCKET: socket } = process.env;
  if (!process.stdin.isTTY || !process.stdout.isTTY || !terminal || !socket?.trim()) return false;
  if (!/^t[0-9a-z]+$/.test(terminal)) return false;

  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (
    args.mode === "rpc" ||
    args.mode === "json" ||
    args.print ||
    args.help ||
    args.version ||
    args.export !== undefined ||
    args.listModels !== undefined ||
    args.diagnostics.some((diagnostic) => diagnostic.type === "error") ||
    nonSessionCommands.has(argv[0] ?? "")
  )
    return false;

  // The markers are inherited by nested PTYs, including T3's integrated terminal.
  // Require the live Core terminal to own our process or its foreground group.
  const deadline = Date.now() + 1000;
  let checkedForeground: number | undefined;
  try {
    do {
      const result = await pi.exec("hc", ["get", terminal, "--json"], { timeout: 1000 });
      if (result.code !== 0 || result.killed || result.truncated) return false;
      const target = JSON.parse(result.stdout);
      if (target?.error || target?.address !== terminal || target.state !== "live") return false;
      const foreground = target.foreground?.pid;
      if (foreground === process.pid || (foreground == null && target.pid === process.pid)) {
        return true;
      }
      // Non-job-control shells can run Pi in the same group while retaining the lead PID.
      if (typeof foreground === "number" && foreground !== checkedForeground) {
        if (await sharesForegroundGroup(pi, foreground)) return true;
        checkedForeground = foreground;
      }
      // Core can still show no foreground sample or the shell that just started Pi.
      if (foreground != null && foreground !== target.pid) return false;
      await delay(50);
    } while (Date.now() < deadline);
  } catch {
    // Core may be absent, restarting, or unreachable from this process.
  }
  return false;
}
