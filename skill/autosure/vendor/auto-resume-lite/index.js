/**
 * auto-resume-lite — bundled with Autosure skill pack.
 * Minimal: on failed agent_end only, enqueue one system continuation + heartbeat.
 * NOT compatible with autosure-resume enabled simultaneously (double-resume risk).
 */

const lastResumeAt = new Map();

function nowMs() {
  return Date.now();
}

function getConfig(api) {
  const raw = api.pluginConfig && typeof api.pluginConfig === "object" ? api.pluginConfig : {};
  const cooldown = Number.isFinite(raw.cooldownMs) ? raw.cooldownMs : 12000;
  return {
    enabled: raw.enabled !== false,
    cooldownMs: Math.min(600000, Math.max(3000, cooldown)),
  };
}

const plugin = {
  id: "auto-resume-lite",
  name: "Auto Resume Lite",
  description: "Minimal failure-only resume (Autosure bundle). Mutually exclusive with autosure-resume.",
  register(api) {
    api.on("agent_end", async (event, ctx) => {
      const cfg = getConfig(api);
      if (!cfg.enabled) return;
      if (event && event.success) return;

      const sessionKey = (ctx?.sessionKey || "").trim();
      if (!sessionKey) return;

      const prev = lastResumeAt.get(sessionKey) || 0;
      if (nowMs() - prev < cfg.cooldownMs) {
        api.logger.info("auto-resume-lite: cooldown skip", { sessionKey, cooldownMs: cfg.cooldownMs });
        return;
      }
      lastResumeAt.set(sessionKey, nowMs());

      const instruction =
        "Previous agent turn did not complete successfully. Continue the same user-visible task from the last coherent state; take one concrete next step, then report.";
      try {
        api.runtime.system.enqueueSystemEvent(instruction, {
          sessionKey,
          contextKey: `auto-resume-lite:${nowMs()}`,
        });
        api.runtime.system.requestHeartbeatNow({
          reason: "auto-resume-lite",
          agentId: ctx?.agentId || undefined,
          sessionKey,
          coalesceMs: 2000,
        });
        api.logger.info("auto-resume-lite: naive resume scheduled", { sessionKey });
      } catch (err) {
        api.logger.warn("auto-resume-lite: schedule failed", { sessionKey, err: String(err) });
      }
    });
  },
};

export default plugin;
