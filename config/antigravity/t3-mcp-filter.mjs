import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const filterConfig = JSON.parse(readFileSync(join(here, "t3-mcp-filter.json"), "utf8"));
const disabledPrefixes = Array.isArray(filterConfig.disabledPrefixes)
  ? filterConfig.disabledPrefixes
  : [];
const disabledTools = new Set(
  Array.isArray(filterConfig.disabledTools) ? filterConfig.disabledTools : [],
);
const directTools = new Set(
  Array.isArray(filterConfig.directTools) ? filterConfig.directTools : [],
);

const SEARCH_TOOL_NAME = "t3_tool_search";
const CALL_TOOL_NAME = "t3_call_tool";
const CATALOG_SYNC_ID = "__t3_filter_catalog_sync__";

function isAllowedTool(name) {
  if (typeof name !== "string") return true;
  if (disabledTools.has(name)) return false;
  return !disabledPrefixes.some((prefix) => name.startsWith(prefix));
}

function buildSearchTool(deferredMap) {
  return {
    name: SEARCH_TOOL_NAME,
    description: `Search ${deferredMap.size} deferred t3-code tools (worktree, project, pull request, thread transfer/queue/config, browser act/navigate/resize/eval, linked environments) by keyword, or pass empty query "" to list all names. Invoke matches via ${CALL_TOOL_NAME}.`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'Search keywords (e.g. "worktree", "pull_request", "project", "preview") or "" to list all deferred tool names',
        },
        limit: {
          type: "number",
          description: "Maximum full schemas to return (default 8, max 20)",
        },
      },
      required: ["query"],
    },
  };
}

function buildCallTool() {
  return {
    name: CALL_TOOL_NAME,
    description: `Call a deferred t3-code tool discovered via ${SEARCH_TOOL_NAME}.`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Exact deferred tool name",
        },
        arguments: {
          type: "object",
          description: "Arguments object matching the tool inputSchema",
        },
      },
      required: ["name"],
    },
  };
}

const origCommand = process.env.T3_ORIG_MCP_COMMAND;
const origArgs = JSON.parse(process.env.T3_ORIG_MCP_ARGS_JSON ?? "[]");
if (!origCommand) {
  process.stderr.write("t3-mcp-filter requires T3_ORIG_MCP_COMMAND\n");
  process.exit(2);
}

const childEnv = { ...process.env };
delete childEnv.T3_ORIG_MCP_COMMAND;
delete childEnv.T3_ORIG_MCP_ARGS_JSON;

const upstream = spawn(origCommand, origArgs, {
  env: childEnv,
  stdio: ["pipe", "pipe", "inherit"],
});

const toolsListIds = new Set();
const deferredTools = new Map();
let catalogLoaded = false;
let pendingCatalogResolve = null;

function partitionTools(rawTools) {
  const allowed = rawTools.filter((tool) => isAllowedTool(tool?.name));
  if (directTools.size === 0) return allowed;

  deferredTools.clear();
  const direct = [];
  for (const tool of allowed) {
    if (tool?.name === SEARCH_TOOL_NAME || tool?.name === CALL_TOOL_NAME) continue;
    if (directTools.has(tool?.name)) {
      direct.push(tool);
    } else if (typeof tool?.name === "string") {
      deferredTools.set(tool.name, tool);
    }
  }
  catalogLoaded = true;
  if (deferredTools.size > 0) {
    direct.push(buildSearchTool(deferredTools), buildCallTool());
  }
  return direct;
}

