# pi-skill-discovery

只在系统提示词中展示 `coreSkills`（默认空），其余可自动调用的 Skills 通过 `skill_search` 按需查找；原生 `/skill:name` 不受影响。配置位于 `~/.pi/agent/pi-skill-discovery.json`（遵循 `PI_CODING_AGENT_DIR`）。

## 与 Codex conversion 的加载顺序

与 `@howaboua/pi-codex-conversion` 共用时，本扩展必须在 `settings.json` 的 `packages` 中排在它之前：

```json
{
  "packages": ["git:github.com/JinJieBeWater/agent-stuff", "npm:@howaboua/pi-codex-conversion"]
}
```

Codex conversion 会在 `before_agent_start` 中直接把收到的技能列表渲染成字符串；若它先执行，后续过滤 `options.skills` 不会缩减最终系统提示里的目录。
