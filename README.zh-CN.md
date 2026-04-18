# openclaw-autosure

一个面向 OpenClaw 的独立 skill，用来做更安全的无人值守推进：包括有边界的自动续跑、带熔断的失败恢复，以及 `/autosure` 成功连轮控制，并可选配 UI 胶囊。

English: [`README.md`](README.md)

## 它是什么

Autosure 是一个可分发的 OpenClaw skill 包，适合长任务或半无人值守会话，核心目标是：

- 出错后基于明确信号续跑，而不是盲目重试
- 支持有边界或不限轮次的 `/autosure` 连续推进
- 人类随时插话接管
- 提供可选 userscript UI 胶囊；本机浏览器层失效时，可用 native fallback 修补 Control UI

## 安装

你可以直接使用 `dist/autosure.skill`，也可以把 `skill/autosure/` 放进 OpenClaw workspace 后按以下文档安装：

- `skill/autosure/DEPLOY.md`
- `skill/autosure/HANDOFF_FOR_AGENT.md`

## 仓库内容

- 安装包：`dist/autosure.skill`
- skill 源码：`skill/autosure/`
- 发布说明：`releases/v0.1.0.md`

## 版本

首次公开发布版本：`v0.1.0`
