# UI Capsule Repair Pack Changelog

## 1.3.2 (2026-04-18)

- 新增 native fallback 验收可视化模式：当 Control UI URL 带 `?autosureDebug=1` 时，胶囊会强制展开，并在 trigger 上显示 `Autosure` 与状态文字，方便 OCR / 截图验收。
- 该模式仅用于本机现场验收，不改变默认交付行为；正常 `/chat` 仍保持收起态胶囊。

## 1.3.1 (2026-04-18)

- 现场调试加固：为 native fallback 增加可控调试开关，用于隔离以下疑点：
  - `autosure.native.enableObserver=1`
  - `autosure.native.enableAutoStatus=1`
  - `autosure.native.disableSuppress=1`
  - `autosure.native.debug=1`
- 将 native fallback 默认收缩为保守模式：不开启高频 `MutationObserver`，不自动追加 `/autosure status` 轮询；改为低频 boot 重试挂载 + 手动 `Status` 按钮查询，优先保障 OpenClaw chat 页面稳定性。
- 新发现：当前机器的 OpenClaw chat 页面出现“页面无响应”，需先完成 native fallback 的根因排障，再宣称 UI 接管成功。

## 1.3.0 (2026-04-18)

- UI vNext 首轮实现：
  - 收起态改为 **图标 + 状态点**
  - 展开方向改为 **向下**
  - 按钮布局改为 **两排**（`3/6/9/∞` + `Stop/Status`）
  - 优先挂载到 **刷新图标左边**
  - 锚点失败时降级为 **右上角收起态图标**，不再默认使用右下角大面板
- 结构重构：
  - userscript 与 native fallback 对齐为同一产品形态
  - 将 mount strategy / capsule component / command bridge 收口到同一交互模型
- 现场诊断补充：
  - 当前机器的 Tampermonkey 本地库仍残留 `Autosure Capsule 1.0.1`
  - 这会污染本机验证结果，使页面继续显示旧 UI
  - 结论：工程实现已切到 vNext，浏览器现场仍需单独清理旧 userscript 状态

## 1.2.0 (2026-04-18)

- userscript 清理与升级：
  - 去除调试期 `alert(...)` 注入探针，恢复正式交付版本
  - 保留 `/chat*` 与 `/__openclaw__/*` 双 match，兼容旧新 Control UI 路径
- 新增 **native fallback**：
  - 增加 `native-control-ui-capsule.js`
  - 增加 `scripts/patch_control_ui.py`
  - 当 Tampermonkey 在本机浏览器层不执行 userscript 时，可直接把 autosure 控件注入本机 OpenClaw Control UI 的 `index.html`
- 定位结论固化：
  - 本次故障不是插件核心、不是 match 规则、不是 host permission
  - 关键故障层位于 **Tampermonkey 对本机 `127.0.0.1:18789/chat*` 页面未实际执行已安装脚本**
  - 因此将 native fallback 作为运维修复包的一部分保留

## 1.1.0 (2026-04-16)

- 状态增强：
  - 页面加载后自动发送一次 `/autosure status` 做状态对齐
  - 每次快捷动作后自动追加状态同步
  - 监听页面文本，解析 `Autosure 状态` 结果并更新胶囊标签
- 插件配套：
  - `autosure-resume` 支持在 `before_dispatch` 直接响应 `/autosure status`（无需等一轮结束）

## 1.0.0 (2026-04-16)

- 首版 userscript 胶囊（A1）：
  - 快捷 3/6/9/不限
  - 暂停 = `/autosure stop`（B1）
  - 状态按钮 `/autosure status`
  - 刷新左侧挂载 + 浮层降级

