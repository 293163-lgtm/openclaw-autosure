# Autosure 一键部署指南（任意 OpenClaw 主机）

> **当前交付口径（2026-04-19 closeout）**
>
> - 产品默认路线仍是 **userscript**。
> - mini49 当前机器的本地优先可用路径仍是 **native fallback**。
> - `/autosure N` 的当前产品语义是：**首轮立即前台续跑，剩余轮次按每轮完成后继续**。
>
> 若需要判断产品/架构真相，优先看：`SKILL.md` → `docs/PRD.md` → `docs/ARCHITECTURE.md` → `docs/UI_CAPSULE_SPEC.md`。

本包设计目标：**把本目录或压缩包交给 Agent / 运维**，按下列步骤即可在**任意已安装 OpenClaw** 的机器上落地。

## 前置条件

- 已安装 **OpenClaw CLI**（`openclaw -V` 正常）。
- 可写 **`~/.openclaw`**（或你自定义的 `OPENCLAW_STATE_DIR`）。
- 建议已配置 **`OPENCLAW_WORKSPACE`** 指向本 skill 所在 workspace；未设置时默认 `~/.openclaw/workspace`。

## 方式 A：交给 Agent 的一句话（推荐）

把下面整段原样发给负责部署的 Agent：

> 请在本机执行 Autosure 安装：  
> 1）将 skill 目录 `skills/autosure` 完整放到 `~/.openclaw/workspace/skills/autosure`（或你的 `OPENCLAW_WORKSPACE/skills/autosure`）。  
> 2）运行 `python3 ~/.openclaw/workspace/skills/autosure/scripts/install_bundle.py --mode full`（或 `--dry-run` 先看计划）。  
> 3）按脚本输出的 JSON 片段合并进 `~/.openclaw/openclaw.json`：`plugins.allow` **追加** `autosure-resume`（保留原有 telegram/memory 等项）；`plugins.load.paths` 若有则**追加**路径勿覆盖；`entries` 按片段合并。（**不要**同时启用 `autosure-resume` 与 `auto-resume-lite`。）  
> 4）执行 `openclaw config validate` 与 `openclaw plugins inspect autosure-resume`，确认 **Status: loaded**。  
> 5）`openclaw daemon restart` 或等价方式重载网关。

## 方式 B：人工拷贝

1. 复制整个 `autosure` 文件夹到 `~/.openclaw/workspace/skills/autosure`。  
2. 复制 `vendor/autosure-resume` → `~/.openclaw/workspace/plugins/autosure-resume`。  
3. （可选）若走极简续跑：复制 `vendor/auto-resume-lite` → `plugins/auto-resume-lite`。若目标机历史上已使用 `plugins/openclaw-auto-resume-lite`，可先保留旧目录与旧 `load.paths`；新版 `install_bundle.py --mode lite` 会同步刷新这个 legacy 别名目录，之后再择机迁移到 canonical 路径。  
4. 合并 `openclaw.json` 中插件条目与 allowlist，校验后重启网关。

## 当前机器补充（mini49）

当前机器对 `http://127.0.0.1:18789/chat*` 的 Tampermonkey 注入已验证不稳定。若你是在这台机器上部署，不必继续反复排查 userscript 注入层，先跑 Repair Center：

```bash
python3 skills/autosure/scripts/repair_center.py verify
```

重点看：
- `statusSummary`
- `recommendedAction`
- `recommendedCarrier`

若返回 `recommendedAction: restore-native-patch` 或 `recommendedCarrier: native-fallback`，再直接优先使用 native fallback。

推荐使用幂等刷新入口，而不是只做一次性 install：

```bash
python3 skills/autosure/scripts/repair_center.py native-install
# 或
python3 skills/autosure/scripts/patch_control_ui.py reinstall
```

本机验收页：

```text
http://127.0.0.1:18789/chat?session=agent%3Amain%3Amain&autosureDebug=1
```

