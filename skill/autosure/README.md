# Autosure for OpenClaw

> 可分发的无人值守增强包（Skill + Plugins + Docs + UI Capsule Repair Pack）

## 文档权威顺序（先看这个）

如果你想快速判断“现在这套 autosure 到底以什么为准”，按下面顺序读：

1. `SKILL.md` —— skill 入口、边界、主命令
2. `docs/PRD.md` —— 产品范围与验收口径
3. `docs/ARCHITECTURE.md` —— 当前架构真相
4. `docs/UI_CAPSULE_SPEC.md` —— 当前 UI 冻结基线
5. `README.md` —— 使用 / 安装 / 运维总览
6. `DEPLOY.md` / `HANDOFF_FOR_AGENT.md` / `小白使用说明.md` —— 面向不同操作者的执行文档

### 已归档的历史/过程文件

以下文件已从前台产品文档面移入 `archive/`，默认只作为历史参考：

- `archive/root-workfiles/architecture.md`
- `archive/root-workfiles/findings.md`
- `archive/root-workfiles/progress.md`
- `archive/root-workfiles/task_plan.md`
- `archive/docs-history/HANDOFF_CONTINUATION_2026-04-18.md`
- `archive/docs-history/TRACK_A_VALIDATION_NOTE_2026-04-18.md`
- `archive/docs-history/USERSCRIPT_CARRIER_HEALTH_NOTE_2026-04-18.md`
- `archive/docs-history/UI_CONVERGENCE_GAP.md`
- `archive/docs-history/UI_CONVERGENCE_PLAN.md`
- `archive/docs-history/UI_CAPSULE_VNEXT_PLAN.md`
- `archive/docs-history/AUTOSURE_TEST_HARNESS_PLAN_2026-04-18.md`
- `archive/docs-history/REPAIR_CENTER_STABILIZATION_PLAN_2026-04-18.md`
- 其他阶段性 plan / note / handoff 文档

如果你要追历史脉络，读 `archive/README.md`。

## 项目背景（中文）

`autosure` 用于解决 OpenClaw 在长任务中的两个核心痛点：

1. 任务中断后需要人工反复“接着干”；
2. 任务成功后想自动推进，但又要保证“人类优先、可停止、可回退”。

当前版本把能力分为 **核心层** 与 **可选增强层**：

- **核心层**：`autosure-resume`（主）/`auto-resume-lite`（极简互斥）；
- **增强层**：A1 userscript 胶囊（可视化快捷操作，失效不影响核心）。

## Background (English)

`autosure` is a distributable add-on for OpenClaw unattended workflows.

It provides:

- failure-safe resume with circuit governance,
- success-loop continuation via `/autosure` commands,
- optional UI capsule (userscript) for direct controls,
- deployment and operational docs for handoff scenarios.

## 安装方式 / Installation

### 快速安装（推荐）

```bash
python3 skills/autosure/scripts/install_bundle.py --dry-run
python3 skills/autosure/scripts/install_bundle.py --mode full
```

然后将脚本输出的 `plugins` 片段**合并**到 `~/.openclaw/openclaw.json`（`allow`/`load.paths` 追加，不覆盖现有条目）。

> 若你在维护历史 lite 安装，旧目录 `plugins/openclaw-auto-resume-lite` 仍可暂时保留；新版安装器在 `--mode lite` 下会同步刷新这个 legacy 别名目录，但长期应迁回 canonical 路径 `plugins/auto-resume-lite`。

### UI 胶囊安装顺序（新增建议）

优先级：

1. **先走 Tampermonkey userscript**（默认分发形态）
2. 若确认脚本已安装但在本机 `127.0.0.1:18789/chat*` **不执行**，再启用 **native fallback**：

```bash
python3 skills/autosure/scripts/patch_control_ui.py reinstall
```

或走 Repair Center 的幂等入口：

```bash
python3 skills/autosure/scripts/repair_center.py native-install
```

这里推荐 `reinstall` / `native-install`，而不是只依赖旧式 `install` 检测，因为 marker 已存在并不代表当前 Control UI dist 已吃到最新 capsule 代码。

这会把 autosure 控件直接注入本机 OpenClaw Control UI 的 `index.html`，适合作为浏览器 userscript 层失效时的维修方案。

### 当前机器（mini49）已验证结论

在当前这台机器上，Tampermonkey 执行层已确认不可靠，**native fallback 是当前本机优先可用路径**。

本机验收建议：

