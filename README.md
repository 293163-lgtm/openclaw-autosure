# openclaw-autosure

Self-contained OpenClaw skill for safe unattended continuation: bounded auto-resume, circuit-governed failure recovery, and `/autosure` success-loop controls with an optional UI capsule.

中文说明见：[`skill/autosure/README.md`](skill/autosure/README.md) / [`skill/autosure/小白使用说明.md`](skill/autosure/小白使用说明.md)

## What it is

Autosure is a distributable OpenClaw skill pack for long-running or hands-off sessions that need:

- verified failure resume instead of blind retries
- bounded or unlimited `/autosure` continuation loops
- human override at any time
- optional userscript UI capsule, with native fallback for local Control UI failure cases

## Install

Use the packaged skill from `dist/autosure.skill`, or copy `skill/autosure/` into your OpenClaw workspace and follow the install steps in:

- `skill/autosure/DEPLOY.md`
- `skill/autosure/HANDOFF_FOR_AGENT.md`

## Included

- packaged release: `dist/autosure.skill`
- source skill: `skill/autosure/`
- release notes: `releases/v0.1.0.md`

## Version

Initial public release: `v0.1.0`
