#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

KNOWN_USERSCRIPT_MANAGERS = {
    "dhdgffkkebhmkfjojejmpbldmpobfkfo": "Tampermonkey",
    "iikmkjmpaadaobahmlepeloendndfphd": "Tampermonkey Beta",
    "jinjaccalgkegednnccohejagnlnfdag": "Violentmonkey",
    "mhmadkmgjjelhpedgfedcmjnfdelnlfo": "Userscripts",
}
USERSCRIPT_MANAGER_TOKENS = (
    "tampermonkey",
    "violentmonkey",
    "userscript",
)


def skill_root() -> Path:
    return Path(__file__).resolve().parents[1]


def workspace_root() -> Path:
    env_ws = (os.environ.get("OPENCLAW_WORKSPACE") or "").strip()
    if env_ws:
        return Path(env_ws).expanduser().resolve()
    return (Path.home() / ".openclaw" / "workspace").resolve()


def primary_profile_root() -> Path:
    return (Path.home() / ".openclaw" / "browser" / "openclaw" / "user-data").resolve()


def default_control_ui_index() -> Path:
    return (
        Path.home()
        / ".volta"
        / "tools"
        / "image"
        / "packages"
        / "openclaw"
        / "lib"
        / "node_modules"
        / "openclaw"
        / "dist"
        / "control-ui"
        / "index.html"
    ).resolve()


def userscript_source() -> Path:
    return skill_root() / "ui-capsule" / "repair-pack" / "autosure-capsule.user.js"


def native_source() -> Path:
    return skill_root() / "ui-capsule" / "repair-pack" / "native-control-ui-capsule.js"


def native_install_backup_path(index_path: Path) -> Path:
    return index_path.with_suffix(index_path.suffix + ".autosure.bak")


def native_remove_backup_path(index_path: Path) -> Path:
    return index_path.with_suffix(index_path.suffix + ".autosure.remove.bak")


def acceptance_url(debug: bool = True) -> str:
    url = "http://127.0.0.1:18789/chat?session=agent%3Amain%3Amain"
    return url + ("&autosureDebug=1" if debug else "")


def run_cmd(cmd: list[str]) -> tuple[int, str, str]:
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def detect_native_patch(index_path: Path) -> dict:
    if not index_path.exists():
        return {
            "ok": False,
            "present": False,
            "detail": f"control-ui index missing: {index_path}",
        }
    html = index_path.read_text(encoding="utf-8", errors="replace")
    markers = {
        "root_id": 'autosure-native-capsule' in html,
        "debug_query": 'autosureDebug=1' in html,
        "state_key": 'autosure.capsule.state.v2' in html,
        "debug_label": 'AUTOSURE DEBUG' in html,
    }
    present = all(markers.values())
    return {
        "ok": present,
        "present": present,
        "detail": str(index_path),
        "markers": markers,
    }


def detect_native_backups(index_path: Path) -> dict:
    install_backup = native_install_backup_path(index_path)
    remove_backup = native_remove_backup_path(index_path)
    payload = {
        "installBackup": {
            "path": str(install_backup),
            "exists": install_backup.exists(),
        },
        "removeBackup": {
            "path": str(remove_backup),
            "exists": remove_backup.exists(),
        },
    }
    return payload


def read_manifest_name(manifest_path: Path) -> str:
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return "UNKNOWN"
    name = data.get("name", "UNKNOWN")
    if isinstance(name, str) and name.startswith("__MSG_") and name.endswith("__"):
        token = name[len("__MSG_") : -2]
        for locale in ("en", "en_US", "zh_CN", "zh", "default"):
            messages = manifest_path.parent / "_locales" / locale / "messages.json"
            if not messages.exists():
                continue
            try:
                payload = json.loads(messages.read_text(encoding="utf-8"))
            except Exception:
                continue
            if token in payload:
                return payload[token].get("message", name)
    return name


def detect_userscript_managers(profile_root: Path) -> dict:
    ext_root = profile_root / "Default" / "Extensions"
    if not ext_root.exists():
        return {
            "ok": False,
            "present": False,
            "detail": f"extensions dir missing: {ext_root}",
            "managers": [],
        }

    managers: list[dict] = []
    for ext_dir in sorted(p for p in ext_root.iterdir() if p.is_dir()):
        versions = sorted(p for p in ext_dir.iterdir() if p.is_dir())
        if not versions:
            continue
        manifest = versions[-1] / "manifest.json"
        if not manifest.exists():
            continue
        resolved_name = read_manifest_name(manifest)
        lowered = resolved_name.lower()
        known = KNOWN_USERSCRIPT_MANAGERS.get(ext_dir.name)
        if known or any(token in lowered for token in USERSCRIPT_MANAGER_TOKENS):
            managers.append(
                {
                    "id": ext_dir.name,
                    "version": versions[-1].name,
                    "name": known or resolved_name,
                    "path": str(versions[-1]),
                }
            )

    return {
        "ok": bool(managers),
        "present": bool(managers),
        "detail": str(ext_root),
        "managers": managers,
    }


