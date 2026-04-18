# vendor/ — 随 skill 分发的插件源码

| 目录 | 说明 |
|------|------|
| `autosure-resume/` | **主插件**：失败续跑 + `/autosure` 多轮 + 发动词轮换 + 熔断/去重等。生产默认。 |
| `auto-resume-lite/` | **极简插件**：仅在 `agent_end` 失败时做一次系统续跑提示。**与上者互斥**。 |

安装时由 `scripts/install_bundle.py` 拷贝到 `OPENCLAW_WORKSPACE/plugins/<id>/`，勿直接在 vendor 里改生产逻辑；应改 workspace 下已安装副本或回到本仓库源再同步。
