import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PHASE = {
  IDLE: "idle",
  RUNNING: "running",
  WAITING: "waiting_resume",
  RECENT: "resumed_recently",
  OPEN: "open_circuit",
  HALF_OPEN: "half_open",
};

const DEFAULT_CONTINUE_PHRASES = ["继续", "按你的想法继续"];
const FRONTSTAGE_BRIDGE_FALLBACK_MS = 12000;

/** 续轮注入时附加说明：抵消「发动词很短」带来的缩答倾向（勿与 /autosure-demo 的短答演示混淆） */
const LOOP_CONTINUATION_SYSTEM_HINT =
  "这是会话时间线里自动代发的一条续轮发动词；无论气泡里字数多少，语义都是「按当前任务继续往下做完整一轮」。请你像处理普通、完整的用户任务那样推进：该调查就调查、该写长文就写长文、该调用工具就调用工具；输出篇幅与细节应与任务需要匹配，不要仅因上一条用户文字很短就把本轮收成摘要或一两句敷衍。";

const DEFAULTS = {
  enabled: true,
  maxAutoResumes: 1,
  cooldownMs: 15000,
  minCooldownMs: 5000,
  maxCooldownMs: 120000,
  compressionWaitMs: 60000,
  circuitThreshold: 3,
  circuitOpenMs: 120000,
  halfOpenProbeMax: 1,
  dedupeTtlMs: 120000,
  enableNonActionResume: false,
  commandMaxRounds: 1_000_000,
  demoInjectRounds: 2,
  /** 每轮助手结束后，等待用户输入的最长时间（毫秒）；超时且无人输入才代发「继续」 */
  loopIdleGraceMs: 15000,
};

const INTENT_PATTERNS = [
  /\blet me\b/i,
  /\bi will\b/i,
  /\bi'll\b/i,
  /\bcontinue\b/i,
  /\bnext step\b/i,
  /\buse\s+(the\s+)?exec\b/i,
  /让我/i,
  /我来/i,
  /我先/i,
  /继续/i,
  /接下来/i,
  /然后我/i,
];

const COMPRESSION_PATTERNS = [
  /context overflow/i,
  /context.*exceeds/i,
  /compression/i,
  /compact/i,
  /token.*limit/i,
];

const SAVE_QUEUES = new Map();
/** @type {Map<string, number>} sessionKey -> last /autosure-demo at ms */
const DEMO_LAST_BY_SESSION = new Map();
/** @type {Map<string, ReturnType<typeof setTimeout>>} sessionKey -> pending loop idle inject timer */
const LOOP_IDLE_TIMERS = new Map();
/** @type {Map<string, ReturnType<typeof setTimeout>>} sessionKey -> pending frontstage bridge fallback timer */
const VISIBLE_INJECT_FALLBACK_TIMERS = new Map();
/** @type {Map<string, string>} conversationKey(channel/account/conversation) -> latest sessionKey */
const CONVERSATION_TO_SESSION = new Map();

function makeConversationKey(channelId, accountId, conversationId) {
  const ch = (channelId || "").trim();
  const acc = (accountId || "").trim();
  const conv = (conversationId || "").trim();
  if (!ch || !conv) return "";
  return `${ch}::${acc}::${conv}`;
}

function bindConversationToSession({ channelId, accountId, conversationId, sessionKey }) {
  const sk = (sessionKey || "").trim();
  if (!sk) return;
  const key = makeConversationKey(channelId, accountId, conversationId);
  if (!key) return;
  CONVERSATION_TO_SESSION.set(key, sk);
}

function resolveSessionFromConversation({ channelId, accountId, conversationId }) {
  const key = makeConversationKey(channelId, accountId, conversationId);
  if (!key) return "";
  return (CONVERSATION_TO_SESSION.get(key) || "").trim();
}

function cancelLoopIdleInjectTimer(sessionKey) {
  const key = (sessionKey || "").trim();
  if (!key) return;
  const t = LOOP_IDLE_TIMERS.get(key);
  if (t) {
    clearTimeout(t);
    LOOP_IDLE_TIMERS.delete(key);
  }
}

function cancelVisibleInjectFallbackTimer(sessionKey) {
  const key = (sessionKey || "").trim();
  if (!key) return;
  const t = VISIBLE_INJECT_FALLBACK_TIMERS.get(key);
  if (t) {
    clearTimeout(t);
    VISIBLE_INJECT_FALLBACK_TIMERS.delete(key);
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nowMs() {
  return Date.now();
}

function getPluginConfig(api) {
  const raw = isObject(api.pluginConfig) ? api.pluginConfig : {};
  const pickInt = (key, fallback, min = null, max = null) => {
    const v = Number.isInteger(raw[key]) ? raw[key] : fallback;
    if (min !== null && v < min) return min;
    if (max !== null && v > max) return max;
    return v;
  };

  return {
    enabled: raw.enabled !== false,
    maxAutoResumes: pickInt("maxAutoResumes", DEFAULTS.maxAutoResumes, 1, 10),
    cooldownMs: pickInt("cooldownMs", DEFAULTS.cooldownMs, 0, 600000),
    minCooldownMs: pickInt("minCooldownMs", DEFAULTS.minCooldownMs, 0, 600000),
    maxCooldownMs: pickInt("maxCooldownMs", DEFAULTS.maxCooldownMs, 1000, 1800000),
    compressionWaitMs: pickInt("compressionWaitMs", DEFAULTS.compressionWaitMs, 0, 1800000),
    circuitThreshold: pickInt("circuitThreshold", DEFAULTS.circuitThreshold, 1, 20),
    circuitOpenMs: pickInt("circuitOpenMs", DEFAULTS.circuitOpenMs, 1000, 7200000),
    halfOpenProbeMax: pickInt("halfOpenProbeMax", DEFAULTS.halfOpenProbeMax, 1, 5),
    dedupeTtlMs: pickInt("dedupeTtlMs", DEFAULTS.dedupeTtlMs, 1000, 1800000),
    enableNonActionResume: raw.enableNonActionResume === true,
    commandMaxRounds: pickInt("commandMaxRounds", DEFAULTS.commandMaxRounds, 1, 10_000_000),
    demoInjectRounds: pickInt("demoInjectRounds", DEFAULTS.demoInjectRounds, 1, 5),
    loopIdleGraceMs: pickInt("loopIdleGraceMs", DEFAULTS.loopIdleGraceMs, 1000, 300000),
  };
}

function getStateFile(api) {
  const stateDir = api.runtime.state.resolveStateDir(process.env, os.homedir());
  return path.join(stateDir, "plugins", api.id, "state.json");
}

async function loadState(api) {
  const file = getStateFile(api);
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf-8"));
    return {
      sessions: isObject(parsed.sessions) ? parsed.sessions : {},
      runs: isObject(parsed.runs) ? parsed.runs : {},
    };
  } catch {
    return { sessions: {}, runs: {} };
  }
}

async function saveState(api, state) {
  const file = getStateFile(api);
  const prior = SAVE_QUEUES.get(file) || Promise.resolve();
  const next = prior
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(state, null, 2), "utf-8");
    });
  SAVE_QUEUES.set(file, next);
  await next;
}

