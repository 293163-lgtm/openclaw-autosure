# Autosure for OpenClaw — Release Notes

## v2.1.0-beta.2 · 「可迁移修复包 + Native Fallback」预发布（2026-04-18）

### 本版重点

- 收编本轮真实排障结论：
  - Tampermonkey 路线并非总是可靠；在当前机器上，脚本可写入本地库，但对 `127.0.0.1:18789/chat*` **未实际执行**。
- userscript 正式清理：
  - 去掉调试期 `alert(...)` 脏探针
  - `Autosure Capsule` 升到 `1.0.2`
- 新增 **native fallback**：
  - `ui-capsule/repair-pack/native-control-ui-capsule.js`
  - `scripts/patch_control_ui.py`
  - 在 userscript 注入层失效时，可直接给本机 OpenClaw Control UI 打补丁，生成原生 autosure 控件
- 部署口径升级：
  - `DEPLOY.md`
  - `HANDOFF_FOR_AGENT.md`
  - `ENABLE_DISABLE.md`
  - `MANIFEST.json`
  全部补齐 fallback 路线说明

### 这一版的真正意义

不是再多一个“临时 workaround”，而是把这次排障结果变成**可复用、可交接、可迁移**的 skill 能力。  
换电脑时先走 userscript；若浏览器层继续发癫，直接跑 native fallback，不必重演一轮人工排障。

---

## v2.1.0-beta.1 · 「可视化胶囊 + 稳定性加固」预发布（2026-04-16）

### 本版重点

- 新增 UI 胶囊路线定稿：**A1 userscript**（不改 OpenClaw 本体）。
- 暂停语义冻结：**B1 = `/autosure stop`**。
- 文档体系升级：`PRD`、`ARCHITECTURE` 重写为 v2.1，并新增 `UI_CAPSULE_SPEC`。
- 强化“非必要增强”原则：胶囊失效不影响核心 autosure 能力。

### 兼容口径

- v2.0 的命令、插件、安装方式继续有效。
- v2.1 是增量能力，不要求立即启用胶囊。
- 升级 OpenClaw 后若胶囊失效，可先禁用胶囊继续使用核心功能，再应用修复包。

---

## v2.0.0 · 「可装、可审、可传」系统级发行（2026-04-16）

### 这一版为什么值得你看完

Autosure 不再只是「某台机器上的私货脚本集合」，而是一套**可随 OpenClaw workspace 分发**的**完整能力包**：  

- **Skill** 承载策略、发动词池、收口模板与运维文档；  
- **Vendor 插件**随包携带，**安装脚本**把 `autosure-resume` / `auto-resume-lite` 落到标准 `plugins/` 路径；  
- **互斥与降级**写进架构与安装输出，避免「双续跑」这种 silent disaster；  
- **PRD / 架构 / 发版说明**齐备，方便你丢给另一个 Agent 或客户侧技术做审计。

一句话：**从「我能用」升级到「任何人都能在同一标准上用起来」。**

---

### Highlights

| 能力 | 说明 |
|------|------|
| **Vendored `autosure-resume`** | 与 skill **同源锁定**发布；`install_bundle.py` 一键同步到 `workspace/plugins`。 |
| **内置 `auto-resume-lite`** | 全新极简失败续跑插件，**与主插件二选一**；适合「只想顶一下」的环境。 |
| **发动词 2.0** | 约 **30 条**万用推进句，短长混搭，偏精神督促与高标准，弱化「工种剧本」带偏风险。 |
| **MANIFEST.json** | 机器可读组件清单 + 角色标注（primary / optional_minimal）。 |
| **HANDOFF_FOR_AGENT.md** | 给部署 Agent 的**一页纸**，支持「把链接/压缩包扔过去」的协作模式。 |
| **文档三件套** | `docs/ARCHITECTURE.md`、`docs/PRD.md`、本 `RELEASE_NOTES.md`。 |

---

### 迁移与兼容

- 若你曾使用 **其他路径** 的 `openclaw-auto-resume-lite`，不要再把它当成另一套产品；它现在应被视为 **`auto-resume-lite` 的历史目录别名**。新版 `install_bundle.py --mode lite` 会同步刷新这个 legacy 目录，帮助老机器平滑过渡。  
- 若 `verify_health.py --mode lite` 提示 `installed plugin differs from vendored copy`，这不是误报，说明现场 legacy lite 确实已经漂了；最稳的修法就是重跑安装器，并尽快把 `plugins.load.paths` 迁回 canonical 路径 `workspace/plugins/auto-resume-lite`。  
- `openclaw.json` 的 `plugins` 结构在不同版本可能存在 `entries` / `load.paths` / `installs` 差异：**以 `install_bundle.py` 打印片段为起点，人工合并**。  
- 升级 OpenClaw 小版本后建议重跑：`config validate` → `plugins inspect` → 文档中的烟测清单。

---

### 已知边界（诚实列出来，才叫专业）

- 「打字取消空窗代发」强依赖 **`before_dispatch` + `sessionKey`**；若某通道行为有变，需回归。  
- 发动词再强也是**软约束**；长答/短答仍受模型与 Agent 默认提示影响。  
- `subagent.run` 不可用时走系统事件回退，**时间线表现**可能与主路径略有差异。

---

### 致谢与定位

本包站在 **OpenClaw 插件模型 + 会话生命周期** 之上做了一层「运维可理解、Agent 可部署」的封装。  

若本发版帮你省下了哪怕一小时的扯皮与排障，它存在的意义就达到了。

---

**下一版（v2.x）可能方向**：文档进一步瘦身、`verify_health` 增强插件路径探测、可选静态观测页（非承诺项）。