def detect_staged_userscript(target_dir: Path) -> dict:
    staged = target_dir / "autosure-capsule.user.js"
    disabled = target_dir / "autosure-capsule.user.js.disabled"
    source = userscript_source()
    return {
        "ok": source.exists(),
        "source": str(source),
        "sourceExists": source.exists(),
        "stagedPath": str(staged),
        "stagedExists": staged.exists(),
        "disabledPath": str(disabled),
        "disabledExists": disabled.exists(),
    }


def build_next_steps(native: dict, managers: dict, staged: dict) -> list[str]:
    steps: list[str] = []
    if not managers["present"]:
        steps.append("Install or connect a userscript manager in the 007 primary browser profile if you want the userscript carrier.")
    if managers["present"] and not staged["stagedExists"]:
        steps.append("Run `python3 skills/autosure/scripts/repair_center.py stage-userscript` to stage the latest autosure userscript for import.")
    if not native["present"]:
        steps.append("Run `python3 skills/autosure/scripts/repair_center.py native-install` to restore the local native fallback.")
    if native["present"]:
        steps.append("Open the acceptance page with `python3 skills/autosure/scripts/repair_center.py open-acceptance-url` for local visual confirmation.")
    return steps


def summarize_status(native: dict, managers: dict, staged: dict, recommended_carrier: str) -> tuple[str, str, str]:
    if recommended_carrier == "native-fallback" and native["present"]:
        return (
            "healthy-native",
            "use-native-fallback",
            "No userscript manager is currently available in the 007 primary browser profile, so native fallback is the only healthy carrier on this machine.",
        )
    if recommended_carrier == "userscript" and managers["present"] and staged["sourceExists"]:
        if staged["stagedExists"]:
            return (
                "healthy-userscript-ready",
                "open-acceptance-url",
                "A userscript manager is present and the autosure userscript is already staged, so the userscript carrier is ready for import/acceptance.",
            )
        return (
            "mixed-needs-attention",
            "stage-userscript-import",
            "A userscript manager is present, but the latest autosure userscript is not staged for import yet.",
        )
    if not native["present"] and not managers["present"]:
        return (
            "blocked-no-carrier",
            "restore-native-patch",
            "Neither native fallback nor a userscript manager is currently available, so the machine has no healthy UI carrier.",
        )
    if not native["present"] and managers["present"]:
        if staged["stagedExists"]:
            return (
                "mixed-needs-attention",
                "open-acceptance-url",
                "Userscript carrier may be available, but native fallback is absent and visual acceptance should be confirmed before treating the machine as healthy.",
            )
        return (
            "mixed-needs-attention",
            "stage-userscript-import",
            "Userscript manager exists, but native fallback is absent and no staged userscript import file is present.",
        )
    return (
        "mixed-needs-attention",
        "open-acceptance-url",
        "The machine has partial autosure UI capability, but the carrier state still needs explicit acceptance confirmation.",
    )



def verify_payload(target_dir: Path) -> dict:
    index_path = default_control_ui_index()
    native = detect_native_patch(index_path)
    backups = detect_native_backups(index_path)
    managers = detect_userscript_managers(primary_profile_root())
    staged = detect_staged_userscript(target_dir)
    recommended_carrier = "userscript" if managers["present"] else "native-fallback"
    status_summary, recommended_action, carrier_diagnosis = summarize_status(native, managers, staged, recommended_carrier)
    payload = {
        "ok": native["ok"] and staged["sourceExists"],
        "workspace": str(workspace_root()),
        "primaryProfile": str(primary_profile_root()),
        "acceptanceUrl": acceptance_url(debug=True),
        "statusSummary": status_summary,
        "recommendedAction": recommended_action,
        "carrierDiagnosis": carrier_diagnosis,
        "nativePatch": native,
        "nativeBackups": backups,
        "userscriptManagers": managers,
        "userscript": staged,
        "recommendedCarrier": recommended_carrier,
        "notes": [],
        "nextSteps": [],
    }
    if not managers["present"]:
        payload["notes"].append("No userscript manager detected in the 007 primary browser profile; userscript visual acceptance is currently carrier-blocked.")
    if native["present"]:
        payload["notes"].append("Native fallback is currently installed in local OpenClaw Control UI.")
    else:
        payload["notes"].append("Native fallback is not currently installed in local OpenClaw Control UI.")
    if staged["stagedExists"]:
        payload["notes"].append("A userscript file is already staged for import.")
    elif staged["sourceExists"]:
        payload["notes"].append("Userscript source exists, but no staged import file is present yet.")
    if backups["installBackup"]["exists"]:
        payload["notes"].append("An install-time native backup is available for rollback.")
    if backups["removeBackup"]["exists"]:
        payload["notes"].append("A remove-time native backup is available for restore/reference.")
    payload["nextSteps"] = build_next_steps(native, managers, staged)
    return payload