function getRunState(state, runId) {
  if (!runId) return null;
  if (isObject(state.runs[runId])) return state.runs[runId];
  const created = {
    assistantTexts: [],
    toolCalls: 0,
    successfulToolCalls: 0,
    toolErrors: 0,
    lastToolError: "",
    detectedIntent: false,
    sessionKey: "",
    agentId: "",
    sessionId: "",
    updatedAt: nowMs(),
  };
  state.runs[runId] = created;
  return created;
}

function getSessionState(state, sessionKey) {
  if (!sessionKey) return null;
  if (!isObject(state.sessions[sessionKey])) {
    state.sessions[sessionKey] = {
      phase: PHASE.IDLE,
      failureStreak: 0,
      consecutiveAutoResumes: 0,
      inflightResume: false,
      recentFingerprints: [],
      halfOpenProbeCount: 0,
      pendingVisibleInject: null,
      armedVisibleInject: null,
      loopControl: {
        active: false,
        unlimited: false,
        targetRounds: 0,
        remainingRounds: 0,
        completedRounds: 0,
        startedAt: 0,
      },
      updatedAt: nowMs(),
    };
  }
  state.sessions[sessionKey].sessionKey = sessionKey;
  return state.sessions[sessionKey];
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clearVisibleInject(session) {
  session.pendingVisibleInject = null;
  session.armedVisibleInject = null;
}

function matchesArmedVisibleInject(session, text) {
  const armed = isObject(session?.armedVisibleInject) ? session.armedVisibleInject : null;
  const body = normalizeText(text);
  if (!armed || !body) return false;
  if (normalizeText(armed.phrase) !== body) return false;
  const armedAt = Number(armed.armedAt || 0);
  return Number.isFinite(armedAt) && nowMs() - armedAt <= 30000;
}

function getPromptText(event) {
  if (!event || typeof event !== "object") return "";
  const direct = [
    event.finalPromptText,
    event.prompt,
    event.userText,
    event.input,
    event.message,
    event.text,
  ].find((v) => typeof v === "string" && v.trim());
  if (direct) return direct.trim();
  if (Array.isArray(event.messages)) {
    for (let i = event.messages.length - 1; i >= 0; i -= 1) {
      const item = event.messages[i];
      if (item?.role === "user" && typeof item?.content === "string" && item.content.trim()) {
        return item.content.trim();
      }
    }
  }
  return "";
}

function parseAutosureCommand(text, maxRounds) {
  const prompt = (text || "").trim();
  if (!prompt) return null;
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (/(?:^|\s)\/autosure\s+stop(?:[。.,!?\s]|$)/i.test(normalized)) return { type: "stop" };
  if (/(?:^|\s)\/autosure\s+status(?:[。.,!?\s]|$)/i.test(normalized)) return { type: "status" };
  let start = normalized.match(/(?:^|\s)\/autosure\s+(\d{1,7})(?:[。.,!?\s]|$)/i);
  if (!start) start = normalized.match(/(?:^|\s)\/autosure(\d{1,7})(?:[。.,!?\s]|$)/i);
  if (start) {
    const rounds = Math.max(1, Math.min(Number(start[1]), maxRounds));
    return { type: "start", rounds, unlimited: false };
  }
  // 仅「/autosure」无数字：不限轮次，直到 /autosure stop 或你手动发话清循环
  if (/(?:^|\s)\/autosure(?:\s*[。.,!?]*)$/i.test(normalized)) {
    return { type: "start", rounds: 0, unlimited: true };
  }
  return null;
}

async function detectAutosureCommandFromSessionFile(ctx, runState, maxRounds) {
  const sessionId = (ctx?.sessionId || runState?.sessionId || "").trim();
  if (!sessionId) return null;
  const file = path.join(os.homedir(), ".openclaw", "agents", "main", "sessions", `${sessionId}.jsonl`);
  try {
    const raw = await fs.readFile(file, "utf-8");
    const lines = raw.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i]?.trim();
      if (!line) continue;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      if (evt?.type !== "message") continue;
      const msg = evt?.message;
      if (msg?.role !== "user") continue;
      const chunks = Array.isArray(msg?.content) ? msg.content : [];
      const text = chunks
        .filter((item) => item?.type === "text" && typeof item?.text === "string")
        .map((item) => item.text)
        .join("\n")
        .trim();
      if (!text) continue;
      return parseAutosureCommand(text, maxRounds);
    }
    return null;
  } catch {
    return null;
  }
}

function summarizeError(error) {
  if (typeof error !== "string") return "";
  return error.trim().replace(/\s+/g, " ").slice(0, 280);
}

function detectIntent(texts) {
  return texts.some((t) => INTENT_PATTERNS.some((p) => p.test(t)));
}

function isCompressionSignal(text) {
  return COMPRESSION_PATTERNS.some((p) => p.test(text || ""));
}

function makeFingerprint(params) {
  const toolStats = `${params.toolCalls || 0}:${params.toolErrors || 0}:${params.successfulToolCalls || 0}`;
  const normalizedError = (params.error || "").toLowerCase().slice(0, 140);
  return `${params.runId || "no-run"}|${params.reason}|${normalizedError}|${toolStats}`;
}

function pruneFingerprintWindow(session, ttlMs) {
  const cutoff = nowMs() - ttlMs;
  session.recentFingerprints = (Array.isArray(session.recentFingerprints) ? session.recentFingerprints : []).filter(
    (item) => item && Number.isFinite(item.ts) && item.ts >= cutoff
  );
}

function computeEffectiveCooldown(cfg, reason, session) {
  let waitMs = cfg.cooldownMs;
  if (reason === "compression") {
    waitMs = Math.max(waitMs, cfg.compressionWaitMs);
  }
  const streakFactor = Math.min(Number(session.failureStreak || 0), 3);
  waitMs = waitMs * (1 + streakFactor * 0.5);
  waitMs = Math.max(waitMs, cfg.minCooldownMs);
  waitMs = Math.min(waitMs, cfg.maxCooldownMs);
  return Math.floor(waitMs);
}

function clearStaleInflight(session, cfg) {
  if (!session?.inflightResume) return false;
  const lastResumeAt = Number.isFinite(session.lastResumeAt) ? session.lastResumeAt : 0;
  if (!lastResumeAt) return false;
  const staleMs = Math.max(cfg.cooldownMs * 3, 60000);
  if (nowMs() - lastResumeAt < staleMs) return false;
  session.inflightResume = false;
  session.phase = PHASE.RUNNING;
  session.lastDecision = "stale-inflight-cleared";
  return true;
}

