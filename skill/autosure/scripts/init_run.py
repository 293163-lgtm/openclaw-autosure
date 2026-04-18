#!/usr/bin/env python3
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser(description="Initialize autosure run card.")
    parser.add_argument("--run-id", required=True, help="Run identifier")
    parser.add_argument("--project", required=True, help="Project lane name")
    parser.add_argument("--root", required=True, help="Project root path")
    parser.add_argument(
        "--output-dir",
        default=str(Path.home() / ".openclaw" / "workspace" / "runs"),
        help="Base runs directory (default: ~/.openclaw/workspace/runs)",
    )
    args = parser.parse_args()

    run_dir = Path(args.output_dir) / args.run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    run_card = {
        "run_id": args.run_id,
        "project": args.project,
        "project_root": args.root,
        "created_at": utc_now(),
        "updated_at": utc_now(),
        "autosure": {
            "mode": "bounded-auto-resume",
            "max_auto_resumes": 1,
            "cooldown_ms": 15000,
            "circuit_threshold": 3,
            "circuit_open_ms": 120000,
            "compression_wait_ms": 60000,
        },
        "status": "initialized",
        "notes": [],
    }

    out = run_dir / "AUTOSURE-RUN.json"
    out.write_text(json.dumps(run_card, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"initialized: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
