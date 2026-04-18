# auto-resume-lite（随 Autosure 包分发）

**定位**：失败当轮后的**最小**一次系统续跑提示 + heartbeat，无循环、无熔断、无去重状态机。

**与 `autosure-resume` 关系**：**二选一**。同时启用可能导致重复续跑，请在 `openclaw.json` 的 `plugins.entries` 里只打开其一。

**何时用 lite**：极简环境、只想「挂了再顶一下」、不需要 `/autosure` 多轮与发动词轮换。