function buildResumeInstruction(reason, details) {
  const base =
    "Previous run stopped before completing the task. Continue from last valid disk state. Execute one concrete step first, then proceed.";
  if (reason === "compression") {
    return `${base} Context pressure/compression was detected${details ? `: ${details}.` : "."} Resume with minimal context usage.`;
  }
  if (reason === "timeout") {
    return `${base} The previous run timed out${details ? `: ${details}.` : "."} Resume from the unfinished step.`;
  }
  if (reason === "tool_error") {
    return `${base} The last tool call failed${details ? `: ${details}.` : "."} Repair or bypass and continue.`;
  }
  if (reason === "non_action") {
    return `${base} The previous run ended after intent text without action. Do one concrete step now.`;
  }
  if (reason === "agent_error") {
    return `${base} The previous run ended with an error${details ? `: ${details}.` : "."} Recover and continue.`;
  }
  return base;
}

function resolveContinuePhrasesFileCandidates() {
  const fromEnv = (process.env.OPENCLAW_WORKSPACE || "").trim();
  const dirs = [];
  if (fromEnv) dirs.push(path.join(fromEnv, "skills", "autosure"));
  dirs.push(path.join(os.homedir(), ".openclaw", "workspace", "skills", "autosure"));
  return dirs.map((dir) => path.join(dir, "发动词.txt"));
}

async function loadContinuePhrases() {
  for (const file of resolveContinuePhrasesFileCandidates()) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
      if (lines.length > 0) return { phrases: lines, sourcePath: file };
    } catch {
      // try next candidate
    }
  }
  return { phrases: DEFAULT_CONTINUE_PHRASES, sourcePath: null };
}

function pickRotatedPhrase(phrases, roundIndex) {
  const list = Array.isArray(phrases) && phrases.length > 0 ? phrases : DEFAULT_CONTINUE_PHRASES;
  const idx = Math.max(0, Math.floor(Number(roundIndex) || 0)) % list.length;
  return list[idx];
}

async function armLoopVisibleInject(api, state, sessionKey, cfg, options = {}) {
  const sk = normalizeText(sessionKey);
  if (!cfg?.enabled || !sk) return false;

  const session = getSessionState(state, sk);
  if (!session) return false;
  const loop = session.loopControl;
  const loopUnlimited = loop?.unlimited === true;
  if (!isObject(loop) || !loop.active || (!loopUnlimited && Number(loop.remainingRounds || 0) <= 0)) return false;
  if (session.phase === PHASE.OPEN) return false;
  if (session.inflightResume) return false;

  clearStaleInflight(session, cfg);
  maybeTransitionCircuit(session, cfg);
  if (session.phase === PHASE.OPEN) return false;

  const dispatchKind = normalizeText(options.dispatchKind) || "loop_idle";
  const fingerprint = `${sk}|${dispatchKind}|r${loop.remainingRounds}|c${loop.completedRounds}`;
  pruneFingerprintWindow(session, cfg.dedupeTtlMs);
  if (session.recentFingerprints.some((item) => item.fp === fingerprint)) return false;

  const { phrases, sourcePath } = await loadContinuePhrases();
  const roundIndex = Number(loop.completedRounds || 0);
  const phrase = pickRotatedPhrase(phrases, roundIndex).trim();
  if (!phrase) return false;

  if (loop.unlimited !== true) {
    loop.remainingRounds = Math.max(Number(loop.remainingRounds || 0) - 1, 0);
    if (loop.remainingRounds <= 0) loop.active = false;
  }
  loop.completedRounds = Number(loop.completedRounds || 0) + 1;

  const now = nowMs();
  session.phase = PHASE.WAITING;
  session.inflightResume = true;
  session.lastResumeAt = now;
  session.lastResumeReason = dispatchKind === "loop_start_immediate" ? "loop_start_immediate" : "loop_round";
  session.lastResumeSignature = fingerprint;
  session.lastEventFingerprint = fingerprint;
  session.effectiveCooldownMs = Number.isFinite(options.effectiveCooldownMs)
    ? Number(options.effectiveCooldownMs)
    : dispatchKind === "loop_start_immediate"
      ? 0
      : cfg.loopIdleGraceMs;
  session.recentFingerprints.push({ fp: fingerprint, ts: now });
  session.pendingVisibleInject = {
    id: randomUUID(),
    phrase,
    fingerprint,
    createdAt: now,
    sourcePath: sourcePath || "",
    dispatchKind,
  };
  session.armedVisibleInject = null;
  session.updatedAt = now;
  session.lastDecision = normalizeText(options.decision) || (dispatchKind === "loop_start_immediate" ? "loop-start-immediate-inject" : "loop-idle-inject");
  await saveState(api, state);
  scheduleVisibleInjectFallback(api, sk, fingerprint);

  api.logger.info(`autosure loop inject armed for ${sk}`, {
    remainingRounds: loop.remainingRounds,
    completedRounds: loop.completedRounds,
    phrasePreview: phrase.slice(0, 40),
    phrasesSource: sourcePath || "built-in-default",
    transport: dispatchKind === "loop_start_immediate" ? "frontstage-immediate-pending" : "frontstage-pending",
    dispatchKind,
  });
  return true;
}

async function dispatchLoopContinuationFallback(api, params) {
  const sessionKey = normalizeText(params?.sessionKey);
  const phrase = normalizeText(params?.phrase);
  if (!sessionKey || !phrase) return false;

  const subagent = api.runtime?.subagent;
  const fallbackInstruction = `Autosure 续轮：时间线里已出现一条用户发动词（与「继续」同义）。请按你平时对用户正常指令的标准接着完成任务——该用工具就用、该写长文就写；不要为「发动词短」而刻意缩答。`;
  const loop = isObject(params?.loop) ? params.loop : {};
  const logBase = {
    remainingRounds: Number(loop.remainingRounds || 0),
    completedRounds: Number(loop.completedRounds || 0),
    phrasePreview: phrase.slice(0, 40),
    phrasesSource: params?.sourcePath || "built-in-default",
    degradedFrom: normalizeText(params?.degradedFrom) || "frontstage-bridge",
  };

  if (subagent && typeof subagent.run === "function") {
    try {
      await subagent.run({
        sessionKey,
        message: phrase,
        deliver: false,
        idempotencyKey: `autosure-loop:${sessionKey}:${randomUUID()}`,
        extraSystemPrompt: LOOP_CONTINUATION_SYSTEM_HINT,
      });
      api.logger.info(`autosure loop idle inject for ${sessionKey}`, {
        ...logBase,
        transport: "subagent.run",
      });
      return true;
    } catch (err) {
      api.logger.warn("autosure loop subagent.run failed; falling back to system event + heartbeat", {
        sessionKey,
        err: String(err),
      });
    }
  }

  try {
    api.runtime.system.enqueueSystemEvent(fallbackInstruction, {
      sessionKey,
      contextKey: `autosure-loop:${normalizeText(params?.fingerprint) || randomUUID()}`,
    });
    api.runtime.system.requestHeartbeatNow({
      reason: "autosure-resume:loop-fallback",
      agentId: undefined,
      sessionKey,
      coalesceMs: 2000,
    });
    api.logger.info(`autosure loop idle inject for ${sessionKey}`, {
      ...logBase,
      transport: "system-event",
    });
    return true;
  } catch (err) {
    api.logger.warn("autosure loop fallback scheduling failed", { sessionKey, err: String(err) });
  }

  return false;
}