该参数仅用于现场验收：会强制展开胶囊并显示 `AUTOSURE DEBUG` 文案，方便截图 / OCR；正常交付页不带该参数。

## 可选：启用 UI 胶囊（A1 userscript）

1. 打开 `ui-capsule/repair-pack/autosure-capsule.user.js`。  
2. 在 Tampermonkey 新建脚本并粘贴保存。  
3. 刷新 OpenClaw chat 页面，胶囊应出现在刷新按钮附近（若失败则右上浮层）。  
4. 胶囊“暂停”固定发送：`/autosure stop`。

禁用/修复见：`ui-capsule/repair-pack/ENABLE_DISABLE.md`。

## 若 Tampermonkey 已安装但仍不执行：启用 native fallback

当你已经确认：

- userscript 已成功装进 Tampermonkey 本地库；
- 但 `http://127.0.0.1:18789/chat*` 页面仍没有任何注入效果；

先运行：

```bash
python3 skills/autosure/scripts/repair_center.py verify
```

重点看：
- `statusSummary`
- `recommendedAction`
- `recommendedCarrier`

若返回 `recommendedAction: restore-native-patch` 或 `recommendedCarrier: native-fallback`，可直接在本机启用 Control UI 原生修复：

```bash
python3 skills/autosure/scripts/patch_control_ui.py install
```

默认补丁目标：

- `~/.volta/tools/image/packages/openclaw/lib/node_modules/openclaw/dist/control-ui/index.html`

这条路线会：

- 备份原始 `index.html`
- 把 autosure 控件作为本机 OpenClaw Control UI 的原生浮层注入进去
- 在 mini49 当前机器上，作为 **优先可用本地路径**

本机验收可直接打开：

```text
http://127.0.0.1:18789/chat?session=agent%3Amain%3Amain&autosureDebug=1
```

页面应显示 `AUTOSURE DEBUG` 与展开态胶囊，方便 OCR / 截图核验。

卸载：

```bash
python3 skills/autosure/scripts/patch_control_ui.py uninstall
```

## 安装脚本

```bash
python3 skills/autosure/scripts/install_bundle.py --help
python3 skills/autosure/scripts/install_bundle.py --dry-run
python3 skills/autosure/scripts/install_bundle.py --mode full
python3 skills/autosure/scripts/repair_center.py verify
```

## 装完自检

```bash
python3 skills/autosure/scripts/verify_health.py --mode full
python3 skills/autosure/scripts/verify_health.py --mode lite
openclaw plugins inspect autosure-resume
python3 skills/autosure/scripts/autosure_doctor.py --pretty
python3 skills/autosure/scripts/autosure_validate_runtime.py snapshot --session-key agent:main:main
```

## Loop 状态解释（避免误判）

不要把 `phase` 单独当成 autosure loop 真相。

bounded loop 是否真的完成，优先看：
- `inflightResume`
- `loopControl.active`
- `loopControl.remainingRounds`
- `loopControl.completedRounds`
- `loopControl.lastCommandRaw`

验证脚本已内建更可靠口径：
- `effectiveLoopState`
- `phaseAuthoritativeForLoop`
- `terminalTailObserved`
- `authoritativeLoopFinished`

若 `authoritativeLoopFinished = true`，即使 `phase` 仍显示 `running`，也不代表 loop 还活着。

## 互斥说明（重要）

| 模式 | 启用插件 | 说明 |
|------|-----------|------|
| **生产推荐** | `autosure-resume` | 失败续跑 + `/autosure` 多轮 + 发动词轮换 + 熔断/去重 |
| **极简** | `auto-resume-lite` | 仅失败一次续跑提示，无循环能力；兼容历史目录别名 `openclaw-auto-resume-lite`，但建议最终迁到 canonical 路径 |

---

版本与变更记录见 `RELEASE_NOTES.md`；架构与需求见 `docs/`。
