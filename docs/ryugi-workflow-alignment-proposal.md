# Ryugi 主流程：退出旧入口与规则收敛提案

日期：2026-11-16。本文是调查和变更记录，不是生效的 agent 指令。

## 用户反馈原文与授权边界

针对 `grilling`、`implement`、`implement-spec`：

> 这些退出吧，注意在我T3code配置的所有agent都需要一起退出，我t3code里面的所有配置行为需要一致

针对 `tdd`、`diagnosing-bugs`：

> 这两个感觉还有用吧？或者你评估一下这两个和那两个的区别

针对 AGENTS.md 收敛：

> 有哪些呢，具体给我看diff

对提案的后续反馈：

> 其实能否尽量少写，写多错的多

针对让 Pi 继承共享文件的建议：

> 我就是要隔离维护

授权实施旧入口退出；另外两个 skill 保持安装与调用策略不变。AGENTS.md 仅提供未应用的 diff，不修改个人政策、第三方 skill 或 T3 源码。

## 已完成

运行官方管理命令：

```sh
bunx skills remove grilling grill-me grill-with-docs implement implement-spec --global --yes
```

官方工具报告移除 5 项。`grill-me`、`grill-with-docs` 是读取 `grilling` 的包装入口，一并退出以免留下失效命令。工具移除实体和锁记录后，Codex 仍有 4 个历史相对软链；逐项确认它们只指向已移除实体且已经失效后，清理这 4 个软链。

检查以下所有现存全局入口：`.agents/skills`、`.codex/skills`、`.claude/skills`、`.pi/agent/skills`、`.cursor/skills`、`.grok/skills`、`.gemini/skills`、`.gemini/config/skills`、`.config/opencode/profiles/ws/skills`。目标目录与坏链均无残留；使用 Pi 原生 `loadSkillsFromDir` 解析这 9 个目录，均无退出项；`.agents/.skill-lock.json` 无退出项。`tdd`、`diagnosing-bugs` 保持可发现。

验证仅覆盖安装文件、锁记录和解析，不证明各模型实际选用相同流程。已有会话上下文和运行时缓存未强制刷新，以免打断任务；重开对应会话后使用新入口集合。

## 两个保留项的评估

对照本机 Ryugi v1.78.0，而不是仅比较名称。

### tdd 与 Ryugi test-driven-development

共同点：逐行为红绿切片、先观察失败、通过公开边界测试、避免内部 mock、独立计算期望值。Ryugi 的 `writing-good-tests.md` 已覆盖行为测试、镜像断言、mock 边界与变异自检，不能认为这些只有 `tdd` 才提供。

`tdd` 的特殊价值是用 seam/module vocabulary 连接 `codebase-design`，要求测试前与用户确认 seams。它把重构留到 review；Ryugi 在每次 green 后允许 refactor，并带工作区选择、最终测试套件、验收衔接。

结论：保留作为测试边界设计或用户明确指定的替代入口，不建议与 Ryugi 的 TDD 循环同时执行。其参考文件可按需阅读；引用参考材料不等于启动整个 skill。调用策略本次未变。

### diagnosing-bugs 与 Ryugi systematic-debugging

共同点：根因优先、复现、单变量试验、修复前的失败证据、回归验证。

`diagnosing-bugs` 特别强调先做出一条 agent 可执行、能捕捉原症状的 tight/red 反馈命令，再推理；包含复现最小化、提高 flake 复现率、trace replay、差分、二分与性能 baseline。要求先列 3–5 个可证伪假设再逐个验证，清理带标记的探针。

Ryugi 更强调读错误、查近期变化和工作示例、沿边界追根因，每次验证一个假设；三次修复失败时停止并讨论架构，并明确衔接它自己的 TDD、可视错误 before/after 和最终 verifying。

结论：`diagnosing-bugs` 在难复现、并发与性能回归中有增量，应保留作为升级诊断方案，而不是在每次 bug 上顺序跑完两套流程。具体升级路由待用户确认，本次未改。

## AGENTS.md 建议 diff（未应用）

Pi 与其他宿主继续隔离维护；不增加共享继承，不合并文件。行为目标一致不要求配置来源合并。此前的共享继承、长篇路由改写和附带宿主职责调整提案撤回。

最小候选：在需要默认路由的独立指令文件中各加一句，不复述 Ryugi 各阶段的规则：

```diff
--- a/config/shared/AGENTS.md
+++ b/config/shared/AGENTS.md
@@
 ## 实施与权限
+
+- 开发流程默认遵循 Ryugi。

--- a/config/pi/AGENTS.md
+++ b/config/pi/AGENTS.md
@@
 ## 实施与权限
+
+- 开发流程默认遵循 Ryugi。
```

其余只在确认与选定流程冲突后删去对应流程句，不再逐段重写验证、提交与审查规则；权限、安全、宿主工具映射和其他明确个人偏好保留。这个候选不表示现有冲突已经处理，也不表示各宿主已加载 Ryugi。尚未授权应用，实际配置未动。

## 尚未统一的部分与后续边界

- 本次 T3 能力列表中的可运行实例为 Codex、Claude、Cursor、Grok、Antigravity、Pi；OpenCode、fx、kiro、muse 被标为 disabled。上述 skill 退出针对全局入口，而不是只修改 Pi 的技能目录。
- 受管 Ryugi 安装清单只记录 Pi、Codex、Claude Code，均为 Full v1.78.0；另有 Antigravity 的插件树。尚未证明 Cursor、Grok、Antigravity 的自动 bootstrap、共享政策入口和版本与前三者相同。本次没有替用户安装、更新或重写这些适配。
- `ask-matt`、`triage`、`improve-codebase-architecture`、`wayfinder` 仍有指向已退出入口的历史引用。后续核对确认 `ask-matt`、`triage` 已有 `disable-model-invocation: true` 和 Codex 的 `allow_implicit_invocation: false`；Pi 原生加载器确认默认提示中无这两个入口。保留文件不代表默认启用旧流程；显式调用仍可能遇到已退出依赖，不自动改写上游或增加转交规则。
- `tdd`、`diagnosing-bugs` 的自动描述和 Pi coreSkills 本次均保持不变；确定主流程下的调用边界后，须对所有宿主统一处理，而不是只在 Pi 隐藏元数据。
- `~/my/pi-stuff/config/pi/AGENTS.md`、`config/pi/pi-tool-exposure.json` 本来已有未提交改动；本次未改动或提交它们。T3 仓库的既有 `CLAUDE.md` 改动也未触碰。
- 未启动付费模型会话、未跑真实开发任务、未强制刷新运行中的 agent；没有改动项目代码或第三方 skill 正文。