async function consumeVisibleInjectFallback(api, sessionKey, fingerprint, reason) {
  const sk = normalizeText(sessionKey);
  const fp = normalizeText(fingerprint);
  if (!sk || !fp) return false;
  cancelVisibleInjectFallbackTimer(sk);

  const state = await loadState(api);
  const session = getSessionState(state, sk);
  if (!session) return false;

  const pending = isObject(session.pendingVisibleInject) && normalizeText(session.pendingVisibleInject.fingerprint) === fp
    ? session.pendingVisibleInject
    : null;
  const armed = !pending && isObject(session.armedVisibleInject) && normalizeText(session.armedVisibleInject.fingerprint) === fp
    ? session.armedVisibleInject
    : null;
  const inject = pending || armed;
  if (!inject) return false;

  const phrase = normalizeText(inject.phrase);
  clearVisibleInject(session);
  session.lastDecision = `loop-visible-fallback-${normalizeText(reason) || "timeout"}`;
  session.updatedAt = nowMs();
  await saveState(api, state);

  if (!phrase) {
    const recoveryState = await loadState(api);
    const recoverySession = getSessionState(recoveryState, sk);
    if (recoverySession) {
      recoverySession.inflightResume = false;
      recoverySession.phase = recoverySession.loopControl?.active ? PHASE.RUNNING : PHASE.IDLE;
      recoverySession.lastDecision = "loop-visible-fallback-empty";
      recoverySession.updatedAt = nowMs();
      await saveState(api, recoveryState);
    }
    return false;
  }

  const ok = await dispatchLoopContinuationFallback(api, {
    sessionKey: sk,
    phrase,
    fingerprint: fp,
    sourcePath: normalizeText(inject.sourcePath),
    degradedFrom: reason,
    loop: session.loopControl,
  });
  if (ok) return true;

  const recoveryState = await loadState(api);
  const recoverySession = getSessionState(recoveryState, sk);
  if (recoverySession) {
    recoverySession.inflightResume = false;
    recoverySession.phase = recoverySession.loopControl?.active ? PHASE.RUNNING : PHASE.IDLE;
    recoverySession.lastDecision = "loop-idle-schedule-failed";
    recoverySession.updatedAt = nowMs();
    await saveState(api, recoveryState);
  }
  return false;
}

function scheduleVisibleInjectFallback(api, sessionKey, fingerprint) {
  const sk = normalizeText(sessionKey);
  const fp = normalizeText(fingerprint);
  if (!sk || !fp) return;
  cancelVisibleInjectFallbackTimer(sk);
  const timer = setTimeout(() => {
    void consumeVisibleInjectFallback(api, sk, fp, "timeout").catch((err) => {
      api.logger.warn("autosure visible inject fallback timer failed", { sessionKey: sk, err: String(err) });
    });
  }, FRONTSTAGE_BRIDGE_FALLBACK_MS);
  VISIBLE_INJECT_FALLBACK_TIMERS.set(sk, timer);
}

