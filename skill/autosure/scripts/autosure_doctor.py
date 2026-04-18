#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


ACTIVE_PLUGIN = "autosure-resume"


def skill_root() -> Path:
    return Path(__file__).resolve().parents[1]


def plugin_state_file() -> Path:
    return Path.home() / ".openclaw" / "plugins" / ACTIVE_PLUGIN / "state.json"


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


def static_contracts(userscript_path: Path, native_path: Path) -> dict:
    userscript_text = userscript_path.read_text(encoding="utf-8") if userscript_path.exists() else ""
    native_text = native_path.read_text(encoding="utf-8") if native_path.exists() else ""

    def has_mount_anchor_contract(text: str) -> bool:
        return all(token in text for token in ["findChatControls", "findChatControlsAnchor", "mountIntoToolbar"])

    def has_menu_portal_contract(text: str) -> bool:
        return all(token in text for token in ["document.body.appendChild(menu)", "placeMenu", 'position = "fixed"'])

    def has_theme_contract(text: str) -> bool:
        return all(token in text for token in ["detectDarkTheme", "applyTheme", "data-theme"])

    userscript = {
        "path": str(userscript_path),
        "exists": userscript_path.exists(),
        "mountAnchor": has_mount_anchor_contract(userscript_text),
        "menuPortal": has_menu_portal_contract(userscript_text),
        "themeReadability": has_theme_contract(userscript_text),
    }
    native = {
        "path": str(native_path),
        "exists": native_path.exists(),
        "mountAnchor": has_mount_anchor_contract(native_text),
        "menuPortal": has_menu_portal_contract(native_text),
        "themeReadability": has_theme_contract(native_text),
    }
    ok = all([
        userscript["exists"], native["exists"],
        userscript["mountAnchor"], native["mountAnchor"],
        userscript["menuPortal"], native["menuPortal"],
        userscript["themeReadability"], native["themeReadability"],
    ])
    return {
        "ok": ok,
        "userscript": userscript,
        "native": native,
    }


def runtime_state_contract() -> dict:
    state_path = plugin_state_file()
    if not state_path.exists():
        return {
            "ok": False,
            "path": str(state_path),
            "exists": False,
            "sessionsObject": False,
            "runsObject": False,
            "hasAnySession": False,
            "detail": "plugin state file missing",
        }
    try:
        payload = json.loads(state_path.read_text(encoding="utf-8"))
    except Exception as e:
        return {
            "ok": False,
            "path": str(state_path),
            "exists": True,
            "sessionsObject": False,
            "runsObject": False,
            "hasAnySession": False,
            "detail": f"state file unreadable: {e}",
        }

    sessions = payload.get("sessions") if isinstance(payload, dict) else None
    runs = payload.get("runs") if isinstance(payload, dict) else None
    sessions_object = isinstance(sessions, dict)
    runs_object = isinstance(runs, dict)
    has_any_session = sessions_object and len(sessions) > 0
    return {
        "ok": sessions_object and runs_object,
        "path": str(state_path),
        "exists": True,
        "sessionsObject": sessions_object,
        "runsObject": runs_object,
        "hasAnySession": bool(has_any_session),
        "sessionCount": len(sessions) if sessions_object else 0,
        "runCount": len(runs) if runs_object else 0,
        "detail": "state file shape ok" if (sessions_object and runs_object) else "state file shape mismatch",
    }


def classify_status(core_ok: bool, ui_carrier_ok: bool, runtime_ok: bool, ui_contract_ok: bool) -> tuple[str, str]:
    if core_ok and ui_carrier_ok and runtime_ok and ui_contract_ok:
        return "healthy", "info"
    if not core_ok or not runtime_ok:
        return "critical", "error"
    if not ui_carrier_ok:
        return "degraded", "warn"
    if not ui_contract_ok:
        return "contract-drift", "warn"
    return "mixed", "warn"


def build_payload() -> tuple[dict, int]:
    root = skill_root()
    verify_cmd = [sys.executable, str(root / "scripts" / "verify_health.py"), "--mode", "full"]
    repair_cmd = [sys.executable, str(root / "scripts" / "repair_center.py"), "verify"]

    core_rc, core_payload, core_out, core_err = run_json(verify_cmd)
    carrier_rc, carrier_payload, carrier_out, carrier_err = run_json(repair_cmd)
    contracts = static_contracts(
        root / "ui-capsule" / "repair-pack" / "autosure-capsule.user.js",
        root / "ui-capsule" / "repair-pack" / "native-control-ui-capsule.js",
    )
    runtime_state = runtime_state_contract()

    ui_carrier_ok = carrier_payload.get("statusSummary") in {"healthy-native", "healthy-userscript-ready"}
    core_ok = bool(core_payload.get("ok", False)) and core_rc == 0
    ui_contract_ok = bool(contracts.get("ok", False))
    runtime_ok = bool(runtime_state.get("ok", False))
    status_class, severity = classify_status(core_ok, ui_carrier_ok, runtime_ok, ui_contract_ok)

    recommended_next_action = (
        carrier_payload.get("recommendedAction")
        or ("fix-runtime-state" if not runtime_ok else ("fix-core-plugin-health" if not core_ok else "inspect-ui-contract"))
    )

    summary_parts = []
    summary_parts.append("core-ok" if core_ok else "core-failed")
    summary_parts.append(carrier_payload.get("statusSummary", "carrier-unknown"))
    summary_parts.append("runtime-state-ok" if runtime_ok else "runtime-state-failed")
    summary_parts.append("ui-contract-ok" if ui_contract_ok else "ui-contract-failed")

    payload = {
        "ok": core_ok and ui_carrier_ok and runtime_ok and ui_contract_ok,
        "statusClass": status_class,
        "severity": severity,
        "summary": " | ".join(summary_parts),
        "recommendedNextAction": recommended_next_action,
        "core": {
            "ok": core_ok,
            "command": " ".join(verify_cmd),
            "payload": core_payload,
            "stdout": core_out if not core_payload else "",
            "stderr": core_err,
        },
        "uiCarrier": {
            "ok": ui_carrier_ok,
            "command": " ".join(repair_cmd),
            "payload": carrier_payload,
            "stdout": carrier_out if not carrier_payload else "",
            "stderr": carrier_err,
        },
        "runtimeState": runtime_state,
        "uiContract": contracts,
    }
    exit_code = 0 if payload["ok"] else 1
    return payload, exit_code


def main() -> int:
    ap = argparse.ArgumentParser(description="Autosure unified doctor/test harness")
    ap.add_argument("--json-only", action="store_true", help="Emit compact JSON on a single line")
    ap.add_argument("--pretty", action="store_true", help="Emit pretty JSON (default)")
    args = ap.parse_args()

    payload, exit_code = build_payload()
    if args.json_only:
        print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
