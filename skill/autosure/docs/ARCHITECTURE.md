# Autosure for OpenClaw — 架构说明（v2.1）

## 1. 总览

v2.1 采用「核心能力在插件，体验增强在旁路 UI」的双层架构：

1. **核心层（必需）**：`autosure-resume` / `auto-resume-lite` 插件 + `发动词.txt`，保证自动续跑与自动继续。
2. **增强层（可选）**：UI 胶囊 userscript（A1），提供可视化状态与快捷操作。

> 关键原则：增强层失效时，核心层必须不受影响。

## 2. 分层图

```text
┌─────────────────────────────────────────────────────────────┐
│ OpenClaw Runtime                                            │
│  ├─ skill/autosure (文档、安装、发动词、修复包入口)         │
│  ├─ plugin/autosure-resume (主状态机)                       │
│  └─ plugin/auto-resume-lite (极简模式，互斥)                │
└─────────────────────────────────────────────────────────────┘
            ▲
            │ 命令桥接（/autosure, /autosure stop, /autosure status）
            ▼
┌─────────────────────────────────────────────────────────────┐
│ Browser userscript capsule（可选，A1）                     │
│  ├─ 胶囊 UI（状态+快捷 3/6/9）                              │
│  ├─ 命令发送器（写入输入框并触发发送）                      │
│  └─ 修复包（选择器升级、启停脚本）                          │
└─────────────────────────────────────────────────────────────┘
```

## 3. 核心层逻辑（不依赖胶囊）

### 3.1 成功连轮

- `agent_end(success)` -> `scheduleLoopIdleContinuation()`
- 等待 `loopIdleGraceMs`
- 窗口内若有用户进线 -> 取消本次定时器
- 窗口超时 -> 注入一条发动词并开始下一轮

### 3.2 失败续跑

- `agent_end(failed)` -> `maybeScheduleResume()`
- 执行去重、冷却、熔断检查
- 调度系统事件 + heartbeat

### 3.3 暂停语义（B1）

- **暂停 = `/autosure stop`**
- 非“软暂停剩余轮次”，而是明确终止当前循环控制。

## 4. 取消双保险（v2.1）

为降低单钩子依赖，取消路径采用双通道：

1. `before_dispatch`（已有）：可直接拿到 `sessionKey`，即时取消 pending timer。
2. `message_received`（新增）：通过 `channel/account/conversation` 映射到最近活跃 `sessionKey`，再取消。

说明：第二路径是稳健性兜底，避免某些通道/版本在 `before_dispatch` 前后行为差异导致漏取消。

## 5. UI 胶囊设计边界（A1）

### 5.1 为什么选 userscript

- 不改 OpenClaw 主仓，避免升级 merge 成本。
- 可独立发版与修复（修复包）。
- 可完全关闭，不影响核心。

### 5.2 状态来源

第一版采用“命令驱动 + 本地状态”：

- 快捷按钮触发命令；
- 胶囊显示本地最近动作状态（运行/停止/未知）；
- 通过 `/autosure status` 手动刷新。

后续可演进为订阅日志或稳定 API（若平台提供）。

### 5.3 挂载策略

1. 首选挂载：chat 页刷新按钮左侧。
2. 找不到锚点：降级为右上固定浮层（仍可用）。

## 6. 互斥与兼容

- `autosure-resume` 与 `auto-resume-lite` 互斥。
- 胶囊与插件非互斥：胶囊只是“遥控器”。
- OpenClaw 升级后，若胶囊失效：禁用胶囊即可回到纯命令模式。

## 7. 可观测性

建议最小事件集合：

- `loop_idle_wait_scheduled`
- `loop_idle_inject_committed`
- `loop_idle_cancelled_by_user`
- `resume_scheduled_from_failure`
- `capsule_command_sent`
- `capsule_mount_fallback`

## 8. 回退机制

1. **禁用胶囊**：用户脚本停用/卸载。
2. **禁用增强包**：不加载 `ui-capsule` 文件。
3. **保底能力**：用户手工输入 `/autosure...` 继续可用。

---

相关产品口径见 `docs/PRD.md`；胶囊专项见 `docs/UI_CAPSULE_SPEC.md`。

