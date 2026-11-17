[简体中文](README.md) | [English](README.en.md)

# Pi Herdr tab title

把 Pi 会话名称同步到所在 Herdr Core / Herdr App 标签页。只在经 Core 核验的交互式 Pi 终端注册，响应 `session_start` 和 `session_info_changed`。空名称不改标签。

随[仓库 Git package](../../README.md#安装)安装，入口为 `packages/pi-herdr-tab-title/index.ts`；可用 `pi config` 单独停用。

重载 Pi 后，使用 `/name 标题` 即可同步。

- 核验 `HC_TERMINAL_ID`、`HC_TERMINAL_SOCKET` 和 Pi 进程归属后，读取本终端
  `hc get <HC_TERMINAL_ID> --json`，要求准确地址及终端携带的随机
  `herdr.space` / `herdr.tab` 标签，与 `herdr-app ls` 中本地
  `machine: null` 的 space、tab、terminal 三者一致，然后显式传入
  `id` / `name` 调用 `herdr-app do tab.rename`。执行前复核 App socket 身份。
- 同一标签页有多个 agent（分屏）时，只有排在最前的 agent 改标签名，避免
  轮流覆盖；每个 Pi 都把自己的会话名写到本终端标签 `pi.session`
  （`hc label`），侧边栏据此区分同一标签页里的各个 agent。
- App 未运行、目标不匹配、标签缺失、命令失败时安全跳过。后台 worker
  不借用父终端标签；不启动 App、不创建终端、不改变焦点。
- 标题更新串行执行；等待期间被新标题取代的旧更新会跳过。

运行本包检查：`bun run test`、`bun run check-types`。测试只替换外部执行、
socket 和文件系统副作用，不操作真实标签页。原上游扩展文件保留，由配置选择
加载本包，避免同时加载两个标题同步扩展。
