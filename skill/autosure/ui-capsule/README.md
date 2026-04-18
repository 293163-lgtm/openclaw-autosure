# Autosure UI Capsule（A1 userscript）

这是一个**可选增强层**，不属于 autosure 核心执行链。

- 启用它：获得可视化胶囊与快捷按钮（3/6/9/不限/暂停/状态）。
- 关闭它：`/autosure` 系命令仍可手工输入，核心功能不受影响。

## 目录

- `repair-pack/autosure-capsule.user.js`：主 userscript。
- `repair-pack/selectors.json`：挂载与发送按钮选择器策略。
- `repair-pack/CHANGELOG.md`：修复记录。
- `repair-pack/ENABLE_DISABLE.md`：启停与修复说明。

## 关键语义

- “暂停”按钮固定发送：`/autosure stop`（B1）。
- 胶囊挂载失败时自动降级为右上角浮层，不阻塞 chat。

