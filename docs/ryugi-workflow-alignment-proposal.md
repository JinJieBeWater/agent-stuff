# Ryugi 主流程：退出旧入口与规则收敛提案

日期：2026-11-16。本文是调查和变更记录，不是生效的 agent 指令。

## 用户反馈原文与授权边界

针对 `grilling`、`implement`、`implement-spec`：

> 这些退出吧，注意在我T3code配置的所有agent都需要一起退出，我t3code里面的所有配置行为需要一致

针对 `tdd`、`diagnosing-bugs`：

> 这两个感觉还有用吧？或者你评估一下这两个和那两个的区别

针对 AGENTS.md 收敛：

> 有哪些呢，具体给我看diff

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

统一架构应为一个共享政策源，各宿主只保留工具映射；目前 Pi 与共享文件仍各自维护，不能宣称已经行为一致。以下为相对于本次读取的工作区内容的提案，未覆盖用户原有未提交改动。

### 共享规则

```diff
--- a/config/shared/AGENTS.md
+++ b/config/shared/AGENTS.md
@@
-- 解释机制或比较方案时，读取并使用 `~/.agents/skills/show-me/SKILL.md`，选择最小有效图示。
-- 访谈提问将同轮需要确认的问题集中提出，每题独立列出；有选项时，推荐项在前并标「（建议）」，说明推荐理由。
+- 解释机制或比较方案时，使用宿主对应的 show-me skill，选择最小有效图示。
+- 提问节奏遵循当前 skill；有选项时，推荐项在前并标「（建议）」，说明推荐理由。
@@
 ## 实施与权限
+
+- 开发主流程使用 Ryugi；项目专用 skill 接管对应步骤。旧工作流入口不再接管开发阶段；其引用的已退出 skills 按阶段转交 Ryugi。
@@
-- 确认无真实用户的项目：用最简单实现替换，更新全部调用方，不做兼容或迁移、不留旧实现备用。先更新文档；行为测试只锁行为，先观察失败再最少实现；核对文档与代码后，清理本次废弃代码、文件和文档。
+- 确认无真实用户的项目：用最简单实现替换，更新全部调用方，不做兼容或迁移、不留旧实现备用。先更新文档；核对文档与代码后，清理本次废弃代码、文件和文档。
@@
-- 遇到耗时构建、批量测试或批处理任务，主动提醒我可以交给 `kvm` 执行。在 KVM 执行重计算时，先走项目已有的执行入口与锁，再按全机 CPU、内存余量（含其他 agent 的任务）主动提高独立任务并发和工具线程数。
+- 遇到耗时构建、批量测试或批处理任务，主动提醒我可以交给 `kvm` 执行；一次性 KVM 命令用 `hc run --on kvm`。在 KVM 执行重计算时，先走项目已有的执行入口与锁，再按全机 CPU、内存余量（含其他 agent 的任务）主动提高独立任务并发和工具线程数。
@@
-- 审查默认 `ponytail-review`，规范验收用 `code-review`；同一范围只做一套完整审查，子 agent 遵循分配视角。仅在明确要求时进行多 agent 独立复核。
+- Ryugi 的最终审查采用 `ponytail-review`；明确要求规范验收时改用 `code-review`，不额外叠加审查。子 agent 遵循分配视角；仅在明确要求时进行多 agent 独立复核。
@@
-- 验证覆盖目标与实际风险，采用最小充分检查；复用有效结果，只补缺口或失效证据，满足验收即收口。交付前运行相关测试并亲自检查输出，说明删除项（无则注明）、未运行检查和是否已提交。
+- 验证范围与完成标准遵循 Ryugi verifying 及项目验收要求；只复用满足其要求的当前会话有效证据。交付说明删除项（无则注明）、未运行检查和是否已提交。
@@
-- 修复反馈时，完成标准是回放原始或同类场景并确认原错误消失；闪烁、跳动等动态问题逐帧比对过渡帧。测试和分数只作旁证。
+- 闪烁、跳动等动态问题逐帧比对过渡帧，测试和分数只作旁证。
@@
-- 验证通过或无可运行验证时，自动按照 Conventional Commits 提交改动，后者在交付中注明未验证；补修本任务的 HEAD 且确认未推送时 amend。push 由我发起；hook 失败时修复根因后重新提交。
+- 提交时机遵循 Ryugi 当前阶段；提交信息用 Conventional Commits，补修本任务的 HEAD 且确认未推送时 amend。push 由我发起；hook 失败时修复根因后重新提交。
```

保留中文、权限与安全边界、第三方文件保护、文档写作要求、无真实用户时的简化政策、持久目录、依赖和环境规则、提交格式及 push 权限。改变的是流程负责方，不是降低测试或验收标准。

### Pi 入口

提案将 `config/pi/AGENTS.md` 的整份重复政策替换为下列 6 行（不是在现有文件末尾追加）：

```markdown
始终读取并遵循 `~/.agents/AGENTS.md`。

- 解释机制或比较方案时使用 Pi 版 show-me skill，选择最小有效图示。
- 提问使用 `ask`，节奏遵循当前 skill；每题一个 prompt，有选项时推荐项在前并标「（建议）」，理由写进 description。
- 明确要求多 agent 独立复核时，读取并遵循 `~/.pi/agent/skills/multi-agent-review/SKILL.md`。
- 若 `~/.pi/agent/local-environment.md` 存在，读取并遵循；该文件不入库。
```

其中原来的强制 frontier 合并规则退出；KVM 的单次命令移到共享源，避免其他宿主缺失。若采用该方案，`config/shared/README.md` 的“Pi 独立、不读取共享源”说明须在同次修改中更新。

### Claude 入口中的额外限制

`~/.claude/CLAUDE.md` 已读取共享源，但还含如下旧的主从职责规定；若要不同宿主都能执行同一主流程，提议删除该规定，保留 RTK 与原生子 agent 工具约束：

```diff
--- ~/.claude/CLAUDE.md
+++ ~/.claude/CLAUDE.md
@@
-Codex 仅承担只读调查与代码审查；设计、实现、修复和最终验收由主 Claude 负责。
```

## 尚未统一的部分与后续边界

- 本次 T3 能力列表中的可运行实例为 Codex、Claude、Cursor、Grok、Antigravity、Pi；OpenCode、fx、kiro、muse 被标为 disabled。上述 skill 退出针对全局入口，而不是只修改 Pi 的技能目录。
- 受管 Ryugi 安装清单只记录 Pi、Codex、Claude Code，均为 Full v1.78.0；另有 Antigravity 的插件树。尚未证明 Cursor、Grok、Antigravity 的自动 bootstrap、共享政策入口和版本与前三者相同。本次没有替用户安装、更新或重写这些适配。
- `ask-matt`、`triage`、`improve-codebase-architecture`、`wayfinder` 仍有指向已退出入口的历史引用。它们没有被擅自删除或改写；在路由政策收敛前，不应再把它们当作可完整运行的旧开发链。上述共享 diff 中的转交规则用于解决其路由引用，不修改上游文件。
- `tdd`、`diagnosing-bugs` 的自动描述和 Pi coreSkills 本次均保持不变；确定主流程下的调用边界后，须对所有宿主统一处理，而不是只在 Pi 隐藏元数据。
- `~/my/pi-stuff/config/pi/AGENTS.md`、`config/pi/pi-tool-exposure.json` 本来已有未提交改动；本次未改动或提交它们。T3 仓库的既有 `CLAUDE.md` 改动也未触碰。
- 未启动付费模型会话、未跑真实开发任务、未强制刷新运行中的 agent；没有改动项目代码或第三方 skill 正文。
