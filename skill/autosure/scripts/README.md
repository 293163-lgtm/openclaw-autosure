# autosure / scripts

| 脚本 | 用途 |
|------|------|
| `init_run.py` | 初始化运行卡片（项目收口用） |
| `verify_health.py` | 检查 `openclaw` CLI、`autosure-resume` 已加载、配置片段、`发动词.txt`、**vendor 包内主插件文件**是否存在 |
| `repair_center.py` | 统一 doctor / repair 入口：检测 native patch、userscript carrier、staged userscript，并支持 native install/uninstall/rollback、open acceptance URL；其中 `native-install` 现默认走 **幂等刷新语义**（内部调用 `patch_control_ui.py reinstall`），避免 marker 已存在但 dist 仍吃旧 capsule |
| `autosure_doctor.py` | Track C 统一 harness：聚合 core health、ui carrier、runtime state、ui contract，输出 `summary`、`recommendedNextAction`、`statusClass`、`severity`，并支持 `--json-only / --pretty` |
| `autosure_validate_runtime.py` | 独立测试会话的 runtime validator：读取 autosure state，输出 session snapshot / diff，用于记录 loop/phase/stop 前后变化 |
| `autosure_validate_session.py` | 独立测试会话验证助手：prepare/finalize 两阶段串联 doctor + runtime snapshot/diff，并生成 artifacts 目录与行为检查清单 |
| `install_bundle.py` | 将 `vendor/autosure-resume` 或 `vendor/auto-resume-lite` 安装到 `OPENCLAW_WORKSPACE/plugins/`，并打印需合并的 `plugins` JSON |
| `sync_vendor_from_workspace.sh` | 在 **skill 根目录**执行：`bash scripts/sync_vendor_from_workspace.sh`，从 `workspace/plugins/autosure-resume` 回刷 `vendor/autosure-resume` |

## 示例

```bash
python3 install_bundle.py --mode full --dry-run
python3 install_bundle.py --mode lite
```

`--mode lite` 仅安装极简 `auto-resume-lite`（请确保配置中关闭 `autosure-resume`）。
