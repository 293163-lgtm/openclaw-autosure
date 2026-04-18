# autosure 中文入口

先读 `SKILL.md`。

## 文档权威顺序（重要）

如果你只想知道**现在什么是真的**，按这个顺序读，不要反过来：

1. `SKILL.md` —— skill 入口、范围、主边界
2. `docs/PRD.md` —— 产品范围与验收口径
3. `docs/ARCHITECTURE.md` —— 当前架构与分层真相
4. `docs/UI_CAPSULE_SPEC.md` —— 当前 UI 冻结基线与交互合同
5. `README.md` —— 面向使用/部署的总览说明
6. `DEPLOY.md` / `HANDOFF_FOR_AGENT.md` / `小白使用说明.md` —— 面向不同操作者的执行入口

## 哪些文件已经归档

下面这些文件已经移入 `archive/`，默认只当历史参考，不再占据前台产品文档面：

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

如果你要追历史脉络，读 `archive/README.md`。

## 当前收口后的现实口径（2026-04-19）

- 产品默认路线仍是 **userscript**。
- mini49 当前机器的本地优先可用路径仍是 **native fallback**。
- `/autosure N` 的当前产品语义是：**首轮立即前台续跑，剩余轮次按每轮完成后继续**。
- UI 冻结基线仍有效：
  - 默认收起
  - Refresh 左边
  - 图标 + 状态点
  - 向下展开
  - 两排按钮：`3 / 6 / 9 / ∞` 与 `Stop / Status`
- 当前 autosure Control UI 线已进入**正式 closeout 后的可交付状态**；后续继续推进属于 polish / regression hardening，而不是重新开大修。

## 这是什么

`autosure` 是给 OpenClaw 长任务/无人值守场景用的可分发 skill 包，核心目标只有三个：

- 失败后能安全续跑；
- 成功后能按 `/autosure` 继续推进；
- 用户随时一句话就能打断，不会消息风暴。

## 先读顺序

1. `SKILL.md` —— 技能入口、适用边界、主命令
2. `docs/PRD.md` —— 产品目标与验收口径
3. `docs/ARCHITECTURE.md` —— 核心层 / UI 胶囊分层
4. `docs/UI_CAPSULE_SPEC.md` —— userscript 胶囊专项
5. `小白使用说明.md` —— 给人类操作者
6. `DEPLOY.md` / `HANDOFF_FOR_AGENT.md` —— 给部署 Agent / 运维

## 快速判断怎么用

### 只是想在本机启用 autosure

直接看：
- `scripts/install_bundle.py`
- `scripts/verify_health.py`
- `小白使用说明.md`

### 想发给别人机器 / 客户 / 另一台 OpenClaw

直接看：
- `DEPLOY.md`
- `HANDOFF_FOR_AGENT.md`
- `MANIFEST.json`

默认路线：
- **先装 userscript 胶囊**（Tampermonkey）
- 若确认脚本已安装但本机 `127.0.0.1:18789/chat*` **不执行**，再用：
  - `scripts/patch_control_ui.py`
  - `ui-capsule/repair-pack/native-control-ui-capsule.js`

也就是说，**native fallback 是维修路线，不是默认分发主路线**。

### 当前机器（mini49）例外结论

在 mini49 当前机器上，Tampermonkey 执行层已验证不可靠，因此本机应**优先使用 native fallback**。

验收可直接打开：
- `http://127.0.0.1:18789/chat?session=agent%3Amain%3Amain&autosureDebug=1`

该参数只用于现场核验：会强制展开胶囊并显示 `AUTOSURE DEBUG` 文案，默认正式页不带它。

### 想改产品与实现

直接看：
- `docs/PRD.md`
- `docs/ARCHITECTURE.md`
- `vendor/autosure-resume/index.js`
- `ui-capsule/repair-pack/autosure-capsule.user.js`

## 目录里哪些是“核心”，哪些是“会拖后腿的噪音”

### 核心
- `SKILL.md`
- `vendor/`
- `scripts/`
- `docs/`
- `ui-capsule/repair-pack/`
- `MANIFEST.json`

### 会增加维护成本的外围文档
- `README.md`
- `PACKAGE.md`
- `architecture.md`
- `findings.md`
- `progress.md`
- `task_plan.md`

这些文件不是完全不能留，但它们不是 skill 的最小权威面。后续若继续瘦身，优先先砍这圈重复层。

## 当前已知最该优化的点

1. 安装脚本以前会直接覆盖插件目录但不留回滚备份；现在已补备份。
2. 健康检查以前只看“有没有”，不看“装进去的插件是不是跟 vendor 一致”；现在已补一致性检查。
3. 文档层还有重复和分裂，后续应该再收口成更锋利的一套权威链。