- 正常使用：`http://127.0.0.1:18789/chat?session=agent%3Amain%3Amain`
- 可视化验收：`http://127.0.0.1:18789/chat?session=agent%3Amain%3Amain&autosureDebug=1`

其中 `autosureDebug=1` 会临时强制展开胶囊并显示 `Autosure` / `AUTOSURE DEBUG` 文案，方便截图、OCR 与肉眼确认；默认 `/chat` 交付行为不受影响。

### 自检

```bash
python3 skills/autosure/scripts/verify_health.py --mode full
python3 skills/autosure/scripts/verify_health.py --mode lite
openclaw plugins inspect autosure-resume
```

## Repair Center / Carrier Doctor（新增）

当你需要一次性看清：
- native fallback 是否已安装
- 007 主浏览器身份里是否存在 userscript manager
- userscript 文件是否已 staged
- 当前机器应优先走哪条 carrier
- 是否存在 native rollback backup
- 当前恢复状态属于 healthy / blocked / mixed 的哪一类

直接运行：

```bash
python3 skills/autosure/scripts/repair_center.py verify
```

关键输出字段：
- `statusSummary`
- `recommendedAction`
- `carrierDiagnosis`
- `recommendedCarrier`
- `nextSteps`

常用动作：

```bash
python3 skills/autosure/scripts/repair_center.py stage-userscript
python3 skills/autosure/scripts/repair_center.py native-install
python3 skills/autosure/scripts/repair_center.py native-uninstall
python3 skills/autosure/scripts/repair_center.py native-rollback
python3 skills/autosure/scripts/repair_center.py open-acceptance-url
```

返回是结构化 JSON，适合 handoff、运维排查、以及后续 doctor/test harness 接入。

## 运行步骤 / Runtime Use

### 核心命令

- `/autosure`：不限轮次自动继续（直到 `/autosure stop` 或人工消息覆盖）
- `/autosure N`：继续 N 轮（不含本命令这条；启动命令本身只代表**已接收启动**，不计入 `completedRounds`）
- `/autosure status`：查看状态
- `/autosure stop`：停止
- `/autosure-demo`：演示模式（短答演示，不等同生产推进）

### 状态判断口径（重要）

不要只看 `phase`。

在 autosure 的 bounded loop 语义里，真正 authoritative 的判断应优先看：
- `loopControl.active`
- `loopControl.targetRounds`
- `loopControl.remainingRounds`
- `loopControl.completedRounds`
- `loopControl.lastCommandRaw`
- `inflightResume`

如果验证脚本输出：
- `effectiveLoopState`
- `phaseAuthoritativeForLoop = false`
- `terminalTailObserved`
- `authoritativeLoopFinished`

则应以这些字段为最终结论，而不是因为 `phase` 仍显示 `running` 就误判“还在继续跑”。

### UI 胶囊（可选）

`ui-capsule/repair-pack/autosure-capsule.user.js`  
通过 Tampermonkey 启用，提供 3/6/9/不限/暂停/状态快捷按钮。  
暂停语义固定：`/autosure stop`。

## 核心功能 / Core Features

- 失败续跑：timeout/tool_error/agent_error 等触发安全续跑；
- 成功连轮：空窗等待 + 发动词注入；
- 去重、冷却、熔断；
- 取消双保险：`before_dispatch` + `message_received` 映射取消；
- 可分发：vendor 插件 + 安装脚本 + 交接文档；
- 可回退：禁用胶囊后，核心命令链路不受影响。

## 目录结构 / Directory Structure

### 前台产品文档面
- `SKILL.md`：Skill 入口
- `README.md`：总览说明
- `DEPLOY.md`：部署指南
- `HANDOFF_FOR_AGENT.md`：部署 Agent 入口
- `小白使用说明.md`：人类操作入口
- `docs/PRD.md`：产品需求（v2.1）
- `docs/ARCHITECTURE.md`：架构说明（v2.1）
- `docs/UI_CAPSULE_SPEC.md`：胶囊专项设计

### 执行/交付相关
- `MANIFEST.json`：包清单与版本
- `vendor/autosure-resume/`：主插件副本
- `vendor/auto-resume-lite/`：极简插件副本（互斥）
- `scripts/install_bundle.py`：安装脚本
- `scripts/verify_health.py`：健康检查
- `ui-capsule/repair-pack/`：胶囊与修复包
- `RELEASE_NOTES.md`：版本说明

### 历史归档
- `archive/`：阶段性计划、排障、handoff、工作记录（非当前权威入口）

