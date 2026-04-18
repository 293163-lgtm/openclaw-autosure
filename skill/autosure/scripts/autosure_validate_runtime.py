#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


ACTIVE_PLUGIN = "autosure-resume"
DEFAULT_SESSION_KEY = "agent:main:main"


def state_file() -> Path:
    return Path.home() / ".openclaw" / "plugins" / ACTIVE_PLUGIN / "state.json"


def load_state() -> dict:
    path = state_file()
    if not path.exists():
        raise FileNotFoundError(f"state file not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def snapshot_for_session(payload: dict, session_key: str) -> dict:
    sessions = payload.get("sessions") if isinstance(payload, dict) else {}
    runs = payload.get("runs") if isinstance(payload, dict) else {}
    session = sessions.get(session_key, {}) if isinstance(sessions, dict) else {}
    loop = session.get("loopControl", {}) if isinstance(session, dict) else {}

    inflight_resume = session.get("inflightResume") if isinstance(session, dict) else None
    loop_active = loop.get("active") if isinstance(loop, dict) else None
    loop_target_rounds = loop.get("targetRounds") if isinstance(loop, dict) else None
    loop_remaining_rounds = loop.get("remainingRounds") if isinstance(loop, dict) else None
    loop_completed_rounds = loop.get("completedRounds") if isinstance(loop, dict) else None
    phase = session.get("phase", "missing") if isinstance(session, dict) else "missing"

    effective_loop_state = "unknown"
    terminal_tail = False
    if isinstance(session, dict) and session:
        if loop_active is True:
            effective_loop_state = "loop-active"
        elif inflight_resume is True:
            effective_loop_state = "resume-inflight"
        else:
            effective_loop_state = "loop-idle"
            terminal_tail = phase == "running"

    return {
        "sessionKey": session_key,
        "statePath": str(state_file()),
        "sessionExists": isinstance(session, dict) and bool(session),
        "phase": phase,
        "failureStreak": session.get("failureStreak") if isinstance(session, dict) else None,
        "consecutiveAutoResumes": session.get("consecutiveAutoResumes") if isinstance(session, dict) else None,
        "inflightResume": inflight_resume,
        "loopActive": loop_active,
        "loopUnlimited": loop.get("unlimited") if isinstance(loop, dict) else None,
        "loopTargetRounds": loop_target_rounds,
        "loopRemainingRounds": loop_remaining_rounds,
        "loopCompletedRounds": loop_completed_rounds,
        "loopLastCommandRaw": loop.get("lastCommandRaw") if isinstance(loop, dict) else None,
        "lastDecision": session.get("lastDecision") if isinstance(session, dict) else None,
        "lastResumeReason": session.get("lastResumeReason") if isinstance(session, dict) else None,
        "effectiveLoopState": effective_loop_state,
        "phaseAuthoritativeForLoop": False,
        "terminalTailObserved": terminal_tail,
        "updatedAt": session.get("updatedAt") if isinstance(session, dict) else None,
        "lastSuccessAt": session.get("lastSuccessAt") if isinstance(session, dict) else None,
        "lastAgentEndAt": session.get("lastAgentEndAt") if isinstance(session, dict) else None,
        "sessionCount": len(sessions) if isinstance(sessions, dict) else 0,
        "runCount": len(runs) if isinstance(runs, dict) else 0,
    }


def diff_snapshots(before: dict, after: dict) -> dict:
    keys = sorted(set(before.keys()) | set(after.keys()))
    changed = {}
    for key in keys:
        if before.get(key) != after.get(key):
            changed[key] = {
                "before": before.get(key),
                "after": after.get(key),
            }
    return changed


def main() -> int:
    ap = argparse.ArgumentParser(description="Autosure runtime validation helper for independent test sessions")
    ap.add_argument("action", choices=("snapshot", "diff"))
    ap.add_argument("--session-key", default=DEFAULT_SESSION_KEY, help="Session key to inspect in autosure state.json")
    ap.add_argument("--before", type=Path, default=None, help="Path to a previously saved snapshot JSON")
    ap.add_argument("--save", type=Path, default=None, help="Optional path to save the current snapshot JSON")
    args = ap.parse_args()

    current = snapshot_for_session(load_state(), args.session_key)

    if args.action == "snapshot":
        if args.save is not None:
            args.save.parent.mkdir(parents=True, exist_ok=True)
            args.save.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"ok": True, "snapshot": current}, ensure_ascii=False, indent=2))
        return 0

    if args.before is None:
        raise SystemExit("--before is required for diff")
    before_payload = json.loads(args.before.read_text(encoding="utf-8"))
    before = before_payload.get("snapshot", before_payload)
    changed = diff_snapshots(before, current)
    result = {
        "ok": True,
        "before": before,
        "after": current,
        "changed": changed,
        "changedCount": len(changed),
    }
    if args.save is not None:
        args.save.parent.mkdir(parents=True, exist_ok=True)
        args.save.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