function isAutosureDemoCommand(text) {
  const normalized = (text || "").trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  return /(?:^|\s)\/autosure-demo(?:[。.,!?\s]|$)/i.test(normalized);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildDemoAssistantIntro(phrases, sourcePath, injectRounds) {
  const list = Array.isArray(phrases) && phrases.length > 0 ? phrases : DEFAULT_CONTINUE_PHRASES;
  const bullets = list.map((p) => `- ${p}`);
  return [
    "## Autosure 续轮 · 对话内可视化演示",
    "",
    "你已发送 **`/autosure-demo`**。本条回复由插件 **`before_dispatch`** 直接交给网关展示（不占用你当前模型主链路）。",
    "",
    `接下来会自动进行 **${injectRounds}** 轮「**用户发动词** → **模型短答**」：每一轮里，用户气泡里的文字来自 \`skills/autosure/发动词.txt\`（与 \`/autosure N\` 相同的轮换规则），注入方式与真实续轮一致（\`subagent.run\` → \`agent\`）。`,
    "",
    "**当前发动词列表（轮换顺序）**",
    ...bullets,
    "",
    `**发动词文件**：${sourcePath ?? "（未找到，使用内置默认）"}`,
    "",
    "_若数秒内未出现新的用户气泡，请确认网关已重启并加载本插件。_",
  ].join("\n");
}

async function runAutosureDemoVisualSequence(api, sessionKey, phrases, injectRounds) {
  const subagent = api.runtime?.subagent;
  if (!subagent || typeof subagent.run !== "function") {
    api.logger.warn("autosure-demo: subagent.run unavailable");
    return;
  }
  const list = Array.isArray(phrases) && phrases.length > 0 ? phrases : DEFAULT_CONTINUE_PHRASES;
  const extraSystemPrompt =
    "【Autosure 可视化演示】上一条用户消息是插件为演示自动注入的发动词。请只用 1～2 句简短中文承接上下文；不要调用工具；不要列长清单。";
  const n = Math.max(1, Math.min(Number(injectRounds) || 2, 5));
  try {
    await sleep(1200);
    for (let i = 0; i < n; i += 1) {
      const phrase = pickRotatedPhrase(list, i).trim();
      if (!phrase) continue;
      await subagent.run({
        sessionKey,
        message: phrase,
        deliver: false,
        idempotencyKey: `autosure-demo:${sessionKey}:${i}:${randomUUID()}`,
        extraSystemPrompt,
      });
    }
  } catch (err) {
    api.logger.warn("autosure-demo: inject sequence failed", { sessionKey, err: String(err) });
  }
}

function maybeTransitionCircuit(session, cfg) {
  const now = nowMs();
  if (session.phase === PHASE.OPEN && Number.isFinite(session.circuitOpenUntil) && now >= session.circuitOpenUntil) {
    session.phase = PHASE.HALF_OPEN;
    session.halfOpenProbeCount = 0;
    session.lastOpenReason = "";
  }
}

function openCircuit(session, cfg, reason) {
  const now = nowMs();
  session.phase = PHASE.OPEN;
  session.circuitOpenedAt = now;
  session.circuitOpenUntil = now + cfg.circuitOpenMs;
  session.lastOpenReason = reason;
  session.inflightResume = false;
}

async function maybeScheduleResume(api, state, params) {
  const cfg = getPluginConfig(api);
  if (!cfg.enabled || !params.sessionKey) return false;

  const session = getSessionState(state, params.sessionKey);
  clearStaleInflight(session, cfg);
  maybeTransitionCircuit(session, cfg);

  if (session.phase === PHASE.OPEN) {
    return false;
  }

  if (session.phase === PHASE.HALF_OPEN && Number(session.halfOpenProbeCount || 0) >= cfg.halfOpenProbeMax) {
    openCircuit(session, cfg, "half-open-probe-exhausted");
    return false;
  }

  const fingerprint = makeFingerprint(params);
  if (Number(session.failureStreak || 0) >= cfg.circuitThreshold) {
    openCircuit(session, cfg, "failure-streak-threshold");
    session.lastDecision = "open-circuit";
    session.updatedAt = nowMs();
    await saveState(api, state);
    api.logger.warn(`autosure-resume circuit opened for ${params.sessionKey}`, {
      failureStreak: session.failureStreak,
      circuitOpenUntil: session.circuitOpenUntil,
    });
    return false;
  }

  pruneFingerprintWindow(session, cfg.dedupeTtlMs);
  const duplicate = session.recentFingerprints.some((item) => item.fp === fingerprint);
  if (duplicate) {
    session.lastDecision = "dedupe-reject";
    session.updatedAt = nowMs();
    await saveState(api, state);
    return false;
  }

  if (session.inflightResume) {
    session.lastDecision = "inflight-reject";
    session.updatedAt = nowMs();
    await saveState(api, state);
    return false;
  }

  const now = nowMs();
  const lastResumeAt = Number.isFinite(session.lastResumeAt) ? session.lastResumeAt : 0;
  const waitMs = computeEffectiveCooldown(cfg, params.reason, session);
  if (now - lastResumeAt < waitMs) {
    session.lastDecision = "cooldown-reject";
    session.effectiveCooldownMs = waitMs;
    session.updatedAt = now;
    await saveState(api, state);
    return false;
  }

  if (Number(session.consecutiveAutoResumes || 0) >= cfg.maxAutoResumes) {
    session.lastDecision = "max-resume-reject";
    session.updatedAt = now;
    await saveState(api, state);
    return false;
  }

  const instruction = buildResumeInstruction(params.reason, params.details);
  const contextKey = `autosure-resume:${fingerprint}`;
  api.runtime.system.enqueueSystemEvent(instruction, { sessionKey: params.sessionKey, contextKey });
  api.runtime.system.requestHeartbeatNow({
    reason: `autosure-resume:${params.reason}`,
    agentId: params.agentId || undefined,
    sessionKey: params.sessionKey,
    coalesceMs: Math.min(waitMs, 2000),
  });

  session.phase = PHASE.WAITING;
  session.inflightResume = true;
  session.lastResumeAt = now;
  session.lastResumeReason = params.reason;
  session.lastResumeSignature = fingerprint;
  session.lastEventFingerprint = fingerprint;
  session.effectiveCooldownMs = waitMs;
  session.consecutiveAutoResumes = Number(session.consecutiveAutoResumes || 0) + 1;
  if (session.phase === PHASE.HALF_OPEN) {
    session.halfOpenProbeCount = Number(session.halfOpenProbeCount || 0) + 1;
  }
  session.recentFingerprints.push({ fp: fingerprint, ts: now });
  session.updatedAt = now;
  await saveState(api, state);

  api.logger.info(`autosure-resume scheduled for ${params.sessionKey}`, {
    reason: params.reason,
    runId: params.runId,
    waitMs,
  });
  return true;
}

async function applyLoopInjectAfterIdle(api, sessionKey) {
  LOOP_IDLE_TIMERS.delete(sessionKey);
  const cfg = getPluginConfig(api);
  if (!cfg.enabled) return;
  const state = await loadState(api);
  await armLoopVisibleInject(api, state, sessionKey, cfg, {
    dispatchKind: "loop_idle",
    decision: "loop-idle-inject",
    effectiveCooldownMs: cfg.loopIdleGraceMs,
  });
}

function scheduleLoopIdleContinuation(api, state, params, cfg) {
  if (!cfg.enabled || !params.sessionKey) return false;
  const session = getSessionState(state, params.sessionKey);
  clearStaleInflight(session, cfg);
  const loop = isObject(session.loopControl) ? session.loopControl : null;
  if (!loop?.active) return false;
  if (loop.unlimited !== true && Number(loop.remainingRounds || 0) <= 0) return false;
  if (session.inflightResume) return false;
  if (session.phase === PHASE.OPEN) return false;

  cancelLoopIdleInjectTimer(params.sessionKey);

  const graceMs = cfg.loopIdleGraceMs;
  const sk = params.sessionKey;
  const timer = setTimeout(() => {
    void applyLoopInjectAfterIdle(api, sk).catch((err) => {
      api.logger.warn("autosure loop idle inject timer failed", { sessionKey: sk, err: String(err) });
    });
  }, graceMs);
  LOOP_IDLE_TIMERS.set(sk, timer);

  session.lastDecision = `loop-idle-wait-${graceMs}ms`;
  session.updatedAt = nowMs();
  api.logger.info(`autosure loop idle wait scheduled for ${sk}`, {
    graceMs,
    remainingRounds: loop.remainingRounds,
  });
  return true;
}

function clearResumePressure(session) {
  session.phase = PHASE.IDLE;
  session.failureStreak = 0;
  session.inflightResume = false;
  session.consecutiveAutoResumes = 0;
  session.halfOpenProbeCount = 0;
  session.lastOpenReason = "";
  session.circuitOpenedAt = 0;
  session.circuitOpenUntil = 0;
}

function clearLoop(session) {
  session.loopControl = {
    active: false,
    unlimited: false,
    targetRounds: 0,
    remainingRounds: 0,
    completedRounds: 0,
    startedAt: 0,
  };
  clearVisibleInject(session);
}

function normalizeCompletedLoopState(session) {
  const loop = isObject(session?.loopControl) ? session.loopControl : null;
  if (!loop) return false;
  if (loop.active) return false;
  if (loop.unlimited === true) return false;
  if (Number(loop.targetRounds || 0) <= 0) return false;
  if (Number(loop.remainingRounds || 0) > 0) return false;
  if (Number(loop.completedRounds || 0) < Number(loop.targetRounds || 0)) return false;
  session.inflightResume = false;
  clearVisibleInject(session);
  if (session.sessionKey) {
    cancelLoopIdleInjectTimer(session.sessionKey);
    cancelVisibleInjectFallbackTimer(session.sessionKey);
  }
  session.phase = PHASE.IDLE;
  session.lastDecision = "loop-finished-idle";
  session.failureStreak = 0;
  session.consecutiveAutoResumes = 0;
  return true;
}

function buildLoopStatusText(session) {
  const loop = isObject(session?.loopControl) ? session.loopControl : null;
  if (!loop?.active) {
    return [
      "## Autosure 状态",
      "",
      "- 状态：`idle`（当前未在自动轮跑）",
      "- 可用命令：`/autosure`、`/autosure N`、`/autosure stop`",
    ].join("\n");
  }
  const unlimited = loop.unlimited === true;
  const remainText = unlimited ? "∞" : String(Math.max(Number(loop.remainingRounds || 0), 0));
  const targetText = unlimited ? "∞（/autosure）" : String(Math.max(Number(loop.targetRounds || 0), 0));
  const doneText = String(Math.max(Number(loop.completedRounds || 0), 0));
  const phaseText = (session?.phase || PHASE.IDLE).toString();
  const grace = Number.isFinite(session?.effectiveCooldownMs) ? `${session.effectiveCooldownMs}ms` : "n/a";
  return [
    "## Autosure 状态",
    "",
    `- 状态：\`${phaseText}\``,
    `- 目标轮次：\`${targetText}\``,
    `- 已完成：\`${doneText}\``,
    `- 剩余：\`${remainText}\``,
    `- 最近决策：\`${session?.lastDecision || "n/a"}\``,
    `- 最近等待：\`${grace}\``,
  ].join("\n");
}

function buildLoopCommandAck(session, command) {
  if (!command) return buildLoopStatusText(session);
  if (command.type === "stop") {
    return [
      "## Autosure 状态",
      "",
      "- 已停止自动轮跑",
      "- 可用命令：`/autosure`、`/autosure N`、`/autosure stop`",
    ].join("\n");
  }
  if (command.type === "start") {
    const unlimited = command.unlimited === true;
    const targetText = unlimited ? "∞（/autosure）" : String(Math.max(Number(command.rounds || 0), 1));
    const loop = isObject(session?.loopControl) ? session.loopControl : null;
    const remainText = loop?.unlimited === true ? "∞" : String(Math.max(Number(loop?.remainingRounds || 0), 0));
    const doneText = String(Math.max(Number(loop?.completedRounds || 0), 0));
    const immediate = /loop-start-immediate|loop-visible-(pulled|dispatched|acked)/i.test(session?.lastDecision || "") || Number(loop?.completedRounds || 0) > 0;
    return [
      "## Autosure 状态",
      "",
      `- 状态：\`running\``,
      `- 目标轮次：\`${targetText}\``,
      `- 当前阶段：\`${immediate ? "首轮前台注入已启动" : "已接收启动命令，等待首轮注入"}\``,
      `- 已完成：\`${doneText}\``,
      `- 剩余：\`${remainText}\``,
      `- 说明：\`${immediate ? "/autosure N 会立即发起第 1 轮前台续跑；剩余轮次在每轮完成后继续" : "/autosure N 已接收，但首轮前台注入尚未真正启动"}\``,
      `- 最近决策：\`${session?.lastDecision || (unlimited ? "loop-start-unlimited" : `loop-start-${command.rounds}`)}\``,
    ].join("\n");
  }
  return buildLoopStatusText(session);
}

function pruneRuns(state) {
  const cutoff = nowMs() - 6 * 60 * 60 * 1000;
  for (const [runId, runState] of Object.entries(state.runs)) {
    const updatedAt = Number.isFinite(runState?.updatedAt) ? runState.updatedAt : 0;
    if (updatedAt < cutoff) delete state.runs[runId];
  }
}

function resolveRunForAgentEnd(state, ctx) {
  const session = ctx?.sessionKey ? state.sessions[ctx.sessionKey] : null;
  const lastRunId = session?.lastRunId;
  if (lastRunId && isObject(state.runs[lastRunId])) return { runId: lastRunId, runState: state.runs[lastRunId] };
  const entries = Object.entries(state.runs)
    .filter(([, entry]) => entry && (entry.sessionKey === ctx?.sessionKey || entry.sessionId === ctx?.sessionId))
    .sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0));
  if (!entries.length) return { runId: "", runState: null };
  return { runId: entries[0][0], runState: entries[0][1] };
}

