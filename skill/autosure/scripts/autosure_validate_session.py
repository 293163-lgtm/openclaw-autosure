#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_SESSION_KEY = "agent:main:main"


def skill_root() -> Path:
    return Path(__file__).resolve().parents[1]


def artifacts_root() -> Path:
    return skill_root() / "artifacts" / "runtime-validation"


def safe_slug(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", text.strip())
    return cleaned.strip("-") or "session"


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def run_json(cmd: list[str]) -> tuple[int, dict, str, str]:
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    out = (result.stdout or "").strip()
    err = (result.stderr or "").strip()
    payload = {}
    if out:
        try:
            payload = json.loads(out)
        except Exception:
            payload = {}
    return result.returncode, payload, out, err


def plan_dir(base_dir: Path | None, session_key: str) -> Path:
    if base_dir is not None:
        return base_dir.expanduser().resolve()
    return artifacts_root() / f"{utc_stamp()}-{safe_slug(session_key)}"


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def prepare(session_key: str, out_dir: Path) -> int:
    root = skill_root()
    doctor_cmd = [sys.executable, str(root / "scripts" / "autosure_doctor.py"), "--pretty"]
    snapshot_cmd = [
        sys.executable,
        str(root / "scripts" / "autosure_validate_runtime.py"),
        "snapshot",
        "--session-key",
        session_key,
        "--save",
        str(out_dir / "before.json"),
    ]

    doctor_rc, doctor_payload, doctor_out, doctor_err = run_json(doctor_cmd)
    snap_rc, snap_payload, snap_out, snap_err = run_json(snapshot_cmd)

    result = {
        "ok": doctor_rc == 0 and snap_rc == 0,
        "sessionKey": session_key,
        "outDir": str(out_dir),
        "doctor": doctor_payload if doctor_payload else {"stdout": doctor_out, "stderr": doctor_err, "ok": doctor_rc == 0},
        "before": snap_payload if snap_payload else {"stdout": snap_out, "stderr": snap_err, "ok": snap_rc == 0},
        "artifacts": {
            "doctor": str(out_dir / "doctor.json"),
            "before": str(out_dir / "before.json"),
            "after": str(out_dir / "after.json"),
            "diff": str(out_dir / "diff.json"),
        },
        "checklist": [
            "/autosure status",
            "/autosure 3",
            "observe at least one loop injection",
            "/autosure stop",
            f"python3 skills/autosure/scripts/autosure_validate_session.py finalize --session-key {session_key} --out-dir {out_dir}",
        ],
    }

    write_json(out_dir / "doctor.json", result["doctor"] if isinstance(result["doctor"], dict) else {"raw": result["doctor"]})
    write_json(out_dir / "prepare.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


def finalize(session_key: str, out_dir: Path) -> int:
    root = skill_root()
    after_cmd = [
        sys.executable,
        str(root / "scripts" / "autosure_validate_runtime.py"),
        "snapshot",
        "--session-key",
        session_key,
        "--save",
        str(out_dir / "after.json"),
    ]
    diff_cmd = [
        sys.executable,
        str(root / "scripts" / "autosure_validate_runtime.py"),
        "diff",
        "--session-key",
        session_key,
        "--before",
        str(out_dir / "before.json"),
        "--save",
        str(out_dir / "diff.json"),
    ]

    after_rc, after_payload, after_out, after_err = run_json(after_cmd)
    diff_rc, diff_payload, diff_out, diff_err = run_json(diff_cmd)

    changed = diff_payload.get("changed", {}) if isinstance(diff_payload, dict) else {}
    after_snapshot = (after_payload or {}).get("snapshot", after_payload) if isinstance(after_payload, dict) else {}
    behavior_summary = {
        "phaseChanged": "phase" in changed,
        "loopFieldsChanged": any(k.startswith("loop") for k in changed.keys()),
        "updatedAtChanged": "updatedAt" in changed,
        "lastSuccessChanged": "lastSuccessAt" in changed,
        "lastAgentEndChanged": "lastAgentEndAt" in changed,
        "effectiveLoopState": after_snapshot.get("effectiveLoopState"),
        "terminalTailObserved": after_snapshot.get("terminalTailObserved"),
        "phaseAuthoritativeForLoop": after_snapshot.get("phaseAuthoritativeForLoop"),
        "authoritativeLoopFinished": bool(
            after_snapshot.get("sessionExists")
            and after_snapshot.get("inflightResume") is False
            and after_snapshot.get("loopActive") is False
            and after_snapshot.get("loopRemainingRounds") in (0, None)
        ),
    }

    result = {
        "ok": after_rc == 0 and diff_rc == 0,
        "sessionKey": session_key,
        "outDir": str(out_dir),
        "after": after_payload if after_payload else {"stdout": after_out, "stderr": after_err, "ok": after_rc == 0},
        "diff": diff_payload if diff_payload else {"stdout": diff_out, "stderr": diff_err, "ok": diff_rc == 0},
        "behaviorSummary": behavior_summary,
    }
    write_json(out_dir / "finalize.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="Autosure independent test-session validator helper")
    ap.add_argument("action", choices=("prepare", "finalize"))
    ap.add_argument("--session-key", default=DEFAULT_SESSION_KEY, help="Autosure session key to validate")
    ap.add_argument("--out-dir", type=Path, default=None, help="Artifact output directory")
    args = ap.parse_args()

    out_dir = plan_dir(args.out_dir, args.session_key)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.action == "prepare":
        return prepare(args.session_key, out_dir)
    return finalize(args.session_key, out_dir)


if __name__ == "__main__":
    raise SystemExit(main())
