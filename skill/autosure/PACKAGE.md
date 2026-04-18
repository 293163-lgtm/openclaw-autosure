# 如何打成可交付压缩包

本文件只负责**打包动作**。安装与迁移规则看 `DEPLOY.md`，产品/运行真相看 `SKILL.md`、`docs/ARCHITECTURE.md`、`docs/PRD.md`。

在 **skill 根目录**（含 `SKILL.md`、`vendor/`、`scripts/` 的 `autosure` 文件夹）上级执行：

```bash
cd ~/.openclaw/workspace/skills
zip -r autosure-openclaw-pack-v2.zip autosure \
  -x "autosure/**/__pycache__/*" -x "autosure/**/*.pyc"
```

将 `autosure-openclaw-pack-v2.zip` 或整个 `autosure` 目录链接发给客户 / 部署 Agent 即可；落地步骤见 **`DEPLOY.md`** 与 **`HANDOFF_FOR_AGENT.md`**。

若需 UI 胶囊，请同时分发 `ui-capsule/repair-pack/`（已包含在 zip 内）。

**发版前建议**：

1. 若你本地主插件在 `workspace/plugins/autosure-resume` 有改动，先运行  
   `bash skills/autosure/scripts/sync_vendor_from_workspace.sh`  
   再打包，保证 **vendor 与线上一致**。  
2. 若目标机存在历史 lite 目录 `workspace/plugins/openclaw-auto-resume-lite`，在交付说明里明确：它只是 legacy 别名，不是第二套插件；优先建议对方后续迁回 canonical 目录 `workspace/plugins/auto-resume-lite`。
