#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
from pathlib import Path


PLUGIN_BY_MODE = {
    "full": "autosure-resume",
    "lite": "auto-resume-lite",
}
LEGACY_PLUGIN_DIR_ALIASES = {
    "autosure-resume": (),
    "auto-resume-lite": ("openclaw-auto-resume-lite",),
}


def run_cmd(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def skill_root() -> Path:
    return Path(__file__).resolve().parents[1]


def workspace_root() -> Path:
    env_ws = (os.environ.get("OPENCLAW_WORKSPACE") or "").strip()
    if env_ws:
        return Path(env_ws).expanduser()
    return Path.home() / ".openclaw" / "workspace"


def detail_text(out: str, err: str) -> str:
    return (out or err or "").strip()[:4000]


def plugin_installed_in_workspace(ws: Path, plugin_name: str) -> Path:
    return ws / "plugins" / plugin_name


def legacy_plugin_paths(ws: Path, plugin_name: str) -> list[Path]:
    return [ws / "plugins" / alias for alias in LEGACY_PLUGIN_DIR_ALIASES.get(plugin_name, ())]


def parse_install_path(inspect_output: str) -> Path | None:
    match = re.search(r"^Install path:\s*(.+)$", inspect_output, re.MULTILINE)
    if not match:
        return None
    return Path(match.group(1).strip()).expanduser()


def main() -> int:
    ap = argparse.ArgumentParser(description="Verify Autosure bundle health inside an OpenClaw workspace.")
    ap.add_argument(
        "--mode",
        choices=("full", "lite"),
        default="full",
        help="full=check autosure-resume. lite=check auto-resume-lite.",
    )
    args = ap.parse_args()

    checks = []
    root = skill_root()
    ws = workspace_root()
    active_plugin = PLUGIN_BY_MODE[args.mode]
    inactive_plugin = PLUGIN_BY_MODE["lite" if args.mode == "full" else "full"]
    bundle_expected_path = plugin_installed_in_workspace(ws, active_plugin)
    legacy_paths = legacy_plugin_paths(ws, active_plugin)

    rc, out, err = run_cmd(["openclaw", "-V"])
    checks.append(("openclaw_version", rc == 0, detail_text(out, err)))

    rc, out, err = run_cmd(["openclaw", "plugins", "inspect", active_plugin])
    inspect_ok = rc == 0 and "Status: loaded" in out
    checks.append(("plugin_loaded", inspect_ok, detail_text(out, err)))

    actual_install_path = parse_install_path(out) if inspect_ok else None
    if actual_install_path is not None:
        checks.append(("plugin_install_path_discovered", True, str(actual_install_path)))

    rc, out, err = run_cmd(["openclaw", "config", "get", f"plugins.entries.{active_plugin}"])
    expected_tokens = {
        "autosure-resume": ("autosure-resume", "enabled", "maxAutoResumes", "loopIdleGraceMs", "commandMaxRounds"),
        "auto-resume-lite": ("auto-resume-lite", "enabled", "cooldownMs"),
    }[active_plugin]
    ok = rc == 0 and any(token in out for token in expected_tokens)
    checks.append(("plugin_config_present", ok, detail_text(out, err)))

    state_file = Path.home() / ".openclaw" / "plugins" / active_plugin / "state.json"
    checks.append(("state_file_path_known", True, str(state_file)))

    phrases = ws / "skills" / "autosure" / "发动词.txt"
    checks.append(
        (
            "phrases_file",
            phrases.is_file(),
            str(phrases) if phrases.is_file() else f"missing: {phrases} (plugin can fall back to built-in defaults)",
        )
    )

    vendored = root / "vendor" / active_plugin / "index.js"
    checks.append(
        (
            "skill_bundle_vendor_plugin",
            vendored.is_file(),
            str(vendored) if vendored.is_file() else f"missing pack file: {vendored}",
        )
    )

    canonical_present = bundle_expected_path.is_dir()
    legacy_present_paths = [path for path in legacy_paths if path.is_dir()]
    expected_ok = canonical_present or bool(legacy_present_paths)
    expected_detail = str(bundle_expected_path) if canonical_present else f"canonical missing: {bundle_expected_path}"
    if not canonical_present and legacy_present_paths:
        expected_detail += f"; legacy present: {', '.join(str(path) for path in legacy_present_paths)}"
    checks.append(("bundle_or_legacy_install_path_present", expected_ok, expected_detail))

    installed_dir = actual_install_path or bundle_expected_path
    if actual_install_path is not None and actual_install_path != bundle_expected_path:
        checks.append(
            (
                "plugin_loaded_from_alternate_path",
                True,
                f"loaded from alternate path: {actual_install_path} (canonical bundle target: {bundle_expected_path})",
            )
        )

    checks.append(
        (
            "active_plugin_path_present",
            installed_dir.is_dir(),
            str(installed_dir) if installed_dir.is_dir() else f"missing installed plugin path: {installed_dir}",
        )
    )

    installed_index = installed_dir / "index.js"
    checks.append(
        (
            "active_plugin_entry_present",
            installed_index.is_file(),
            str(installed_index) if installed_index.is_file() else f"missing installed entry file: {installed_index}",
        )
    )

    if installed_index.is_file() and vendored.is_file():
        same = installed_index.read_text(encoding="utf-8") == vendored.read_text(encoding="utf-8")
        checks.append(
            (
                "active_plugin_matches_vendor",
                same,
                f"{installed_index} matches skill vendor copy" if same else "installed plugin differs from vendored copy; re-run install_bundle.py or sync vendor first",
            )
        )
    else:
        checks.append(
            (
                "active_plugin_matches_vendor",
                False,
                "comparison skipped because installed entry or vendored entry is missing",
            )
        )

    inactive_path = plugin_installed_in_workspace(ws, inactive_plugin)
    checks.append(
        (
            "inactive_plugin_presence_note",
            True,
            f"inactive plugin path {'present' if inactive_path.exists() else 'absent'}: {inactive_path}",
        )
    )

    capsule = root / "ui-capsule" / "repair-pack" / "autosure-capsule.user.js"
    checks.append(
        (
            "ui_capsule_pack_optional",
            capsule.is_file(),
            str(capsule) if capsule.is_file() else f"optional missing: {capsule}",
        )
    )

    payload = {
        "ok": all(item[1] for item in checks),
        "mode": args.mode,
        "activePlugin": active_plugin,
        "workspace": str(ws),
        "checks": [
            {"name": name, "ok": ok_item, "detail": detail}
            for (name, ok_item, detail) in checks
        ],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
