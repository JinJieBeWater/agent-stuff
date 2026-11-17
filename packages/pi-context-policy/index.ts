import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isHerdrCoreTui } from "../../lib/herdr-core.ts";
import { fileName, matchesEnv, parsePolicy, type Policy } from "./policy.ts";
import { registerResources } from "./resources.ts";

export { parsePolicy, type Policy } from "./policy.ts";
const defaultSections: NonNullable<Policy["sections"]> = [
  {
    id: "herdr-core",
    text: "当前运行在 Herdr Core 管理的终端中。同级 agent 协作用 hc，使用前先读 hc --skill；需要查询布局或操作窗口时先确认 herdr-app 可用并读 herdr-app --skill。",
    whenHost: "herdr-core-tui",
    whenEnv: {},
  },
];

export function registerPolicy(
  pi: ExtensionAPI,
  config: Policy,
  env: NodeJS.ProcessEnv = process.env,
  checkCore = () => isHerdrCoreTui(pi),
) {
  if (!config.enabled || config.sections?.length === 0) return;
  pi.on("before_agent_start", async (event, ctx) => {
    let coreTui: boolean | undefined;
    for (const block of config.sections ?? defaultSections) {
      if (!matchesEnv(block.whenEnv, env)) continue;
      if (block.whenHost && ctx.mode !== "tui") continue;
      if (block.whenHost === "herdr-core-tui") {
        coreTui ??= await checkCore();
        if (!coreTui) continue;
      }

      const key = `context-policy-${block.id}`;
      const options = event.systemPromptOptions;
      // A legacy systemPrompt return freezes the request text, so later sections must join it.
      if (options.forceSystemPrompt !== undefined) {
        const tagged = `<${key}>\n${block.text}\n</${key}>`;
        if (!options.forceSystemPrompt.includes(tagged))
          options.forceSystemPrompt += `\n\n${tagged}`;
      } else options.sections[key] = block.text;
    }
  });
}

export default async function contextPolicy(pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  let value: unknown = {};
  try {
    value = JSON.parse((await readFile(join(agentDir, fileName), "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const config = parsePolicy(value);
  let coreTui: Promise<boolean> | undefined;
  const checkCore = () => (coreTui ??= isHerdrCoreTui(pi));
  await registerResources(pi, config, agentDir, process.env, checkCore);
  registerPolicy(pi, config, process.env, checkCore);
}