def stage_userscript(target_dir: Path) -> int:
    src = userscript_source()
    if not src.exists():
        raise FileNotFoundError(f"userscript source missing: {src}")
    target_dir.mkdir(parents=True, exist_ok=True)
    dst = target_dir / "autosure-capsule.user.js"
    shutil.copy2(src, dst)
    print(json.dumps({
        "ok": True,
        "action": "stage-userscript",
        "source": str(src),
        "target": str(dst),
    }, ensure_ascii=False, indent=2))
    return 0


def disable_staged_userscript(target_dir: Path) -> int:
    staged = target_dir / "autosure-capsule.user.js"
    disabled = target_dir / "autosure-capsule.user.js.disabled"
    if staged.exists():
        staged.rename(disabled)
        print(json.dumps({
            "ok": True,
            "action": "disable-userscript",
            "target": str(disabled),
        }, ensure_ascii=False, indent=2))
        return 0
    print(json.dumps({
        "ok": True,
        "action": "disable-userscript",
        "detail": f"No staged userscript at {staged}",
    }, ensure_ascii=False, indent=2))
    return 0


def run_patch(action: str) -> int:
    script = skill_root() / "scripts" / "patch_control_ui.py"
    actual_action = "reinstall" if action == "install" else action
    rc, out, err = run_cmd([sys.executable, str(script), actual_action])
    payload = {
        "ok": rc == 0,
        "action": f"native-{action}",
        "executedAction": actual_action,
        "stdout": out,
        "stderr": err,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return rc


def native_rollback(index_path: Path) -> int:
    backup = native_install_backup_path(index_path)
    if not backup.exists():
        print(json.dumps({
            "ok": False,
            "action": "native-rollback",
            "detail": f"install-time backup missing: {backup}",
        }, ensure_ascii=False, indent=2))
        return 1
    shutil.copy2(index_path, index_path.with_suffix(index_path.suffix + ".rollback.bak"))
    shutil.copy2(backup, index_path)
    print(json.dumps({
        "ok": True,
        "action": "native-rollback",
        "restoredFrom": str(backup),
        "target": str(index_path),
        "preRollbackBackup": str(index_path.with_suffix(index_path.suffix + ".rollback.bak")),
    }, ensure_ascii=False, indent=2))
    return 0


def open_acceptance(debug: bool) -> int:
    url = acceptance_url(debug=debug)
    rc, out, err = run_cmd(["open", url])
    payload = {
        "ok": rc == 0,
        "action": "open-acceptance-url",
        "url": url,
        "stdout": out,
        "stderr": err,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return rc


def main() -> int:
    ap = argparse.ArgumentParser(description="Autosure Repair Center / carrier doctor")
    ap.add_argument(
        "action",
        choices=(
            "verify",
            "native-install",
            "native-uninstall",
            "native-rollback",
            "stage-userscript",
            "disable-userscript",
            "open-acceptance-url",
        ),
    )
    ap.add_argument(
        "--target-dir",
        type=Path,
        default=Path(os.environ.get("AUTOSURE_TAMPERMONKEY_DIR", str(Path.home() / "Downloads"))).expanduser(),
        help="Directory used for staging autosure-capsule.user.js",
    )
    ap.add_argument("--normal", action="store_true", help="Use normal acceptance URL without autosureDebug=1")
    args = ap.parse_args()

    target_dir = args.target_dir.expanduser().resolve()

    if args.action == "verify":
        payload = verify_payload(target_dir)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0 if payload["ok"] else 1
    if args.action == "stage-userscript":
        return stage_userscript(target_dir)
    if args.action == "disable-userscript":
        return disable_staged_userscript(target_dir)
    if args.action == "native-install":
        return run_patch("install")
    if args.action == "native-uninstall":
        return run_patch("uninstall")
    if args.action == "native-rollback":
        return native_rollback(default_control_ui_index())
    return open_acceptance(debug=not args.normal)


if __name__ == "__main__":
    raise SystemExit(main())