const plugin = {
  id: "autosure-resume",
  name: "Autosure Resume",
  description: "Bounded auto-resume with dedupe, circuit breaker, and compression-aware waiting.",
  register(api) {
    api.registerGatewayMethod("autosure.visibleInject.pull", async ({ params, respond }) => {
      try {
        const sessionKey = normalizeText(params?.sessionKey);
        if (!sessionKey) {
          respond(false, { error: "sessionKey required" });
          return;
        }
        const state = await loadState(api);
        const session = getSessionState(state, sessionKey);
        const pending = isObject(session?.pendingVisibleInject) ? session.pendingVisibleInject : null;
        if (!pending) {
          respond(true, { ok: true, found: false });
          return;
        }
        session.armedVisibleInject = {
          ...pending,
          armedAt: nowMs(),
          consumerId: normalizeText(params?.consumerId) || "control-ui-capsule",
        };
        session.pendingVisibleInject = null;
        session.lastDecision = "loop-visible-pulled";
        session.updatedAt = nowMs();
        await saveState(api, state);
        respond(true, {
          ok: true,
          found: true,
          inject: {
            id: normalizeText(session.armedVisibleInject.id),
            phrase: normalizeText(session.armedVisibleInject.phrase),
            fingerprint: normalizeText(session.armedVisibleInject.fingerprint),
            createdAt: Number(session.armedVisibleInject.createdAt || 0),
            armedAt: Number(session.armedVisibleInject.armedAt || 0),
          },
        });
      } catch (error) {
        respond(false, { error: String(error) });
      }
    }, { scope: "operator.write" });

    api.registerGatewayMethod("autosure.visibleInject.ack", async ({ params, respond }) => {
      try {
        const sessionKey = normalizeText(params?.sessionKey);
        const fingerprint = normalizeText(params?.fingerprint);
        if (!sessionKey || !fingerprint) {
          respond(false, { error: "sessionKey and fingerprint required" });
          return;
        }
        cancelVisibleInjectFallbackTimer(sessionKey);
        const state = await loadState(api);
        const session = getSessionState(state, sessionKey);
        const armed = isObject(session?.armedVisibleInject) ? session.armedVisibleInject : null;
        const pending = isObject(session?.pendingVisibleInject) ? session.pendingVisibleInject : null;
        const matchArmed = armed && normalizeText(armed.fingerprint) === fingerprint;
        const matchPending = pending && normalizeText(pending.fingerprint) === fingerprint;
        if (matchArmed || matchPending) {
          clearVisibleInject(session);
          session.lastDecision = "loop-visible-acked";
          session.updatedAt = nowMs();
          await saveState(api, state);
        }
        respond(true, { ok: true, cleared: Boolean(matchArmed || matchPending) });
      } catch (error) {
        respond(false, { error: String(error) });
      }
    }, { scope: "operator.write" });

    api.registerGatewayMethod("autosure.visibleInject.fail", async ({ params, respond }) => {
      try {
        const sessionKey = normalizeText(params?.sessionKey);
        const fingerprint = normalizeText(params?.fingerprint);
        if (!sessionKey || !fingerprint) {
          respond(false, { error: "sessionKey and fingerprint required" });
          return;
        }
        const accepted = await consumeVisibleInjectFallback(api, sessionKey, fingerprint, normalizeText(params?.reason) || "page-fail");
        respond(true, { ok: true, accepted });
      } catch (error) {
        respond(false, { error: String(error) });
      }
    }, { scope: "operator.write" });

    api.on("message_received", async (_event, ctx) => {
      // Secondary cancellation path: some channels may not consistently reach before_dispatch.
      const sessionKey = resolveSessionFromConversation({
        channelId: ctx?.channelId,
        accountId: ctx?.accountId,
        conversationId: ctx?.conversationId,
      });
      if (sessionKey) {
        cancelLoopIdleInjectTimer(sessionKey);
      }
    });

    api.on("before_dispatch", async (event, ctx) => {
      const sessionKeyPre = (ctx.sessionKey || event.sessionKey || "").trim();
      if (sessionKeyPre) cancelLoopIdleInjectTimer(sessionKeyPre);
      if (sessionKeyPre) cancelVisibleInjectFallbackTimer(sessionKeyPre);
      if (sessionKeyPre) {
        bindConversationToSession({
          channelId: ctx?.channelId,
          accountId: ctx?.accountId,
          conversationId: ctx?.conversationId,
          sessionKey: sessionKeyPre,
        });
      }

      const cfg = getPluginConfig(api);
      if (!cfg.enabled) return undefined;

      const body = (event.body ?? event.content ?? "").trim();
      if (sessionKeyPre) {
        const stateForVisible = await loadState(api);
        const sessionForVisible = getSessionState(stateForVisible, sessionKeyPre);
        if (sessionForVisible && matchesArmedVisibleInject(sessionForVisible, body)) {
          clearVisibleInject(sessionForVisible);
          cancelVisibleInjectFallbackTimer(sessionKeyPre);
          sessionForVisible.lastDecision = "loop-visible-dispatched";
          sessionForVisible.updatedAt = nowMs();
          await saveState(api, stateForVisible);
        }
      }
      const command = parseAutosureCommand(body, cfg.commandMaxRounds);
      if (command?.type === "status") {
        if (!sessionKeyPre) {
          return {
            handled: true,
            text: "## Autosure 状态\n\n- 当前会话未解析到 sessionKey，暂无法读取轮跑状态。",
          };
        }
        const state = await loadState(api);
        const session = getSessionState(state, sessionKeyPre);
        return {
          handled: true,
          text: buildLoopStatusText(session),
        };
      }
      if (command?.type === "start" || command?.type === "stop") {
        if (!sessionKeyPre) {
          return {
            handled: true,
            text: "## Autosure 状态\n\n- 当前会话未解析到 sessionKey，暂无法更新轮跑状态。",
          };
        }
        const state = await loadState(api);
        const session = getSessionState(state, sessionKeyPre);
        let armedImmediate = false;
        if (command.type === "start") {
          const unlimited = command.unlimited === true;
          clearVisibleInject(session);
          session.loopControl = {
            active: true,
            unlimited,
            targetRounds: unlimited ? -1 : command.rounds,
            remainingRounds: unlimited ? 0 : command.rounds,
            completedRounds: 0,
            startedAt: nowMs(),
            lastCommandRaw: unlimited ? "/autosure" : `/autosure ${command.rounds}`,
          };
          session.inflightResume = false;
          session.phase = PHASE.RUNNING;
          session.lastDecision = unlimited ? "loop-start-unlimited" : `loop-start-${command.rounds}`;
          session.updatedAt = nowMs();
          armedImmediate = await armLoopVisibleInject(api, state, sessionKeyPre, cfg, {
            dispatchKind: "loop_start_immediate",
            decision: unlimited ? "loop-start-immediate-unlimited" : `loop-start-immediate-${command.rounds}`,
            effectiveCooldownMs: 0,
          });
          if (!armedImmediate) {
            await saveState(api, state);
          }
        } else {
          cancelLoopIdleInjectTimer(sessionKeyPre);
          cancelVisibleInjectFallbackTimer(sessionKeyPre);
          clearLoop(session);
          clearResumePressure(session);
          session.loopControl.lastCommandRaw = "/autosure stop";
          session.lastDecision = "loop-stop";
          session.updatedAt = nowMs();
          await saveState(api, state);
        }
        return {
          handled: true,
          text: buildLoopCommandAck(session, command),
        };
      }
      if (!isAutosureDemoCommand(body)) return undefined;
      const sessionKey = sessionKeyPre;
      if (!sessionKey) return undefined;

      const last = DEMO_LAST_BY_SESSION.get(sessionKey) || 0;
      if (nowMs() - last < 8000) {
        return {
          handled: true,
          text: "演示冷却中：请隔约 **8 秒** 再发一次 `/autosure-demo`。",
        };
      }
      DEMO_LAST_BY_SESSION.set(sessionKey, nowMs());

      const { phrases, sourcePath } = await loadContinuePhrases();
      const rounds = cfg.demoInjectRounds;
      void runAutosureDemoVisualSequence(api, sessionKey, phrases, rounds);

      return {
        handled: true,
        text: buildDemoAssistantIntro(phrases, sourcePath, rounds),
      };
    });

    api.on("llm_output", async (event, ctx) => {
      const state = await loadState(api);
      const runState = getRunState(state, event.runId);
      if (!runState) return;

      runState.sessionKey = ctx?.sessionKey || runState.sessionKey;
      runState.agentId = ctx?.agentId || runState.agentId;
      runState.sessionId = ctx?.sessionId || runState.sessionId;
      bindConversationToSession({
        channelId: ctx?.channelId,
        accountId: ctx?.accountId,
        conversationId: ctx?.conversationId,
        sessionKey: runState.sessionKey,
      });
      runState.assistantTexts = Array.isArray(event.assistantTexts)
        ? event.assistantTexts.filter((t) => typeof t === "string").slice(-10)
        : [];
      runState.detectedIntent = detectIntent(runState.assistantTexts);
      runState.updatedAt = nowMs();

      const session = getSessionState(state, runState.sessionKey);
      if (session) {
        const manualIntervention = ctx && Object.prototype.hasOwnProperty.call(ctx, "systemSent") && ctx.systemSent === false;
        if (manualIntervention) {
          clearResumePressure(session);
          session.lastDecision = "manual-intervention";
        }
        const hasVisibleInjectInFlight = Boolean(
          isObject(session.pendingVisibleInject) || isObject(session.armedVisibleInject)
        );
        session.phase = hasVisibleInjectInFlight
          ? PHASE.WAITING
          : session.inflightResume
            ? PHASE.RECENT
            : PHASE.RUNNING;
        if (!hasVisibleInjectInFlight) {
          session.inflightResume = false;
          clearVisibleInject(session);
          cancelVisibleInjectFallbackTimer(runState.sessionKey);
        }
        session.lastObservedRunId = event.runId || session.lastObservedRunId || "";
        session.updatedAt = nowMs();
        session.lastRunId = event.runId || session.lastRunId || "";
      }

      pruneRuns(state);
      await saveState(api, state);
    });

    api.on("after_tool_call", async (event, ctx) => {
      const state = await loadState(api);
      const runState = getRunState(state, event.runId);
      if (!runState) return;

      runState.sessionKey = ctx?.sessionKey || runState.sessionKey;
      runState.agentId = ctx?.agentId || runState.agentId;
      runState.sessionId = ctx?.sessionId || runState.sessionId;
      runState.toolCalls += 1;
      if (event.error) {
        runState.toolErrors += 1;
        runState.lastToolError = summarizeError(event.error);
      } else {
        runState.successfulToolCalls += 1;
      }
      runState.updatedAt = nowMs();

      const session = getSessionState(state, runState.sessionKey);
      if (session) {
        session.phase = PHASE.RUNNING;
        session.lastRunId = event.runId || session.lastRunId || "";
        session.updatedAt = nowMs();
      }

      pruneRuns(state);
      await saveState(api, state);
    });

    api.on("agent_end", async (event, ctx) => {
      const cfg = getPluginConfig(api);
      const state = await loadState(api);
      const { runId, runState } = resolveRunForAgentEnd(state, ctx);

      const sessionKey = ctx?.sessionKey || runState?.sessionKey || "";
      if (!sessionKey) return;
      const session = getSessionState(state, sessionKey);
      if (!session) return;

      const sessionId = ctx?.sessionId || runState?.sessionId || "";
      const agentId = ctx?.agentId || runState?.agentId || "";
      const promptText = getPromptText(event);
      let command = parseAutosureCommand(promptText, cfg.commandMaxRounds);
      if (!command) {
        command = await detectAutosureCommandFromSessionFile(ctx, runState, cfg.commandMaxRounds);
      }
      const loop = isObject(session.loopControl) ? session.loopControl : (session.loopControl = {});
      const hasVisibleInjectInFlight = Boolean(
        isObject(session.pendingVisibleInject) || isObject(session.armedVisibleInject)
      );

      if (command?.type === "start") {
        if (!hasVisibleInjectInFlight) {
          const unlimited = command.unlimited === true;
          session.loopControl = {
            active: true,
            unlimited,
            targetRounds: unlimited ? -1 : command.rounds,
            remainingRounds: unlimited ? 0 : command.rounds,
            completedRounds: 0,
            startedAt: nowMs(),
            lastCommandRaw: unlimited ? "/autosure" : `/autosure ${command.rounds}`,
          };
          session.inflightResume = false;
          session.phase = PHASE.RUNNING;
          session.lastDecision = unlimited ? "loop-start-unlimited" : `loop-start-${command.rounds}`;
        }
      } else if (command?.type === "stop") {
        cancelLoopIdleInjectTimer(sessionKey);
        clearLoop(session);
        session.loopControl.lastCommandRaw = "/autosure stop";
        session.lastDecision = "loop-stop";
      } else if (command?.type === "status") {
        session.loopControl.lastCommandRaw = "/autosure status";
        session.lastDecision = "loop-status";
      } else if (loop.active && ctx?.systemSent === false && promptText) {
        // Any manual user message other than /autosure commands takes priority.
        cancelLoopIdleInjectTimer(sessionKey);
        clearLoop(session);
        session.lastDecision = "loop-manual-override";
      }

      const errorText = summarizeError(event.error || runState?.lastToolError || "");
      const sawToolError = Number(runState?.toolErrors || 0) > 0;
      const nonActionStop = Boolean(
        cfg.enableNonActionResume &&
          event.success &&
          runState?.detectedIntent &&
          Number(runState?.successfulToolCalls || 0) === 0
      );

      let reason = "";
      if (!event.success) {
        if (isCompressionSignal(errorText)) reason = "compression";
        else if (/timeout|timed out/i.test(errorText)) reason = "timeout";
        else if (sawToolError) reason = "tool_error";
        else reason = "agent_error";
      } else if (sawToolError) {
        reason = "tool_error";
      } else if (nonActionStop) {
        reason = "non_action";
      }

      let scheduled = false;
      const loopAlreadyFinished = Boolean(
        !hasVisibleInjectInFlight &&
        loop &&
        loop.unlimited !== true &&
        Number(loop.targetRounds || 0) > 0 &&
        Number(loop.remainingRounds || 0) <= 0 &&
        Number(loop.completedRounds || 0) >= Number(loop.targetRounds || 0)
      );
      if (reason && !loopAlreadyFinished) {
        cancelLoopIdleInjectTimer(sessionKey);
        session.failureStreak = Number(session.failureStreak || 0) + 1;
        session.lastFailureAt = nowMs();
        scheduled = await maybeScheduleResume(api, state, {
          reason,
          details: errorText,
          sessionKey,
          sessionId,
          agentId,
          runId,
          toolCalls: runState?.toolCalls || 0,
          toolErrors: runState?.toolErrors || 0,
          successfulToolCalls: runState?.successfulToolCalls || 0,
          error: errorText,
        });
        if (!scheduled && session.phase !== PHASE.OPEN) {
          session.phase = PHASE.RUNNING;
        }
      } else {
        clearResumePressure(session);
        session.lastSuccessAt = nowMs();
        if (command?.type === "start") {
          if (hasVisibleInjectInFlight) {
            scheduled = true;
            session.phase = PHASE.WAITING;
          } else {
            const unlimited = command.unlimited === true;
            scheduled = await armLoopVisibleInject(api, state, sessionKey, cfg, {
              dispatchKind: "loop_start_immediate",
              decision: unlimited ? "loop-start-immediate-unlimited" : `loop-start-immediate-${command.rounds}`,
              effectiveCooldownMs: 0,
            });
          }
          if (!scheduled && session.loopControl?.active) {
            scheduled = scheduleLoopIdleContinuation(api, state, {
              sessionKey,
              sessionId,
              agentId,
              runId,
            }, cfg);
          }
          if (!scheduled) {
            session.phase = session.loopControl?.active ? PHASE.RUNNING : PHASE.IDLE;
          }
        } else if (session.loopControl?.active) {
          scheduled = scheduleLoopIdleContinuation(api, state, {
            sessionKey,
            sessionId,
            agentId,
            runId,
          }, cfg);
          if (!scheduled) {
            session.phase = session.loopControl?.active ? PHASE.RUNNING : PHASE.IDLE;
          }
        } else {
          session.phase = PHASE.IDLE;
          session.lastDecision = session.lastDecision || "loop-finished-idle";
        }
      }

      session.lastAgentEndAt = nowMs();
      normalizeCompletedLoopState(session);
      session.updatedAt = nowMs();

      if (runId) delete state.runs[runId];
      if (session.lastRunId === runId) delete session.lastRunId;
      pruneRuns(state);
      await saveState(api, state);

      api.logger.info("autosure-resume agent_end observed", {
        sessionKey,
        runId,
        success: event.success,
        reason: reason || "none",
        scheduled,
        phase: session.phase,
        failureStreak: session.failureStreak,
      });
    });

    api.on("before_reset", async (_event, ctx) => {
      if (ctx?.sessionKey) cancelLoopIdleInjectTimer(ctx.sessionKey);
      const ckey = makeConversationKey(ctx?.channelId, ctx?.accountId, ctx?.conversationId);
      if (ckey) CONVERSATION_TO_SESSION.delete(ckey);
      const state = await loadState(api);
      if (ctx?.sessionKey) delete state.sessions[ctx.sessionKey];
      pruneRuns(state);
      await saveState(api, state);
    });
  },
};

export default plugin;
