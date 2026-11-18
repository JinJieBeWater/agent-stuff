import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
const wrapper = fileURLToPath(new URL("acp-wrapper.mjs", import.meta.url));
function rig(t, { missing = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ryugi-acp-test-"));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  function script(name, text) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, "#!" + process.execPath + "\n" + text, { mode: 0o755 });
    return f;
  }
  const child = script(
    "agent",
    `
    const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});
    const send=x=>process.stdout.write(JSON.stringify(x)+'\\r\\n');
    rl.on('line',line=>{
      const m=JSON.parse(line);fs.appendFileSync(process.env.TRACE,line+'\\n');
      if(m.method==='session/prompt') {
        for(const update of [
          {sessionUpdate:'tool_call',toolCallId:'1',title:'Start Ryugi slides',rawInput:{CommandLine:'ryugi start --artifact slides/foo',WorkingDirectory:process.cwd()},status:'in_progress'},
          {sessionUpdate:'tool_call_update',toolCallId:'1',status:'completed'},
          {sessionUpdate:'tool_call_update',toolCallId:'1',status:'completed'},
          {sessionUpdate:'tool_call',toolCallId:'2',title:'Start failed slides',rawInput:{CommandLine:'ryugi start --artifact slides/failed'},status:'failed'},
        ]) send({method:'session/update',params:{sessionId:m.params.sessionId,update}});
        send({id:m.id,result:{stopReason:'end_turn'}});
      } else send({id:m.id,result:{sessionId:m.params.sessionId||'new-id'}});
    });
    rl.once('close',()=>process.stdout.write('partial-终'));
  `,
  );
  const bin = script(
    "bridge",
    `
    const fs=require('node:fs');fs.appendFileSync(process.env.OPS,JSON.stringify(process.argv.slice(2))+'\\n');
    if(process.argv[2]==='selection-context')console.log('viewer context');
  `,
  );
  const mcp = script(
    "mcp.cjs",
    `
    const fs=require('node:fs');
    if(process.env.T3_ACP_MCP_AUTHORIZATION!=='Bearer mock'||process.env.ELECTRON_RUN_AS_NODE!=='1'||
      JSON.stringify(process.argv.slice(2))!==JSON.stringify(['acp-mcp-call','orchestrator_capabilities','{}']))process.exit(1);
    console.log(JSON.stringify({structuredContent:{parentThreadId:process.env.T3_ACP_MCP_ENDPOINT.split('/').pop()}}));
  `,
  );
  const trace = path.join(dir, "trace"),
    ops = path.join(dir, "ops");
  const wrapperProcess = spawn(process.execPath, [wrapper, "acp"], {
    cwd: dir,
    env: {
      ...process.env,
      AGY_UPSTREAM_BIN: child,
      RYUGI_T3_WATCH_BIN: missing ? path.join(dir, "absent") : bin,
      TRACE: trace,
      OPS: ops,
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const rl = createInterface({ input: wrapperProcess.stdout });
  t.after(() => {
    rl.close();
    wrapperProcess.stdin.destroy();
    wrapperProcess.kill();
  });
  let bytes = "";
  wrapperProcess.stdout.setEncoding("utf8").on("data", (chunk) => (bytes += chunk));
  const rows = (file) =>
    fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse) : [];
  let id = 0;
  async function request(method, params) {
    const requestId = ++id;
    const reply = new Promise((resolve) => {
      function read(line) {
        const m = JSON.parse(line);
        if (m.id === requestId) {
          rl.off("line", read);
          resolve(m);
        }
      }
      rl.on("line", read);
    });
    wrapperProcess.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n",
    );
    return reply;
  }
  const server = (id) => ({
    name: "t3-code",
    type: "stdio",
    command: process.execPath,
    args: [mcp, "acp-mcp-bridge"],
    env: [
      { name: "T3_ACP_MCP_ENDPOINT", value: "http://localhost/" + id },
      { name: "T3_ACP_MCP_AUTHORIZATION", value: "Bearer mock" },
    ],
  });
  async function finish() {
    const closed = once(wrapperProcess, "close");
    wrapperProcess.stdin.end();
    assert.equal((await closed)[0], 0);
    return bytes;
  }
  return { dir, request, server, trace: () => rows(trace), ops: () => rows(ops), finish };
}
test(
  "ACP wraps original MCP and binds new, load and resume prompts and tool updates to their own thread",
  { timeout: 15000 },
  async (t) => {
    const f = rig(t);
    for (const op of ["new", "load", "resume"]) {
      const server = f.server(op),
        sessionId = op === "new" ? undefined : op + "-id";
      const open = await f.request("session/" + op, {
        cwd: f.dir,
        sessionId,
        mcpServers: [server],
      });
      const session = open.result.sessionId;
      await f.request("session/prompt", {
        sessionId: session,
        prompt: [{ type: "text", text: "user " + op }],
      });
      const [init, prompt] = f.trace().slice(-2);
      assert.match(init.params.mcpServers[0].args[0], /t3-mcp-filter.mjs$/);
      assert.deepEqual(
        JSON.parse(
          init.params.mcpServers[0].env.find((e) => e.name === "T3_ORIG_MCP_ARGS_JSON").value,
        ),
        server.args,
      );
      assert.deepEqual(prompt.params.prompt, [
        { type: "text", text: "viewer context" },
        { type: "text", text: "user " + op },
      ]);
    }
    const bytes = await f.finish();
    assert.ok(bytes.endsWith("\r\npartial-终"));
    for (let i = 0; i < 30 && f.ops().length < 12; i++) await delay(50);
    for (const op of ["new", "load", "resume"]) {
      const ops = f.ops().filter((args) => args.includes(op));
      assert.deepEqual(ops.map((args) => args[0]).sort(), [
        "observe-command",
        "selection-context",
        "session-start",
        "turn-end",
      ]);
      assert.ok(
        ops
          .find((args) => args[0] === "observe-command")
          .some((s) => s.includes("ryugi start --artifact slides/foo")),
      );
    }
  },
);
test("missing bridge passes the original prompt and trailing partial output", async (t) => {
  const f = rig(t, { missing: true });
  await f.request("session/new", { cwd: f.dir, mcpServers: [f.server("unused")] });
  const prompt = [{ type: "text", text: "hello" }];
  await f.request("session/prompt", { sessionId: "new-id", prompt });
  assert.deepEqual(f.trace()[1].params.prompt, prompt);
  assert.ok((await f.finish()).endsWith("partial-终"));
});
test("resuming without a T3 MCP server discards the previous binding", async (t) => {
  const f = rig(t);
  await f.request("session/new", { cwd: f.dir, mcpServers: [f.server("old")] });
  await f.request("session/resume", { cwd: f.dir, sessionId: "new-id", mcpServers: [] });
  const prompt = [{ type: "text", text: "independent turn" }];
  await f.request("session/prompt", { sessionId: "new-id", prompt });
  assert.deepEqual(f.trace().at(-1).params.prompt, prompt);
  await f.finish();
});
