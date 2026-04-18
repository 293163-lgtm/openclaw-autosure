# 给部署 Agent 的一页纸(原样转发即可)

> **当前交付口径（2026-04-19 closeout）**
>
> - 产品默认路线仍是 **userscript**。
> - mini49 当前机器的本地优先可用路径仍是 **native fallback**。
> - `/autosure N` 的当前产品语义是：**首轮立即前台续跑，剩余轮次按每轮完成后继续**。
> - 本文件是部署执行入口，不负责替代 `PRD / ARCHITECTURE / UI_CAPSULE_SPEC` 成为产品权威文档。

你是部署 Agent。请在目标机完成 **Autosure for OpenClaw** 落地:

1. **放置 skill**
   将本仓库/压缩包中的 `skills/autosure` 目录,完整复制到
   `$OPENCLAW_WORKSPACE/skills/autosure`(未设置环境变量则用 `~/.openclaw/workspace/skills/autosure`)。

2. **安装 vendored 插件**
   ```bash
   python3 "$OPENCLAW_WORKSPACE/skills/autosure/scripts/install_bundle.py" --mode full
   ```
   若需 dry-run:加 `--dry-run`。若目标机在 lite 模式下沿用了历史目录 `plugins/openclaw-auto-resume-lite`,新版安装器会在 `--mode lite` 时同步刷新该 legacy 目录;长期仍建议迁到 `plugins/auto-resume-lite`。

3. **合并配置**
   将脚本输出的 JSON 片段**手工合并**进 `~/.openclaw/openclaw.json` 的 `plugins` 段:`allow` / `load.paths` **追加**而非整段覆盖;**勿**同时启用 `autosure-resume` 与 `auto-resume-lite`。

4. **校验与重启**
   ```bash
   openclaw config validate
   openclaw plugins inspect autosure-resume
   openclaw daemon restart
   ```

5. **自检**
   ```bash
   python3 "$OPENCLAW_WORKSPACE/skills/autosure/scripts/verify_health.py" --mode full
   python3 "$OPENCLAW_WORKSPACE/skills/autosure/scripts/verify_health.py" --mode lite
   python3 "$OPENCLAW_WORKSPACE/skills/autosure/scripts/repair_center.py" verify
   python3 "$OPENCLAW_WORKSPACE/skills/autosure/scripts/autosure_doctor.py" --pretty
   ```

   **状态解释警告：** 不要把 `phase` 单独当成 autosure loop 真相。对 bounded loop 请优先读取 `~/.openclaw/plugins/autosure-resume/state.json` 中的 `loopControl.active / remainingRounds / completedRounds / lastCommandRaw / inflightResume`，或直接使用 validator 输出的 `effectiveLoopState / phaseAuthoritativeForLoop / terminalTailObserved / authoritativeLoopFinished`。

人类操作入口:`小白使用说明.md`。架构/需求/发版:`docs/` 与 `RELEASE_NOTES.md`。

6. **可选 UI 胶囊（A1）**  
   将 `ui-capsule/repair-pack/autosure-capsule.user.js` 提供给浏览器 Tampermonkey 启用。  
   语义约束：胶囊“暂停”必须发送 `/autosure stop`（B1）。

7. **若 Tampermonkey 已安装但本机不执行 userscript**  
   不要继续反复手工排查浏览器注入层，先跑：

   ```bash
   python3 "$OPENCLAW_WORKSPACE/skills/autosure/scripts/repair_center.py" verify
   ```

   先看：
   - `statusSummary`
   - `recommendedAction`
   - `recommendedCarrier`

   若 `recommendedAction` 返回 `restore-native-patch` 或 `recommendedCarrier` 返回 `native-fallback`，再直接启用 native fallback：

   ```bash
   python3 "$OPENCLAW_WORKSPACE/skills/autosure/scripts/repair_center.py" native-install
   # 或
   python3 "$OPENCLAW_WORKSPACE/skills/autosure/scripts/patch_control_ui.py" reinstall
   ```

   默认修补本机 OpenClaw Control UI：

   - `~/.volta/tools/image/packages/openclaw/lib/node_modules/openclaw/dist/control-ui/index.html`

   脚本会先备份原文件，再注入 autosure 原生控件。卸载：

   ```bash
   python3 "$OPENCLAW_WORKSPACE/skills/autosure/scripts/patch_control_ui.py" uninstall
   ```

8. **当前机器（mini49）补充**  
   在这台机器上，Tampermonkey 对 `http://127.0.0.1:18789/chat*` 的执行已验证不可靠，因此 **native fallback 是本机优先可用路径**。  
   现场验收页：

   ```text
   http://127.0.0.1:18789/chat?session=agent%3Amain%3Amain&autosureDebug=1
   ```

   该参数仅用于验收：页面会显示 `AUTOSURE DEBUG` 并强制展开胶囊，便于截图 / OCR / 肉眼确认；正常交付页不带该参数。

