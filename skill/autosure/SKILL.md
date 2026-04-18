---
name: autosure
description: "Enterprise-grade OpenClaw unattended ops with vendored autosure-resume, optional auto-resume-lite, bounded /autosure success-loop, circuit breaker, idle grace, phrase pool, and one-command install for long-running hands-off sessions."
metadata:
  openclaw:
    emoji: 🛡️
    audience: ops
---

# autosure

## Purpose

`autosure` is a **distributable skill pack** for OpenClaw that standardizes:

- **Safe auto-resume** on verified failure signals (via **`autosure-resume`** plugin, vendored under `vendor/`).
- **Optional minimal resume** via bundled **`auto-resume-lite`** (mutually exclusive with the main plugin).
- **Dialable success-loop** (`/autosure`, `/autosure N`) with **idle grace** and **rotating phrases** from `发动词.txt`.
- **Professional closure** templates for checkpoint / progress / session handoff.

## Read this first

- 中文入口：`references/cn.md`
- Product truth: `docs/PRD.md`
- Runtime truth: `docs/ARCHITECTURE.md`
- UI capsule spec: `docs/UI_CAPSULE_SPEC.md`

## When to use

- You ship OpenClaw to **another machine** or **customer agent** and need a **repeatable install story**.
- Long jobs should **continue after benign failures** without spamming the session.
- You want **bounded** auto-continue after successful turns **without** telling the model a fixed “round budget” in prose.

## One-line deploy (human or agent)

1. Copy this directory to `OPENCLAW_WORKSPACE/skills/autosure`.
2. Run `python3 skills/autosure/scripts/install_bundle.py --mode full`.
3. Merge printed `plugins` JSON into `~/.openclaw/openclaw.json`, then `openclaw config validate` + `openclaw daemon restart`.
4. Verify with `python3 skills/autosure/scripts/verify_health.py --mode full`.

Full handoff text for another agent: **`HANDOFF_FOR_AGENT.md`**. Customer-facing steps: **`小白使用说明.md`** + **`DEPLOY.md`**.

## Guardrails

1. Never auto-resume blindly on a fixed wall-clock alone.
2. Only resume on **verified interruption signals** (timeout/tool/provider/agent error paths — see plugin).
3. Enforce **circuit breaker** when failures repeat.
4. Pause resume pressure after **human override** (non-system user message while loop active clears loop).
5. Prefer **mutually exclusive** plugins: **`autosure-resume` XOR `auto-resume-lite`**.

## Required file sync (project lanes)

For planning-with-files lanes, each meaningful round should synchronize checkpoint / progress / session state; use `templates/CLOSURE.md` as the canonical block.

## Phrase pool

Web UI loop injects user-visible lines from **`发动词.txt`** (one phrase per line, `#` comments ignored). **~30** generic, high-standard “推进” lines ship by default; edit freely.

## Product docs (this pack)

| Doc | Role |
|-----|------|
| `docs/PRD.md` | 需求、范围、验收 |
| `docs/ARCHITECTURE.md` | 分层、双通道、状态、依赖 |
| `docs/UI_CAPSULE_SPEC.md` | A1 胶囊（userscript）交互与修复包设计 |
| `RELEASE_NOTES.md` | 发版叙事与边界 |
| `MANIFEST.json` | 机器可读组件清单 |
| `vendor/README.md` | 插件 vendor 说明 |
| `references/cn.md` | 中文入口与瘦身说明 |

## UI capsule repair pack

- Userscript: `ui-capsule/repair-pack/autosure-capsule.user.js`
- Native fallback source: `ui-capsule/repair-pack/native-control-ui-capsule.js`
- Enable helper: `ui-capsule/repair-pack/enable.sh`
- Disable helper: `ui-capsule/repair-pack/disable.sh`
- Native patch helper: `scripts/patch_control_ui.py`
- Repair notes: `ui-capsule/repair-pack/ENABLE_DISABLE.md`

Default path is still **Tampermonkey userscript**.
If a machine proves that Tampermonkey installs the script but does **not execute** it on `127.0.0.1:18789/chat*`, use the **native fallback patch** to inject the same controls into local OpenClaw Control UI.

- `/autosure` — unlimited delegated continues until `/autosure stop` or a normal user message clears the loop.
- `/autosure N` — **N** counts **delegated** injects only (not the command line itself).
- `/autosure stop` / `/autosure status`
- `/autosure-demo` — **short-reply demo** only; not production loop semantics.

## Stop conditions

- Circuit opened (repeated failure threshold).
- Human override / `/autosure stop`.
- Risk boundary violation (operator policy).
