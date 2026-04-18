// ==UserScript==
// @name         Autosure Capsule
// @namespace    autosure.openclaw
// @version      1.2.0
// @description  OpenClaw chat capsule for /autosure shortcuts (converged with native contract).
// @match        *://*/chat*
// @match        *://*/__openclaw__/*
// @grant        none
// ==/UserScript==

(function () {
  var ROOT_ID = "autosure-capsule-root";
  var STYLE_ID = "autosure-capsule-style";
  var MENU_ID = ROOT_ID + "-menu";
  var BTN_ID = ROOT_ID + "-trigger";
  var DEBUG = window.localStorage && window.localStorage.getItem("autosure.userscript.debug") === "1";
  var ENABLE_OBSERVER = window.localStorage && window.localStorage.getItem("autosure.userscript.enableObserver") === "1";
  var ENABLE_AUTO_STATUS = window.localStorage && window.localStorage.getItem("autosure.userscript.enableAutoStatus") === "1";
  var DEBUG_VISUAL = /(?:\?|&)autosureDebug=1(?:&|$)/.test(window.location.search || "");
  var mountedMode = null;
  var syncScheduled = false;
  var initialStatusSyncDone = false;
  var visibleInjectPollInFlight = false;
  var visibleInjectLastFingerprint = "";
  var visibleInjectConsumerId = "autosure-userscript-capsule";
  var surfaceFeedbackTimer = null;
  var composerRecoveryTimer = null;
  var lastComposerSeenAt = 0;
  var BOOT_RETRY_DELAYS = [0, 250, 1000, 2500];
  var COMPOSER_MISSING_UNMOUNT_GRACE_MS = 3500;
  var LOCAL_STATUS_PARSE_GRACE_MS = 2200;
  var LOCAL_PHRASE_ECHO_GRACE_MS = 2600;
  var LOCAL_COMPLETION_GRACE_MS = 4200;
  var CHAT_STATUS_MESSAGE_SCAN_LIMIT = 24;
  var CHAT_STATUS_MAX_AGE_MS = 10 * 60 * 1000;
  var COMMAND_STATUS_GUARD_MS = 20000;

  function debugLog() {
    if (!DEBUG) return;
    try {
      console.log.apply(console, ["[autosure-userscript]"].concat(Array.prototype.slice.call(arguments)));
    } catch (e) {}
  }

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem("autosure.capsule.state.v2") || "{}");
    } catch (e) {
      return {};
    }
  }

  function getStoredStatus() {
    var st = loadState();
    var status = st && st.status && typeof st.status === "object" ? st.status : null;
    if (!status) return null;
    var text = typeof status.text === "string" ? status.text.trim() : "";
    var kind = typeof status.kind === "string" ? status.kind.trim() : "";
    if (!kind && !text) return null;
    return {
      kind: kind || "pending",
      text: text || "待确认",
      at: Number(status.at || 0) || 0,
    };
  }

  function getLastCommandInfo() {
    var st = loadState();
    var lastCommand = st && st.lastCommand && typeof st.lastCommand === "object" ? st.lastCommand : null;
    if (!lastCommand) return null;
    var cmd = typeof lastCommand.cmd === "string" ? lastCommand.cmd.trim() : "";
    var at = Number(lastCommand.at || 0) || 0;
    if (!cmd || !at) return null;
    return { cmd: cmd, at: at };
  }

  function setLastCommandInfo(cmd) {
    var st = loadState();
    st.lastCommand = {
      cmd: cmd || "",
      at: Date.now(),
    };
    saveState(st);
  }

  function getRecentAutosureCommandCutoff() {
    var lastCommand = getLastCommandInfo();
    if (!lastCommand || !lastCommand.at) return 0;
    if (Date.now() - lastCommand.at > COMMAND_STATUS_GUARD_MS) return 0;
    return lastCommand.at;
  }

  function setStoredStatus(kind, text) {
    var st = loadState();
    st.status = {
      kind: kind || "pending",
      text: text || "待确认",
      at: Date.now(),
    };
    saveState(st);
  }

  function shouldRestoreStoredStatus(status) {
    if (!status) return false;
    if (!status.at) return true;
    return Date.now() - status.at < 15000;
  }

  function applyStoredStatusIfFresh(fallbackKind, fallbackText) {
    var status = getStoredStatus();
    if (shouldRestoreStoredStatus(status)) {
      updateStatus(status.kind, status.text, { persist: false });
      return true;
    }
    updateStatus(fallbackKind || "pending", fallbackText || "待确认", { persist: false });
    return false;
  }

  function shouldDelayPageStatusParsing() {
    var status = getStoredStatus();
    if (!status || !status.at) return false;
    var text = status.text || "";
    if (/\d+\/\d+\s*·\s*完成$/i.test(text)) {
      return Date.now() - status.at <= LOCAL_COMPLETION_GRACE_MS;
    }
    if (/^已发：「.+」$/i.test(text)) {
      return Date.now() - status.at <= LOCAL_PHRASE_ECHO_GRACE_MS;
    }
    if (Date.now() - status.at > LOCAL_STATUS_PARSE_GRACE_MS) return false;
    return /等待首轮注入|状态查询中|前台续跑发送中|已前台续跑|已发送停止/.test(text);
  }

  function saveState(next) {
    try {
      localStorage.setItem("autosure.capsule.state.v2", JSON.stringify(next));
    } catch (e) {}
  }

  function findTextarea() {
    return document.querySelector("textarea");
  }

  function findSendButton() {
    return (
      document.querySelector("button[aria-label='Send message']") ||
      document.querySelector("button[aria-label='Queue message']") ||
      document.querySelector("button[title='Send']") ||
      document.querySelector("button[title='Queue']")
    );
  }

  function findVisibleElement(list) {
    return (
      list.find(function (el) {
        if (!el) return false;
        var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
        var rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }) || null
    );
  }

  function findChatControls() {
    var all = Array.from(document.querySelectorAll(".chat-controls"));
    var desktopCandidates = all.filter(function (el) {
      if (el.closest(".chat-controls-dropdown")) return false;
      if (!el.querySelector(".chat-controls__separator")) return false;
      return !!(
        el.querySelector("button[title*='Refresh']") ||
        el.querySelector("button[title*='刷新']") ||
        el.querySelector("button[aria-label*='Refresh']") ||
        el.querySelector("button[aria-label*='刷新']")
      );
    });
    return findVisibleElement(desktopCandidates) || findVisibleElement(all);
  }

  function findChatControlsAnchor(container) {
    if (!container) return null;
    var refreshBtn =
      container.querySelector("button[title*='Refresh']") ||
      container.querySelector("button[title*='刷新']") ||
      container.querySelector("button[aria-label*='Refresh']") ||
      container.querySelector("button[aria-label*='刷新']");
    if (refreshBtn) return refreshBtn;
    var separator = container.querySelector(".chat-controls__separator");
    if (separator) return separator;
    return container.firstElementChild || null;
  }

  function findRefreshButton() {
    var controls = findChatControls();
    var anchor = findChatControlsAnchor(controls);
    if (anchor) return anchor;
    var direct =
      document.querySelector("button[aria-label*='Refresh']") ||
      document.querySelector("button[aria-label*='刷新']") ||
      document.querySelector("button[title*='Refresh']") ||
      document.querySelector("button[title*='刷新']");
    if (direct) return direct;
    var allButtons = Array.from(document.querySelectorAll("button"));
    return (
      allButtons.find(function (btn) {
        var txt = (btn.textContent || "").trim();
        return /refresh|刷新/i.test(txt);
      }) || null
    );
  }

  function setComposerValue(el, value) {
    try {
      var proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
      var desc = proto && Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && typeof desc.set === "function") desc.set.call(el, value);
      else el.value = value;
    } catch (e) {
      el.value = value;
    }
  }

  function sendCommand(cmd) {
    var ta = findTextarea();
    var btn = findSendButton();
    if (!ta || !btn) {
      updateStatus("error", "Composer not ready");
      return false;
    }
    ta.focus();
    setComposerValue(ta, cmd);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    btn.click();
    return true;
  }

  function getActiveSessionKey() {
    try {
      var params = new URLSearchParams(window.location.search || "");
      return (params.get("session") || "").trim();
    } catch (e) {
      return "";
    }
  }

  function getGatewayClient() {
    var app = document.querySelector("openclaw-app");
    if (app && app.client && typeof app.client.request === "function" && app.connected) return app.client;
    return null;
  }

  function requestGateway(method, params) {
    var client = getGatewayClient();
    if (!client) return Promise.reject(new Error("gateway client unavailable"));
    return client.request(method, params || {});
  }

  function sendVisiblePhrase(phrase) {
    var text = (phrase || "").trim();
    var sessionKey = getActiveSessionKey();
    if (!sessionKey || !text) return Promise.reject(new Error("session/phrase missing"));
    if (sendCommand(text)) return Promise.resolve({ ok: true, via: "composer" });
    var client = getGatewayClient();
    if (client) {
      return Promise.resolve(
        client.request("chat.send", {
          sessionKey: sessionKey,
          message: text,
          deliver: false,
          idempotencyKey: "autosure-" + Date.now() + "-" + Math.random().toString(16).slice(2, 10),
        })
      ).then(function () {
        return { ok: true, via: "chat.send" };
      });
    }
    return Promise.reject(new Error("visible send unavailable"));
  }

  function pullVisibleInject() {
    var sessionKey = getActiveSessionKey();
    if (!sessionKey || visibleInjectPollInFlight) return;
    var client = getGatewayClient();
    if (!client) return;
    visibleInjectPollInFlight = true;
    requestGateway("autosure.visibleInject.pull", {
      sessionKey: sessionKey,
      consumerId: visibleInjectConsumerId,
    })
      .then(function (res) {
        visibleInjectPollInFlight = false;
        if (!res || !res.found || !res.inject) return;
        var inject = res.inject;
        var fingerprint = (inject.fingerprint || "").trim();
        var phrase = (inject.phrase || "").trim();
        if (!fingerprint || !phrase) return;
        if (fingerprint === visibleInjectLastFingerprint) return;
        visibleInjectLastFingerprint = fingerprint;
        updateStatus("pending", "前台续跑发送中...");
        return sendVisiblePhrase(phrase)
          .then(function () {
            var completedMatch = fingerprint.match(/\|r(\d+)\|c(\d+)$/);
            var remainingBefore = completedMatch && completedMatch[1] ? Number(completedMatch[1]) : null;
            var completedBefore = completedMatch && completedMatch[2] ? Number(completedMatch[2]) : null;
            var progressText = remainingBefore !== null && completedBefore !== null ? (completedBefore + 1) + "/" + (remainingBefore + completedBefore) : "";
            updateStatus("running", formatCombinedProgress("已发", progressText, phrase), { surfaceFeedbackMs: 5600 });
            return requestGateway("autosure.visibleInject.ack", {
              sessionKey: sessionKey,
              fingerprint: fingerprint,
            });
          })
          .catch(function (error) {
            var message = error && error.message ? error.message : String(error || "unknown error");
            debugLog("pullVisibleInject:send failed", message);
            updateStatus("error", "前台续跑失败");
            return requestGateway("autosure.visibleInject.fail", {
              sessionKey: sessionKey,
              fingerprint: fingerprint,
              reason: "page-send-failed",
            }).catch(function (err) {
              debugLog("pullVisibleInject:fail ack failed", err && err.message ? err.message : String(err));
            });
          });
      })
      .catch(function (error) {
        visibleInjectPollInFlight = false;
        debugLog("pullVisibleInject:request failed", error && error.message ? error.message : String(error));
      });
  }

  function getRoot() {
    return document.getElementById(ROOT_ID);
  }

  function getMenu() {
    return document.getElementById(MENU_ID);
  }

  function getTrigger() {
    return document.getElementById(BTN_ID);
  }

  function createMenu() {
    var menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.className = "as-menu";
    menu.hidden = !DEBUG_VISUAL;
    if (DEBUG_VISUAL) menu.dataset.debugVisual = "true";
    menu.setAttribute("role", "menu");
    menu.innerHTML = [
      '  <div class="as-menu-head">',
      '    <div class="as-menu-title">Autosure</div>',
      '    <div class="as-menu-status">待确认</div>',
      "  </div>",
      '  <div class="as-grid">',
      '    <button class="as-btn" data-cmd="/autosure 3">3</button>',
      '    <button class="as-btn" data-cmd="/autosure 6">6</button>',
      '    <button class="as-btn" data-cmd="/autosure 9">9</button>',
      '    <button class="as-btn" data-cmd="/autosure">∞</button>',
      "  </div>",
      '  <div class="as-grid">',
      '    <button class="as-btn as-btn-stop" data-cmd="/autosure stop">Stop</button>',
      '    <button class="as-btn as-btn-status" data-cmd="/autosure status">Status</button>',
      "  </div>",
    ].join("");

    menu.querySelectorAll("button[data-cmd]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        capsuleAction(btn.getAttribute("data-cmd") || "");
      });
    });

    return menu;
  }

  function detectDarkTheme() {
    var html = document.documentElement;
    var body = document.body;
    var themeAttr =
      (html && (html.getAttribute("data-theme") || html.dataset.theme)) ||
      (body && (body.getAttribute("data-theme") || body.dataset.theme)) ||
      "";
    if (/dark/i.test(themeAttr)) return true;
    if (/light/i.test(themeAttr)) return false;

    var classText = [html && html.className, body && body.className].filter(Boolean).join(" ");
    if (/\bdark\b/i.test(classText)) return true;
    if (/\blight\b/i.test(classText)) return false;

    var probe = body || html;
    if (probe && window.getComputedStyle) {
      var bg = window.getComputedStyle(probe).backgroundColor || "";
      var m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (m) {
        var r = Number(m[1]) / 255;
        var g = Number(m[2]) / 255;
        var b = Number(m[3]) / 255;
        var luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (luminance <= 0.45) return true;
        if (luminance >= 0.7) return false;
      }
    }

    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function applyTheme() {
    var theme = detectDarkTheme() ? "dark" : "light";
    var root = getRoot();
    var menu = getMenu();
    if (root) root.dataset.theme = theme;
    if (menu) menu.dataset.theme = theme;
  }

  function ensureMenu() {
    var menu = getMenu();
    if (menu) {
      applyTheme();
      return menu;
    }
    if (!document.body) return null;
    menu = createMenu();
    document.body.appendChild(menu);
    applyTheme();
    return menu;
  }

  function removeMenu() {
    var menu = getMenu();
    if (menu) menu.remove();
  }

  function placeMenu() {
    var root = getRoot();
    var menu = getMenu();
    var trigger = getTrigger();
    if (!root || !menu || !trigger) return;
    if (root.dataset.expanded !== "true") return;

    menu.hidden = false;
    menu.dataset.open = "true";
    menu.style.position = "fixed";
    menu.style.display = "block";
    menu.style.left = "-9999px";
    menu.style.top = "-9999px";
    menu.style.right = "auto";
    menu.style.bottom = "auto";
    menu.style.visibility = "hidden";
    menu.style.pointerEvents = "auto";

    var rect = trigger.getBoundingClientRect();
    var viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
    var viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
    var menuRect = menu.getBoundingClientRect();
    var menuWidth = Math.max(menuRect.width || 0, DEBUG_VISUAL ? 260 : 220);
    var menuHeight = Math.max(menuRect.height || 0, 124);
    var left = rect.left;
    var top = rect.bottom + 8;

    if (left + menuWidth > viewportW - 12) left = Math.max(12, viewportW - menuWidth - 12);
    if (top + menuHeight > viewportH - 12) top = Math.max(12, rect.top - menuHeight - 8);

    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
    menu.style.visibility = "visible";
  }

  function setSurfaceFeedback(active, holdMs) {
    var root = getRoot();
    if (!root || DEBUG_VISUAL) return;
    if (surfaceFeedbackTimer) {
      clearTimeout(surfaceFeedbackTimer);
      surfaceFeedbackTimer = null;
    }
    root.dataset.surfaceFeedback = active ? "true" : "false";
    if (active) {
      surfaceFeedbackTimer = window.setTimeout(function () {
        var latestRoot = getRoot();
        if (latestRoot) latestRoot.dataset.surfaceFeedback = "false";
        surfaceFeedbackTimer = null;
      }, Math.max(Number(holdMs) || 0, 1200));
    }
  }

  function updateStatus(kind, text, options) {
    var root = getRoot();
    var menu = getMenu();
    var persist = !options || options.persist !== false;
    var holdMs = options && Number.isFinite(options.surfaceFeedbackMs) ? Number(options.surfaceFeedbackMs) : 4200;
    if (persist) setStoredStatus(kind, text);
    if (!root) return;
    root.dataset.status = kind || "pending";
    if (!options || options.surfaceFeedback !== false) {
      setSurfaceFeedback(kind !== "idle", kind === "running" ? 5200 : holdMs);
    }
    var dot = root.querySelector(".as-dot");
    if (dot) dot.dataset.kind = kind || "pending";
    var triggerLabel = root.querySelector(".as-trigger-status");
    if (triggerLabel) triggerLabel.textContent = text || "待确认";
    if (menu) {
      var label = menu.querySelector(".as-menu-status");
      if (label) label.textContent = text || "待确认";
    }
  }

  function extractTextFromMessageContent(content) {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .map(function (block) {
        if (!block) return "";
        if (typeof block === "string") return block;
        if (typeof block.text === "string") return block.text;
        if (typeof block.content === "string") return block.content;
        if (block.type === "text" && typeof block.value === "string") return block.value;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  function extractTextFromChatMessage(message) {
    if (!message || typeof message !== "object") return "";
    if (typeof message.text === "string" && message.text.trim()) return message.text;
    if (typeof message.content === "string" && message.content.trim()) return message.content;
    var contentText = extractTextFromMessageContent(message.content);
    if (contentText) return contentText;
    if (typeof message.Body === "string" && message.Body.trim()) return message.Body;
    return "";
  }

  function getChatMessageRole(message) {
    if (!message || typeof message !== "object") return "";
    return typeof message.role === "string" ? message.role.trim().toLowerCase() : "";
  }

  function isTrustedAutosureStatusMessage(message) {
    var role = getChatMessageRole(message);
    if (role && role !== "assistant") return false;
    if (typeof message.toolCallId === "string" && message.toolCallId) return false;
    if (typeof message.toolName === "string" && message.toolName) return false;
    if (typeof message.tool_name === "string" && message.tool_name) return false;
    return true;
  }

  function extractAutosureStatusSnippet(text) {
    if (!text) return "";
    var idx = text.lastIndexOf("Autosure 状态");
    if (idx < 0) return "";
    return text.slice(idx, Math.min(text.length, idx + 320));
  }

  function getLatestAutosureStatusFromChatMessages() {
    var app = getOpenClawApp();
    var messages = app && Array.isArray(app.chatMessages) ? app.chatMessages : null;
    if (!messages || !messages.length) return { available: false, snippet: "" };
    var now = Date.now();
    var minTimestamp = getRecentAutosureCommandCutoff();
    var start = Math.max(0, messages.length - CHAT_STATUS_MESSAGE_SCAN_LIMIT);
    for (var i = messages.length - 1; i >= start; i--) {
      var message = messages[i];
      if (!message || typeof message !== "object") continue;
      if (!isTrustedAutosureStatusMessage(message)) continue;
      var timestamp = Number(message.timestamp || 0) || 0;
      if (timestamp && now - timestamp > CHAT_STATUS_MAX_AGE_MS) continue;
      if (minTimestamp && timestamp && timestamp + 1 < minTimestamp) continue;
      var text = extractTextFromChatMessage(message);
      if (!/Autosure 状态/i.test(text)) continue;
      var snippet = extractAutosureStatusSnippet(text);
      if (snippet) return { available: true, snippet: snippet };
    }
    return { available: true, snippet: "" };
  }

  function formatCombinedProgress(prefix, progressText, phrase) {
    var cleanProgress = (progressText || "").trim();
    var cleanPhrase = (phrase || "").trim();
    var echoed = cleanPhrase ? (cleanPhrase.length > 10 ? cleanPhrase.slice(0, 10) + "…" : cleanPhrase) : "";
    if (cleanProgress && echoed) return cleanProgress + " · " + prefix + "「" + echoed + "」";
    if (cleanProgress) return cleanProgress + " · " + prefix.replace(/\s*「?$/, "").trim();
    return echoed ? prefix + "「" + echoed + "」" : prefix.replace(/\s*「?$/, "").trim();
  }

  function parseAndApplyStatusFromText(text) {
    if (!text) return false;
    if (!/Autosure 状态/i.test(text)) return false;
    if (/当前未在自动轮跑|状态：`?idle`?/i.test(text)) {
      updateStatus("idle", "已停止", { surfaceFeedbackMs: 2600 });
      return true;
    }
    var targetMatch = text.match(/目标轮次[：:\s`]*([^`\n]+)/i);
    var completedMatch = text.match(/已完成[：:\s`]*([0-9]+)/i);
    var remainingMatch = text.match(/剩余[：:\s`]*([0-9∞]+)/i);
    var decisionMatch = text.match(/最近决策[：:\s`]*`?([^`\n]+)/i);
    var targetRaw = targetMatch && targetMatch[1] ? String(targetMatch[1]).trim() : "";
    var completed = completedMatch && completedMatch[1] ? Number(completedMatch[1]) : null;
    var remaining = remainingMatch && remainingMatch[1] ? remainingMatch[1] : null;
    var decision = decisionMatch && decisionMatch[1] ? decisionMatch[1] : "";
    var finiteRemaining = remaining && /^\d+$/.test(remaining) ? Number(remaining) : null;
    var inferredTotal = completed !== null && finiteRemaining !== null ? completed + finiteRemaining : null;
    var targetText = inferredTotal !== null ? String(inferredTotal) : targetRaw && !/∞/.test(targetRaw) ? targetRaw.replace(/（.*?）/g, "").trim() : "";
    var progressText = completed !== null && targetText ? completed + "/" + targetText : "";

    if (/等待首轮注入|已接收启动命令/i.test(text)) {
      updateStatus("pending", progressText ? "启动中 " + progressText : "等待首轮注入");
      return true;
    }
    if ((/loop-start-|loop-idle-wait-/i.test(decision) || /状态：`?waiting_resume`?/i.test(text)) && (completed === null || completed === 0)) {
      updateStatus("pending", targetText ? "启动中 0/" + targetText : remaining ? "等待首轮注入 · 剩余 " + remaining : "等待首轮注入");
      return true;
    }
    if (completed !== null && targetText && finiteRemaining !== null) {
      if (finiteRemaining <= 0) {
        updateStatus("idle", progressText ? progressText + " · 完成" : "已完成", { surfaceFeedbackMs: 5200 });
        return true;
      }
      updateStatus("running", progressText ? progressText + " · 推进中" : "进行中", { surfaceFeedbackMs: 5200 });
      return true;
    }
    if (remaining) {
      updateStatus("running", "运行中 · 剩余 " + remaining, { surfaceFeedbackMs: 5200 });
      return true;
    }
    if (/状态：`?waiting_resume`?/i.test(text)) {
      updateStatus("pending", progressText ? progressText + " · 等待续跑" : "等待注入");
      return true;
    }
    if (/状态：`?running`?/i.test(text)) {
      updateStatus("running", progressText ? progressText + " · 推进中" : "运行中", { surfaceFeedbackMs: 5200 });
      return true;
    }
    return false;
  }

  function tryParseStatusFromPage() {
    if (shouldDelayPageStatusParsing()) return false;
    var latestChatStatus = getLatestAutosureStatusFromChatMessages();
    if (latestChatStatus.available) {
      if (latestChatStatus.snippet) return parseAndApplyStatusFromText(latestChatStatus.snippet);
      return false;
    }
    var bodyText = document.body ? document.body.innerText || "" : "";
    if (!bodyText) return false;
    var snippet = extractAutosureStatusSnippet(bodyText);
    if (!snippet) return false;
    return parseAndApplyStatusFromText(snippet);
  }

  function scheduleMenuPlacement() {
    window.requestAnimationFrame(function () {
      placeMenu();
      window.setTimeout(placeMenu, 0);
      window.setTimeout(placeMenu, 80);
      window.setTimeout(placeMenu, 220);
    });
  }

  function setExpanded(next) {
    var root = getRoot();
    var menu = ensureMenu();
    var trigger = getTrigger();
    if (!root || !menu) return;
    root.dataset.expanded = next ? "true" : "false";
    if (trigger) trigger.setAttribute("aria-expanded", next ? "true" : "false");
    menu.hidden = !next;
    menu.dataset.open = next ? "true" : "false";
    menu.style.display = next ? "block" : "none";
    menu.style.visibility = next ? "hidden" : "hidden";
    menu.style.pointerEvents = next ? "auto" : "none";
    if (next) {
      scheduleMenuPlacement();
    } else {
      menu.style.left = "-9999px";
      menu.style.top = "-9999px";
    }
    var st = loadState();
    if (!DEBUG_VISUAL) st.expanded = !!next;
    saveState(st);
  }

  function toggleExpanded() {
    var root = getRoot();
    if (!root) return;
    setExpanded(root.dataset.expanded !== "true");
  }

  function closeIfOutside(ev) {
    var root = getRoot();
    var menu = getMenu();
    if (!root) return;
    var target = ev.target;
    if (root.contains(target)) return;
    if (menu && menu.contains(target)) return;
    setExpanded(false);
  }

  function capsuleAction(cmd) {
    if (!sendCommand(cmd)) return;
    setLastCommandInfo(cmd);
    if (cmd === "/autosure stop") updateStatus("idle", "已发送停止", { surfaceFeedbackMs: 2600 });
    else if (cmd === "/autosure status") updateStatus("pending", "状态查询中...", { surfaceFeedbackMs: 2600 });
    else {
      var roundsMatch = cmd.match(/\/autosure\s+(\d+)/i);
      var targetText = roundsMatch && roundsMatch[1] ? roundsMatch[1] : "∞";
      updateStatus("pending", /^\d+$/.test(targetText) ? "启动中 0/" + targetText : "等待首轮注入", { surfaceFeedbackMs: 4200 });
    }
    setExpanded(true);
    window.setTimeout(function () {
      tryParseStatusFromPage();
    }, 700);
    window.setTimeout(function () {
      tryParseStatusFromPage();
    }, cmd === "/autosure status" ? 1200 : 1800);
    window.setTimeout(function () {
      if (!DEBUG_VISUAL) setExpanded(false);
    }, cmd === "/autosure status" ? 1600 : 2400);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#" + ROOT_ID + "{position:relative;display:inline-flex;align-items:flex-start;flex:0 0 auto;z-index:24;overflow:visible;}",
      ".chat-controls > #" + ROOT_ID + "{margin-right:2px;align-self:center;}",
      "#" + ROOT_ID + " .as-shell{position:relative;display:inline-flex;flex-direction:column;align-items:stretch;overflow:visible;}",
      "#" + ROOT_ID + " .as-trigger{appearance:none;border:none;background:transparent;color:#64748b;height:30px;width:30px;min-width:30px;padding:0;border-radius:var(--radius-sm,8px);display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;box-shadow:none;backdrop-filter:none;transition:background .15s ease,color .15s ease,border-color .15s ease,box-shadow .15s ease;}",
      "#" + ROOT_ID + "[data-theme='light'] .as-trigger{color:#64748b;}",
      "#" + ROOT_ID + "[data-theme='dark'] .as-trigger{color:var(--muted,#9ca3af);}",
      "#" + ROOT_ID + "[data-theme='light'] .as-trigger:hover{background:rgba(15,23,42,.06);color:#0f172a;}",
      "#" + ROOT_ID + "[data-theme='dark'] .as-trigger:hover{background:var(--bg-hover,rgba(255,255,255,.08));color:var(--text,#f3f4f6);}",
      "#" + ROOT_ID + " .as-trigger:focus-visible{outline:none;box-shadow:0 0 0 2px rgba(59,130,246,.18);}",
      "#" + ROOT_ID + " .as-trigger-label{display:none;font-size:12px;font-weight:700;letter-spacing:.02em;}",
      "#" + ROOT_ID + " .as-trigger-status{display:none;font-size:11px;opacity:.78;max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      "#" + ROOT_ID + "[data-surface-feedback='true'] .as-trigger{width:auto;min-width:96px;padding:0 10px;justify-content:flex-start;gap:8px;background:rgba(15,23,42,.06);color:#0f172a;}",
      "#" + ROOT_ID + "[data-theme='dark'][data-surface-feedback='true'] .as-trigger{background:rgba(255,255,255,.08);color:var(--text,#f3f4f6);}",
      "#" + ROOT_ID + "[data-surface-feedback='true'] .as-trigger-status{display:inline-flex;}",
      "#" + ROOT_ID + " .as-icon{position:relative;width:16px;height:16px;border-radius:4px;background:transparent;box-shadow:none;}",
      "#" + ROOT_ID + " .as-icon::before,#" + ROOT_ID + " .as-icon::after{content:'';position:absolute;left:50%;transform:translateX(-50%);border-radius:999px;background:currentColor;opacity:.95;}",
      "#" + ROOT_ID + " .as-icon::before{top:2px;width:10px;height:4px;}",
      "#" + ROOT_ID + " .as-icon::after{bottom:2px;width:14px;height:8px;opacity:.8;}",
      "#" + ROOT_ID + " .as-dot{position:absolute;top:-2px;right:-2px;width:7px;height:7px;border-radius:999px;border:1.5px solid #ffffff;background:#fbbf24;}",
      "#" + ROOT_ID + "[data-theme='dark'] .as-dot{border-color:var(--bg,#0b0d10);}",
      "#" + ROOT_ID + " .as-dot[data-kind='idle']{background:#94a3b8;}",
      "#" + ROOT_ID + "[data-status='idle'][data-surface-feedback='true'] .as-dot[data-kind='idle']{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.16);}",
      "#" + ROOT_ID + " .as-dot[data-kind='running']{background:#22c55e;}",
      "#" + ROOT_ID + " .as-dot[data-kind='pending']{background:#fbbf24;}",
      "#" + ROOT_ID + " .as-dot[data-kind='error']{background:#ef4444;}",
      "#" + MENU_ID + "{position:fixed;top:-9999px;left:-9999px;min-width:220px;padding:10px;border-radius:18px;border:1px solid rgba(15,23,42,.12);background:rgba(255,255,255,.96);color:#0f172a;box-shadow:0 18px 44px rgba(15,23,42,.16);backdrop-filter:blur(14px);z-index:2147483001;pointer-events:none;}",
      "#" + MENU_ID + "[data-theme='dark']{border-color:color-mix(in srgb, var(--border,#2a2d34) 88%, transparent);background:color-mix(in srgb, var(--popover,#15181d) 96%, black 4%);color:var(--text,#f3f4f6);box-shadow:0 18px 44px rgba(0,0,0,.24);}",
      "#" + MENU_ID + "[hidden]{display:none !important;}",
      "#" + MENU_ID + " .as-menu-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px;}",
      "#" + MENU_ID + " .as-menu-title{font-size:12px;font-weight:700;letter-spacing:.02em;color:inherit;}",
      "#" + MENU_ID + " .as-menu-status{font-size:11px;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;text-align:right;color:inherit;}",
      "#" + MENU_ID + " .as-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;}",
      "#" + MENU_ID + " .as-grid + .as-grid{margin-top:8px;grid-template-columns:repeat(2,minmax(0,1fr));}",
      "#" + MENU_ID + " .as-btn{appearance:none;border:1px solid rgba(15,23,42,.12);background:rgba(255,255,255,.92);color:#0f172a;border-radius:12px;height:34px;padding:0 10px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:none;}",
      "#" + MENU_ID + " .as-btn:hover{background:rgba(15,23,42,.06);}",
      "#" + MENU_ID + "[data-theme='dark'] .as-btn{border-color:rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#f8fafc;}",
      "#" + MENU_ID + "[data-theme='dark'] .as-btn:hover{background:rgba(255,255,255,.08);}",
      "#" + MENU_ID + " .as-btn-stop{border-color:rgba(239,68,68,.22);color:#991b1b;}",
      "#" + MENU_ID + "[data-theme='dark'] .as-btn-stop{border-color:rgba(248,113,113,.28);color:#fecaca;}",
      "#" + MENU_ID + " .as-btn-status{color:#0f172a;}",
      "#" + MENU_ID + "[data-theme='dark'] .as-btn-status{color:#cbd5e1;}",
      "#" + ROOT_ID + "[data-debug-visual='true'] .as-trigger{min-width:132px;width:auto;padding:0 14px;border:1px solid rgba(15,23,42,.12);background:rgba(255,255,255,.96);box-shadow:0 1px 2px rgba(15,23,42,.08);color:#0f172a;}",
      "#" + ROOT_ID + "[data-theme='dark'][data-debug-visual='true'] .as-trigger{border-color:rgba(255,255,255,.12);background:color-mix(in srgb, var(--popover,#15181d) 94%, black 6%);box-shadow:0 12px 32px rgba(0,0,0,.24);color:var(--text,#f3f4f6);}",
      "#" + ROOT_ID + "[data-debug-visual='true'] .as-trigger-label,#" + ROOT_ID + "[data-debug-visual='true'] .as-trigger-status{display:inline-flex;}",
      "#" + MENU_ID + "[data-debug-visual='true']{display:block !important;min-width:260px;}",
      "#" + ROOT_ID + "[data-debug-visual='true'][data-mode='fallback']{top:72px;right:16px;}",
      "#" + MENU_ID + "[data-debug-visual='true']::before{content:'AUTOSURE DEBUG';display:block;font-size:10px;font-weight:800;letter-spacing:.08em;color:#64748b;margin-bottom:8px;}",
      "#" + MENU_ID + "[data-theme='dark'][data-debug-visual='true']::before{color:#94a3b8;}",
      "#" + ROOT_ID + "[data-mode='fallback']{position:fixed;top:72px;right:16px;z-index:2147483000;}",
    ].join("");
    document.head.appendChild(style);
  }

  function createRoot() {
    var root = document.createElement("div");
    root.id = ROOT_ID;
    root.dataset.expanded = "false";
    root.dataset.status = "pending";
    root.dataset.surfaceFeedback = "false";
    root.dataset.theme = detectDarkTheme() ? "dark" : "light";
    if (DEBUG_VISUAL) root.dataset.debugVisual = "true";
    root.innerHTML = [
      '<div class="as-shell">',
      '  <button id="' + BTN_ID + '" class="as-trigger" type="button" aria-label="Autosure" aria-haspopup="menu" aria-expanded="' + (DEBUG_VISUAL ? "true" : "false") + '">',
      '    <span class="as-icon-wrap" style="position:relative;display:inline-flex;">',
      '      <span class="as-icon"></span>',
      '      <span class="as-dot" data-kind="pending"></span>',
      "    </span>",
      '    <span class="as-trigger-label">Autosure</span>',
      '    <span class="as-trigger-status">待确认</span>',
      "  </button>",
      "</div>",
    ].join("");

    root.querySelector(".as-trigger").addEventListener("click", function (ev) {
      ev.stopPropagation();
      toggleExpanded();
    });

    return root;
  }

  function applyInitialUiState() {
    ensureMenu();
    applyTheme();
    if (DEBUG_VISUAL) {
      updateStatus("pending", "验收模式");
      window.setTimeout(function () {
        setExpanded(true);
      }, 60);
      return;
    }
    applyStoredStatusIfFresh("pending", "待确认");
    var st = loadState();
    if (st.expanded) {
      window.setTimeout(function () {
        setExpanded(true);
      }, 60);
    }
  }

  function mountIntoToolbar(container, beforeNode) {
    var root = createRoot();
    root.dataset.mode = "toolbar";
    if (!container) return false;
    var anchor = beforeNode && beforeNode.parentElement === container ? beforeNode : findChatControlsAnchor(container);
    if (anchor) container.insertBefore(root, anchor);
    else container.insertBefore(root, container.firstChild || null);
    ensureMenu();
    applyInitialUiState();
    mountedMode = "toolbar";
    return true;
  }

  function mountFallback() {
    var root = createRoot();
    root.dataset.mode = "fallback";
    document.body.appendChild(root);
    ensureMenu();
    applyInitialUiState();
    mountedMode = "fallback";
    return true;
  }

  function removeRoot() {
    var root = getRoot();
    if (root) root.remove();
    removeMenu();
    mountedMode = null;
  }

  function scheduleComposerRecoverySync(delayMs) {
    if (composerRecoveryTimer) return;
    composerRecoveryTimer = window.setTimeout(function () {
      composerRecoveryTimer = null;
      scheduleSync();
    }, typeof delayMs === "number" ? delayMs : 600);
  }

  function syncMount() {
    if (!document.body) return;
    var hasComposer = !!findTextarea();
    var root = getRoot();
    if (hasComposer) {
      lastComposerSeenAt = Date.now();
    } else {
      if (root) {
        var sinceSeen = lastComposerSeenAt ? Date.now() - lastComposerSeenAt : 0;
        if (!lastComposerSeenAt || sinceSeen <= COMPOSER_MISSING_UNMOUNT_GRACE_MS) {
          scheduleComposerRecoverySync(700);
          return;
        }
      }
      removeRoot();
      return;
    }

    var refreshBtn = findRefreshButton();
    var controls = findChatControls();
    root = getRoot();

    if (controls && mountedMode !== "toolbar") {
      removeRoot();
      injectStyle();
      mountIntoToolbar(controls, refreshBtn);
      applyStoredStatusIfFresh("pending", DEBUG_VISUAL ? "验收模式" : "待确认");
      return;
    }

    if (!controls && !root) {
      injectStyle();
      mountFallback();
      applyStoredStatusIfFresh("pending", DEBUG_VISUAL ? "验收模式" : "待确认");
      return;
    }

    if (!controls && mountedMode !== "fallback") {
      removeRoot();
      injectStyle();
      mountFallback();
      applyStoredStatusIfFresh("pending", DEBUG_VISUAL ? "验收模式" : "待确认");
      return;
    }

    if (controls && root && mountedMode === "toolbar" && root.parentElement !== controls) {
      removeRoot();
      injectStyle();
      mountIntoToolbar(controls, refreshBtn);
      applyStoredStatusIfFresh("pending", DEBUG_VISUAL ? "验收模式" : "待确认");
      return;
    }

    if (root && getMenu() && root.dataset.expanded === "true") {
      applyTheme();
      window.requestAnimationFrame(function () {
        placeMenu();
      });
    }
  }

  function scheduleSync() {
    if (syncScheduled) return;
    syncScheduled = true;
    window.setTimeout(function () {
      syncScheduled = false;
      debugLog("scheduleSync:run");
      syncMount();
      tryParseStatusFromPage();
    }, 80);
  }

  function scheduleBootSyncs() {
    BOOT_RETRY_DELAYS.forEach(function (delay) {
      window.setTimeout(function () {
        debugLog("bootSync", delay);
        scheduleSync();
      }, delay);
    });
  }

  function scheduleInitialStatusSync() {
    if (initialStatusSyncDone || !ENABLE_AUTO_STATUS) return;
    initialStatusSyncDone = true;
    window.setTimeout(function () {
      debugLog("auto status sync");
      if (sendCommand("/autosure status")) {
        updateStatus("pending", "状态同步中...");
      }
    }, 900);
  }

  function scheduleVisibleInjectPolling() {
    window.setInterval(function () {
      pullVisibleInject();
    }, 1200);
    window.setTimeout(function () {
      pullVisibleInject();
    }, 600);
  }

  function boot() {
    injectStyle();
    applyTheme();
    scheduleBootSyncs();
    document.addEventListener("click", closeIfOutside, true);
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    if (ENABLE_OBSERVER) {
      var obs = new MutationObserver(function () {
        scheduleSync();
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      debugLog("observer:on");
    } else {
      debugLog("observer:off");
    }
    window.addEventListener("focus", scheduleSync);
    window.addEventListener("popstate", scheduleSync);
    scheduleInitialStatusSync();
    scheduleVisibleInjectPolling();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