10. **桌面点击反馈补丁（2026-04-18 晚间）**
   - 若用户反馈“桌面 UI 点了像没反应”，先不要马上怀疑 autosure 内核。先区分两层：
     1. loop 是否真的在推进（看 `state.json` / validator / 当前会话是否出现真实发动词）
     2. 当前页面是否吃到了**即时反馈补丁**。
   - 这轮已把 native/userscript 胶囊统一改成：
     - `/autosure N` 点击后立即显示 `等待首轮注入...`
     - 暂时保持展开态，而不是立刻收菜单
     - 700ms 提前做一次页面状态回读
     - 非 debug 模式下再延后自动收起（start 约 2400ms）
   - 后续又补了四条更阴的现场问题：
     1. 若页面发生 `syncMount()` / toolbar remount，胶囊以前会把刚写出的即时状态重新刷回 `待确认`
     2. 若页面历史消息区里还挂着旧的 `Autosure 状态` 文本，`tryParseStatusFromPage()` 也可能把本地刚写出的新状态反向覆盖掉
     3. 更底层地说，旧实现把 `document.body.innerText` 当主状态源，本身就会把整页历史文本误当当前状态
     4. 更产品层地说，旧 `/autosure N` 语义只是“启动后续轮次调度”，并不会在点击后立即发起首轮前台续跑，所以用户会感觉像点了个排队命令
   - 现在口径已经进一步改到：
     - `/autosure N` 启动时即 arm 首轮前台续跑
     - 剩余轮次再按每轮完成后继续
   - 现在两份胶囊都已加入：
     - 短时状态持久化：
       - `getStoredStatus()`
       - `setStoredStatus()`
       - `applyStoredStatusIfFresh()`
     - 页面状态回读避让：
       - `LOCAL_STATUS_PARSE_GRACE_MS`
       - `shouldDelayPageStatusParsing()`
     - 当前会话消息优先解析：
       - `CHAT_STATUS_MESSAGE_SCAN_LIMIT`
       - `CHAT_STATUS_MAX_AGE_MS`
       - `extractTextFromChatMessage()`
       - `getLatestAutosureStatusFromChatMessages()`
       - `getChatMessageRole()`
       - `isTrustedAutosureStatusMessage()`
       - 宿主消息数组可用时，**不再回退整页 `body.innerText`**
     - 本地命令时间门：
       - `COMMAND_STATUS_GUARD_MS`
       - `getLastCommandInfo()`
       - `setLastCommandInfo()`
       - `getRecentAutosureCommandCutoff()`
   - 新口径：
     - 最近 15 秒内的有效状态（如 `等待首轮注入...` / `状态查询中...` / `已前台续跑`）在重挂载后应优先恢复，而不是被默认值覆盖
     - 本地新状态写出后的约 2200ms 内，应暂缓页面历史状态解析，避免旧 `Autosure 状态` 文本反向覆盖当前反馈
     - 页面状态主判据现已切到当前会话 `chatMessages` 最近消息，并进一步收紧为 **assistant 非工具噪音消息优先**
     - 只有在宿主消息数组根本不可用时，才允许退回整页 `body.innerText` 兜底
     - 即便 assistant 消息看起来可信，也必须晚于最近一次本地 `/autosure*` 指令，旧 assistant 状态不能跨轮回写当前胶囊
     - `/autosure N` 的产品语义已改为：**首轮立即前台续跑，剩余轮次按每轮完成后继续**
   - 部署/修复时请直接验证 installed dist 是否含以下信号，而不要只看 workspace 源码：
     - `等待首轮注入...`
     - `setExpanded(true)`
     - `2400`
     - `getStoredStatus`
     - `applyStoredStatusIfFresh`
     - `LOCAL_STATUS_PARSE_GRACE_MS`
     - `shouldDelayPageStatusParsing`
     - `CHAT_STATUS_MESSAGE_SCAN_LIMIT`
     - `CHAT_STATUS_MAX_AGE_MS`
     - `getLatestAutosureStatusFromChatMessages`
     - `getChatMessageRole`
     - `isTrustedAutosureStatusMessage`
     - `if (latestChatStatus.available)`
     - `COMMAND_STATUS_GUARD_MS`
     - `getRecentAutosureCommandCutoff`
   - 插件侧再额外验证：
     - `armLoopVisibleInject`
     - `loop_start_immediate`
     - `loop-start-immediate-inject`
     - `首轮前台注入已启动`
   - 若 installed dist 没吃到这些字符串，优先执行：
     ```bash
     python3 "$OPENCLAW_WORKSPACE/skills/autosure/scripts/patch_control_ui.py" reinstall
     ```
   - 若插件 vendor 副本没吃到启动语义修正，需同步：
     ```bash
     cp "$OPENCLAW_WORKSPACE/plugins/autosure-resume/index.js" "$OPENCLAW_WORKSPACE/skills/autosure/vendor/autosure-resume/index.js"
     ```
   - 诚实口径：这补的是**桌面即时反馈 / 状态判据层 + `/autosure N` 首轮启动语义**，不是 autosure loop 失败恢复内核；若 loop phrase 已实际进入当前会话，则“没反应”更可能是页面反馈落后、重挂载抹状态、旧状态回读反向覆盖、整页文本误判、非 assistant/tool 噪音消息被误读，或首轮前台 arm 已成立但页面仍未及时呈现，而不是命令未生效。
