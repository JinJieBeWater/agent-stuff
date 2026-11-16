import { expect, test } from "vite-plus/test";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
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

test("acp mode appends --disable-telemetry, filters unused t3-code MCP tools, and forwards tools/call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agy-wrapper-acp-"));
  try {
    const fakeT3Bridge = join(dir, "fake-t3-bridge.mjs");
    await writeFile(
      fakeT3Bridge,
      `import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line);
  if (!("id" in msg)) continue;
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "t3-code", version: "1.0" } }
    }) + "\\n");
  } else if (msg.method === "tools/list") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          { name: "delegate_task", description: "delegate", inputSchema: { type: "object" } },
          { name: "html_render", description: "render", inputSchema: { type: "object" } },
          { name: "t3_project_list", description: "list projects", inputSchema: { type: "object" } },
          { name: "t3_environment_read", description: "read env", inputSchema: { type: "object" } },
          { name: "read_pull_request_guide", description: "pr guide", inputSchema: { type: "object" } },
          { name: "preview_resize", description: "resize tab viewport", inputSchema: { type: "object", properties: { width: { type: "number" } } } },
          { name: "t3_thread_transfer", description: "transfer thread context", inputSchema: { type: "object" } },
          { name: "t3_project_delete", description: "delete proj", inputSchema: { type: "object" } },
          { name: "t3_environment_preferences_update", description: "env prefs", inputSchema: { type: "object" } },
          { name: "t3_attachment_prepare_upload", description: "upload", inputSchema: { type: "object" } },
          { name: "preview_recording_start", description: "rec", inputSchema: { type: "object" } },
          { name: "device_open", description: "ios sim", inputSchema: { type: "object" } },
          { name: "t3_theme_set", description: "theme", inputSchema: { type: "object" } },
          { name: "t3_workflow_stop", description: "claude only", inputSchema: { type: "object" } }
        ]
      }
    }) + "\\n");
  } else if (msg.method === "tools/call") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{
          type: "text",
          text: "auth=" + process.env.T3_ACP_MCP_AUTHORIZATION + ";name=" + msg.params.name + ";args=" + JSON.stringify(msg.params.arguments)
        }]
      }
    }) + "\\n");
  }
}
`,
      "utf8",
    );

    const fakeAgy = join(dir, "fake-agy");
    await writeFile(
      fakeAgy,
      `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { argv: process.argv.slice(2) } }) + "\\n");
  } else if (msg.method === "session/new" || msg.method === "session/resume") {
    const [t3Server, customServer] = msg.params.mcpServers;
    const envMap = Object.fromEntries((t3Server.env ?? []).map((e) => [e.name, e.value]));
    const mcp = spawn(t3Server.command, t3Server.args, {
      env: { ...process.env, ...envMap },
      stdio: ["pipe", "pipe", "inherit"]
    });
    const mcpRl = createInterface({ input: mcp.stdout, crlfDelay: Infinity });
    const nextMsg = () => new Promise((resolveLine) => mcpRl.once("line", (l) => resolveLine(JSON.parse(l))));

    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\\n");
    await nextMsg();
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\\n");
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\\n");
    const listed = await nextMsg();
    mcp.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "delegate_task", arguments: { task: "ping" } }
    }) + "\\n");
    const called = await nextMsg();

    mcp.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "t3_tool_search", arguments: { query: "resize" } }
    }) + "\\n");
    const searched = await nextMsg();

    mcp.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "t3_tool_search", arguments: { query: "" } }
    }) + "\\n");
    const listedAllDeferred = await nextMsg();

    mcp.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "t3_call_tool", arguments: { name: "preview_resize", arguments: { width: 390 } } }
    }) + "\\n");
    const deferredCalled = await nextMsg();

    mcp.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "t3_call_tool", arguments: { name: "t3_project_delete", arguments: { projectId: "p1" } } }
    }) + "\\n");
    const blockedCalled = await nextMsg();
    mcp.stdin.end();

    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: listed.result.tools.map((t) => t.name),
        callText: called.result.content[0].text,
        searchResult: JSON.parse(searched.result.content[0].text),
        allDeferredNames: JSON.parse(listedAllDeferred.result.content[0].text).tools.map((t) => t.name),
        deferredCallText: deferredCalled.result.content[0].text,
        blockedIsError: blockedCalled.result.isError === true,
        customCommand: customServer.command
      }
    }) + "\\n");
  }
}
`,
      "utf8",
    );
    await chmod(fakeAgy, 0o755);

    const child = spawn(
      wrapperPath,
      ["acp", "--gemini-dir", dir, "--app-data-dir", "antigravity-acp"],
      {
        env: { ...process.env, AGY_UPSTREAM_BIN: fakeAgy },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const readJson = () =>
      new Promise<any>((resolveLine, rejectLine) => {
        const onError = (err: Error) => rejectLine(err);
        child.once("error", onError);
        rl.once("line", (l) => {
          child.off("error", onError);
          resolveLine(JSON.parse(l));
        });
      });

    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 10, method: "initialize", params: {} }) + "\n",
    );
    const initRes = await readJson();
    expect(initRes.result.argv).toEqual([
      "acp",
      "--gemini-dir",
      dir,
      "--app-data-dir",
      "antigravity-acp",
      "--disable-telemetry",
    ]);

    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 11,
        method: "session/new",
        params: {
          cwd: dir,
          mcpServers: [
            {
              name: "t3-code",
              command: process.execPath,
              args: [fakeT3Bridge],
              env: [{ name: "T3_ACP_MCP_AUTHORIZATION", value: "Bearer secret-123" }],
            },
            {
              name: "custom-db",
              command: "/usr/bin/sqlite3",
              args: ["test.db"],
              env: [],
            },
          ],
        },
      }) + "\n",
    );
    const sessionRes = await readJson();
    expect(sessionRes.result).toEqual({
      tools: ["delegate_task", "html_render", "t3_tool_search", "t3_call_tool"],
      callText: 'auth=Bearer secret-123;name=delegate_task;args={"task":"ping"}',
      searchResult: {
        deferredCount: 5,
        tools: [
          {
            name: "preview_resize",
            description: "resize tab viewport",
            inputSchema: { type: "object", properties: { width: { type: "number" } } },
          },
        ],
      },
      allDeferredNames: [
        "t3_project_list",
        "t3_environment_read",
        "read_pull_request_guide",
        "preview_resize",
        "t3_thread_transfer",
      ],
      deferredCallText: 'auth=Bearer secret-123;name=preview_resize;args={"width":390}',
      blockedIsError: true,
      customCommand: "/usr/bin/sqlite3",
    });

    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 12,
        method: "session/resume",
        params: {
          sessionId: "s-1",
          cwd: dir,
          mcpServers: [
            {
              name: "t3-code",
              command: process.execPath,
              args: [fakeT3Bridge],
              env: [{ name: "T3_ACP_MCP_AUTHORIZATION", value: "Bearer resume-456" }],
            },
            {
              name: "custom-db",
              command: "/usr/bin/sqlite3",
              args: ["test.db"],
              env: [],
            },
          ],
        },
      }) + "\n",
    );
    const resumeRes = await readJson();
    expect(resumeRes.result.tools).toEqual([
      "delegate_task",
      "html_render",
      "t3_tool_search",
      "t3_call_tool",
    ]);
    expect(resumeRes.result.callText).toBe(
      'auth=Bearer resume-456;name=delegate_task;args={"task":"ping"}',
    );
    expect(resumeRes.result.deferredCallText).toBe(
      'auth=Bearer resume-456;name=preview_resize;args={"width":390}',
    );
    expect(resumeRes.result.blockedIsError).toBe(true);
    expect(resumeRes.result.customCommand).toBe("/usr/bin/sqlite3");

    child.stdin.end();
    await new Promise((resolveClose) => child.once("close", resolveClose));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("filters tools returned directly from MCP 2026 server/discover responses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agy-wrapper-discover-"));
  try {
    const fakeDiscoverBridge = join(dir, "fake-discover-bridge.mjs");
    await writeFile(
      fakeDiscoverBridge,
      `import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line);
  if (msg.method === "server/discover") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2026-07-28",
        capabilities: { tools: {} },
        serverInfo: { name: "t3-code", version: "1.0" },
        tools: [
          { name: "preview_open", description: "open", inputSchema: { type: "object" } },
          { name: "t3_worktree_status", description: "worktree", inputSchema: { type: "object" } },
          { name: "device_list", description: "simulators", inputSchema: { type: "object" } },
          { name: "schedule_task", description: "cron", inputSchema: { type: "object" } }
        ]
      }
    }) + "\\n");
  }
}
`,
      "utf8",
    );

    const fakeAgy = join(dir, "fake-agy");
    await writeFile(
      fakeAgy,
      `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line);
  if (msg.method === "session/new") {
    const [t3Server] = msg.params.mcpServers;
    const envMap = Object.fromEntries((t3Server.env ?? []).map((e) => [e.name, e.value]));
    const mcp = spawn(t3Server.command, t3Server.args, {
      env: { ...process.env, ...envMap },
      stdio: ["pipe", "pipe", "inherit"]
    });
    const mcpRl = createInterface({ input: mcp.stdout, crlfDelay: Infinity });
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} }) + "\\n");
    const discovered = await new Promise((resolveLine) => mcpRl.once("line", (l) => resolveLine(JSON.parse(l))));
    mcp.stdin.end();
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: { tools: discovered.result.tools.map((t) => t.name) }
    }) + "\\n");
  }
}
`,
      "utf8",
    );
    await chmod(fakeAgy, 0o755);

    const child = spawn(wrapperPath, ["acp"], {
      env: { ...process.env, AGY_UPSTREAM_BIN: fakeAgy },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 21,
        method: "session/new",
        params: {
          cwd: dir,
          mcpServers: [
            {
              name: "t3-code",
              command: process.execPath,
              args: [fakeDiscoverBridge],
              env: [],
            },
          ],
        },
      }) + "\n",
    );
    const res = await new Promise<any>((resolveLine) =>
      rl.once("line", (l) => resolveLine(JSON.parse(l))),
    );
    expect(res.result.tools).toEqual(["preview_open", "t3_tool_search", "t3_call_tool"]);
    child.stdin.end();
    await new Promise((resolveClose) => child.once("close", resolveClose));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("t3_tool_search syncs catalog lazily if tools/list was skipped and t3_call_tool defaults missing arguments", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agy-wrapper-lazy-"));
  try {
    const fakeLazyBridge = join(dir, "fake-lazy-bridge.mjs");
    await writeFile(
      fakeLazyBridge,
      `import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line);
  if (!("id" in msg)) continue;
  if (msg.method === "tools/list") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          { name: "delegate_task", description: "delegate", inputSchema: { type: "object" } },
          { name: "t3_worktree_status", description: "report worktree status", inputSchema: { type: "object" } }
        ]
      }
    }) + "\\n");
  } else if (msg.method === "tools/call") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: msg.params.name + ":" + JSON.stringify(msg.params.arguments) }]
      }
    }) + "\\n");
  }
}
`,
      "utf8",
    );

    const fakeAgy = join(dir, "fake-agy");
    await writeFile(
      fakeAgy,
      `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line);
  if (msg.method === "session/resume") {
    const [t3Server] = msg.params.mcpServers;
    const envMap = Object.fromEntries((t3Server.env ?? []).map((e) => [e.name, e.value]));
    const mcp = spawn(t3Server.command, t3Server.args, {
      env: { ...process.env, ...envMap },
      stdio: ["pipe", "pipe", "inherit"]
    });
    const mcpRl = createInterface({ input: mcp.stdout, crlfDelay: Infinity });
    const nextMsg = () => new Promise((resolveLine) => mcpRl.once("line", (l) => resolveLine(JSON.parse(l))));

    mcp.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "t3_tool_search", arguments: { query: "worktree" } }
    }) + "\\n");
    const searched = await nextMsg();

    mcp.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "t3_call_tool", arguments: { name: "t3_worktree_status" } }
    }) + "\\n");
    const called = await nextMsg();
    mcp.stdin.end();

    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        searchTools: JSON.parse(searched.result.content[0].text).tools.map((t) => t.name),
        callText: called.result.content[0].text
      }
    }) + "\\n");
  }
}
`,
      "utf8",
    );
    await chmod(fakeAgy, 0o755);

    const child = spawn(wrapperPath, ["acp"], {
      env: { ...process.env, AGY_UPSTREAM_BIN: fakeAgy },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 31,
        method: "session/resume",
        params: {
          sessionId: "s-lazy",
          cwd: dir,
          mcpServers: [
            {
              name: "t3-code",
              command: process.execPath,
              args: [fakeLazyBridge],
              env: [],
            },
          ],
        },
      }) + "\n",
    );
    const res = await new Promise<any>((resolveLine) =>
      rl.once("line", (l) => resolveLine(JSON.parse(l))),
    );
    expect(res.result).toEqual({
      searchTools: ["t3_worktree_status"],
      callText: "t3_worktree_status:{}",
    });
    child.stdin.end();
    await new Promise((resolveClose) => child.once("close", resolveClose));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