function searchDeferredTools(queryRaw, limitRaw) {
  const query = typeof queryRaw === "string" ? queryRaw.trim() : "";
  const parsedLimit = Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 8;
  const limit = Math.max(1, Math.min(20, parsedLimit));

  if (query === "" || query === "*") {
    return {
      deferredCount: deferredTools.size,
      tools: [...deferredTools.values()].map((tool) => ({
        name: tool.name,
        description:
          typeof tool.description === "string" ? tool.description.split("\n")[0] : undefined,
      })),
    };
  }

  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/u)
    .filter(Boolean);
  const queryLower = query.toLowerCase();
  const scored = [];

  for (const tool of deferredTools.values()) {
    const nameLower = tool.name.toLowerCase();
    const descLower = typeof tool.description === "string" ? tool.description.toLowerCase() : "";
    let score = nameLower === queryLower ? 100 : 0;
    for (const term of terms) {
      if (nameLower.includes(term)) score += 10;
      else if (descLower.includes(term)) score += 2;
    }
    if (score > 0) scored.push({ tool, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    deferredCount: deferredTools.size,
    tools: scored.slice(0, limit).map((entry) => entry.tool),
  };
}

function writeClientJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function ensureCatalogLoaded() {
  if (catalogLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    pendingCatalogResolve = resolve;
    upstream.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: CATALOG_SYNC_ID, method: "tools/list", params: {} })}\n`,
    );
  });
}

const stdoutRl = createInterface({ input: upstream.stdout, crlfDelay: Infinity });
stdoutRl.on("line", (line) => {
  if (line.trim()) {
    try {
      const msg = JSON.parse(line);
      if (msg && msg.id === CATALOG_SYNC_ID) {
        if (msg.result && Array.isArray(msg.result.tools)) {
          partitionTools(msg.result.tools);
        }
        const resolve = pendingCatalogResolve;
        pendingCatalogResolve = null;
        if (resolve) resolve();
        return;
      }
      if (msg && "id" in msg && toolsListIds.has(msg.id)) {
        toolsListIds.delete(msg.id);
        if (msg.result && Array.isArray(msg.result.tools)) {
          msg.result = {
            ...msg.result,
            tools: partitionTools(msg.result.tools),
          };
          writeClientJson(msg);
          return;
        }
      }
    } catch {
      // Forward unparsed lines unchanged.
    }
  }
  process.stdout.write(`${line}\n`);
});
stdoutRl.on("close", () => {
  const resolve = pendingCatalogResolve;
  pendingCatalogResolve = null;
  if (resolve) resolve();
});

const stdinRl = createInterface({ input: process.stdin, crlfDelay: Infinity });
(async () => {
  for await (const line of stdinRl) {
    if (line.trim()) {
      try {
        const msg = JSON.parse(line);
        if (
          msg &&
          (msg.method === "tools/list" || msg.method === "server/discover") &&
          "id" in msg
        ) {
          toolsListIds.add(msg.id);
          upstream.stdin.write(`${line}\n`);
          continue;
        }
        if (msg && msg.method === "tools/call" && "id" in msg) {
          const toolName = msg.params?.name;
          if (toolName === SEARCH_TOOL_NAME) {
            await ensureCatalogLoaded();
            const args = msg.params?.arguments ?? {};
            const payload = searchDeferredTools(args.query, args.limit);
            writeClientJson({
              jsonrpc: "2.0",
              id: msg.id,
              result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
            });
            continue;
          }
          if (toolName === CALL_TOOL_NAME) {
            const args = msg.params?.arguments ?? {};
            const targetName = args.name;
            const targetArgs = args.arguments;
            if (
              typeof targetName !== "string" ||
              targetName.length === 0 ||
              targetName === SEARCH_TOOL_NAME ||
              targetName === CALL_TOOL_NAME ||
              !isAllowedTool(targetName)
            ) {
              writeClientJson({
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text: `Tool is disabled or invalid: ${String(targetName)}`,
                    },
                  ],
                },
              });
              continue;
            }
            if (
              targetArgs !== undefined &&
              (targetArgs === null || typeof targetArgs !== "object" || Array.isArray(targetArgs))
            ) {
              writeClientJson({
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  isError: true,
                  content: [{ type: "text", text: "Invalid arguments: expected object" }],
                },
              });
              continue;
            }
            upstream.stdin.write(
              `${JSON.stringify({
                ...msg,
                params: {
                  ...msg.params,
                  name: targetName,
                  arguments: targetArgs ?? {},
                },
              })}\n`,
            );
            continue;
          }
        }
      } catch {
        // Forward unparsed lines unchanged.
      }
    }
    upstream.stdin.write(`${line}\n`);
  }
  upstream.stdin.end();
})();

upstream.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
