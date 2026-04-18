#!/usr/bin/env python3
"""
Autosure OpenClaw bundle installer.
Copies vendored plugins from this skill into OPENCLAW_WORKSPACE/plugins and prints merge hints for openclaw.json.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path


PLUGIN_NAMES = ("autosure-resume", "auto-resume-lite")
LEGACY_PLUGIN_DIR_ALIASES = {
    "autosure-resume": (),
    "auto-resume-lite": ("openclaw-auto-resume-lite",),
}


def skill_root() -> Path:
    return Path(__file__).resolve().parents[1]


def default_workspace() -> Path:
    env = (os.environ.get("OPENCLAW_WORKSPACE") or "").strip()
    if env:
        return Path(env).expanduser()
    return Path.home() / ".openclaw" / "workspace"


def ensure_workspace_root(ws: Path) -> None:
    if not ws.exists():
        ws.mkdir(parents=True, exist_ok=True)
    if not ws.is_dir():
        raise NotADirectoryError(f"workspace is not a directory: {ws}")


def backup_dir(dst: Path, dry: bool) -> Path | None:
    if not dst.exists():
        return None
    backup = dst.with_name(f"{dst.name}.bak")
    if dry:
        print(f"[dry-run] would backup existing plugin: {dst} -> {backup}")
        return backup
    if backup.exists():
        shutil.rmtree(backup)
    shutil.copytree(dst, backup)
    print(f"OK backup: {backup}")
    return backup


def copytree(src: Path, dst: Path, dry: bool) -> Path | None:
    backup = backup_dir(dst, dry)
    if dry:
        print(f"[dry-run] would sync: {src} -> {dst}")
        return backup
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    print(f"OK copied: {dst}")
    return backup


def sync_legacy_aliases(src: Path, plugins_dir: Path, plugin_name: str, dry: bool) -> list[tuple[Path, Path | None]]:
    synced: list[tuple[Path, Path | None]] = []
    for alias in LEGACY_PLUGIN_DIR_ALIASES.get(plugin_name, ()):
        alias_dst = plugins_dir / alias
        if not alias_dst.exists():
            continue
        backup = copytree(src, alias_dst, dry)
        synced.append((alias_dst, backup))
    return synced


def inactive_plugin_name(mode: str) -> str:
    return "auto-resume-lite" if mode == "full" else "autosure-resume"


def build_snippet(mode: str, plugin_path: Path) -> dict:
    resolved = str(plugin_path.resolve())
    if mode == "full":
        return {
            "plugins": {
                "allow": ["autosure-resume"],
                "entries": {
                    "autosure-resume": {
                        "enabled": True,
                        "config": {
                            "maxAutoResumes": 1,
                            "cooldownMs": 15000,
                            "compressionWaitMs": 60000,
                            "circuitThreshold": 3,
                            "circuitOpenMs": 120000,
                            "dedupeTtlMs": 120000,
                            "enableNonActionResume": False,
                            "commandMaxRounds": 1000000,
                            "demoInjectRounds": 2,
                            "loopIdleGraceMs": 15000,
                        },
                    },
                    "auto-resume-lite": {
                        "enabled": False,
                        "config": {
                            "cooldownMs": 20000,
                        },
                    },
                },
                "load": {"paths": [resolved]},
            }
        }
    return {
        "plugins": {
            "allow": ["auto-resume-lite"],
            "entries": {
                "auto-resume-lite": {
                    "enabled": True,
                    "config": {"enabled": True, "cooldownMs": 20000},
                },
                "autosure-resume": {
                    "enabled": False,
                    "config": {
                        "maxAutoResumes": 1,
                        "cooldownMs": 15000,
                        "compressionWaitMs": 60000,
                        "circuitThreshold": 3,
                        "circuitOpenMs": 120000,
                        "dedupeTtlMs": 120000,
                        "enableNonActionResume": False,
                        "commandMaxRounds": 1000000,
                        "demoInjectRounds": 2,
                        "loopIdleGraceMs": 15000,
                    },
                },
            },
            "load": {"paths": [resolved]},
        }
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Install Autosure vendored plugins into OpenClaw workspace.")
    ap.add_argument(
        "--workspace",
        type=Path,
        default=None,
        help="OpenClaw workspace root (default: OPENCLAW_WORKSPACE or ~/.openclaw/workspace)",
    )
    ap.add_argument(
        "--mode",
        choices=("full", "lite"),
        default="full",
        help="full=autosure-resume only (recommended). lite=auto-resume-lite only (minimal).",
    )
    ap.add_argument("--dry-run", action="store_true", help="Print actions without writing files.")
    args = ap.parse_args()

    root = skill_root()
    vendor = root / "vendor"
    ws = (args.workspace or default_workspace()).expanduser().resolve()
    plugins_dir = ws / "plugins"
    dry = args.dry_run

    if not vendor.is_dir():
        print("vendor/ missing — skill pack incomplete", file=sys.stderr)
        return 2

    ensure_workspace_root(ws)
    plugins_dir.mkdir(parents=True, exist_ok=True)

    print(f"Skill root:   {root}")
    print(f"Workspace:    {ws}")
    print(f"Plugins dir:  {plugins_dir}")
    print(f"Mode:         {args.mode}")
    print(f"Dry run:      {dry}")
    print()

    selected = "autosure-resume" if args.mode == "full" else "auto-resume-lite"
    src = vendor / selected
    if not src.is_dir():
        print(f"vendor/{selected} missing", file=sys.stderr)
        return 2

    dst = plugins_dir / selected
    backup = copytree(src, dst, dry)
    legacy_synced = sync_legacy_aliases(src, plugins_dir, selected, dry)
    inactive = inactive_plugin_name(args.mode)
    inactive_dst = plugins_dir / inactive
    inactive_note = f"Inactive plugin directory still present: {inactive_dst}" if inactive_dst.exists() else f"Inactive plugin directory not installed: {inactive_dst}"

    snippet = build_snippet(args.mode, dst)

    print()
    print("--- Merge the following into ~/.openclaw/openclaw.json ---")
    print(json.dumps(snippet, ensure_ascii=False, indent=2))
    print("--- end snippet ---")
    print()
    print("Merge rules:")
    print(f"- Append plugins.allow with '{selected}' instead of replacing existing items.")
    print(f"- Append plugins.load.paths with '{dst.resolve()}' if not already present.")
    if legacy_synced:
        legacy_paths = ", ".join(str(path) for path, _ in legacy_synced)
        print(f"- Legacy compatible path(s) refreshed in place: {legacy_paths}")
        print("- If your openclaw.json still points to a legacy lite path, it can keep working; prefer migrating load.paths to the canonical autosure path above.")
    print(f"- Keep '{inactive}' disabled in plugins.entries (do not enable both autosure plugins).")
    print(f"- {inactive_note}")
    if backup is not None:
        print(f"- Backup created for rollback: {backup}")
    if legacy_synced:
        for legacy_path, legacy_backup in legacy_synced:
            if legacy_backup is not None:
                print(f"- Legacy rollback backup: {legacy_backup}")
    print()
    print("Next commands:")
    print("- openclaw config validate")
    print(f"- openclaw plugins inspect {selected}")
    print("- openclaw daemon restart   # or your service manager")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

