# 胶囊启停与修复

## 两条路线先分清

### 路线 A：Tampermonkey userscript（默认推荐）

适合绝大多数机器。优点是**不改 OpenClaw 本体文件**，迁移最干净。

### 路线 B：Native fallback（本机 Control UI 热补丁）

当你已经确认下面这件事成立时再用：

- Tampermonkey 脚本**已成功安装进本地库**，但在 `http://127.0.0.1:18789/chat*` 页面**仍不执行**。

这时说明问题在**浏览器 userscript 注入层**，不是 autosure 插件核心。可直接启用 native fallback，把控件注入本机 OpenClaw Control UI。

---

## 启用（Tampermonkey）

### 方式 A：直接导入修复包脚本（推荐）

```bash
bash skills/autosure/ui-capsule/repair-pack/enable.sh
```

默认会把 `autosure-capsule.user.js` 复制到 `~/Downloads/`，方便你双击或拖入 Tampermonkey。
如需改投放目录，可先设置：

```bash
export AUTOSURE_TAMPERMONKEY_DIR="/your/path"
```

### 方式 B：手工导入

1. 打开 Tampermonkey 控制台 -> 新建脚本。  
2. 将 `autosure-capsule.user.js` 内容粘贴保存。  
3. 刷新 OpenClaw chat 页面，检查胶囊出现。

---

## Native fallback（当 Tampermonkey 不执行时）

### 安装

```bash
python3 skills/autosure/scripts/patch_control_ui.py install
```

默认目标路径：

- `~/.volta/tools/image/packages/openclaw/lib/node_modules/openclaw/dist/control-ui/index.html`

脚本会：

- 自动备份原文件为 `index.html.autosure.bak`
- 将 `ui-capsule/repair-pack/native-control-ui-capsule.js` 注入到 Control UI 页面

安装后刷新 OpenClaw `/chat` 页面，应直接出现原生 autosure 控件。

### 当前机器（mini49）补充

在当前机器上，这条路线已经验证为**优先可用本地路径**。若只是要看到并验收当前机子的新版胶囊，直接打开：

```text
http://127.0.0.1:18789/chat?session=agent%3Amain%3Amain&autosureDebug=1
```

这个参数只用于验收：会强制展开胶囊，并显示 `AUTOSURE DEBUG` / `Autosure` 文案，方便截图、OCR、肉眼确认；正常交付页不带它。

### 卸载 / 回滚

```bash
python3 skills/autosure/scripts/patch_control_ui.py uninstall
```

或直接用 `.autosure.bak` 手工回滚。

> 这条路线是**本机修复策略**，不是首选分发形态。默认还是优先 userscript。

---

## 禁用

### 方式 A：禁用已分发脚本文件

```bash
bash skills/autosure/ui-capsule/repair-pack/disable.sh
```

这会把投放到目录里的 `autosure-capsule.user.js` 重命名为 `.disabled`，避免重复误装。

### 方式 B：禁用已安装脚本

- 在 Tampermonkey 里关闭该脚本开关，或删除脚本。

> 禁用后，`/autosure` 手工命令照常可用。

---

## 升级修复（OpenClaw 升级后）

1. userscript 路线：用新版 `autosure-capsule.user.js` 覆盖旧脚本，或重新执行 `enable.sh`。  
2. native fallback 路线：若 OpenClaw Control UI 主文件更新，重跑：

```bash
python3 skills/autosure/scripts/patch_control_ui.py install
```

3. 本机验收想快速确认新版胶囊是否真的在页面里，可临时打开：

```text
http://127.0.0.1:18789/chat?session=agent%3Amain%3Amain&autosureDebug=1
```

4. 若锚点挂载失败，userscript 会降级浮层；native fallback 当前 vNext 目标是右上角紧凑降级，而非旧式右下角大面板。  
5. 查看 `CHANGELOG.md` 确认修复版本。

