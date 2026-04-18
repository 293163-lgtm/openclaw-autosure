#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$SCRIPT_DIR/autosure-capsule.user.js"
TARGET_DIR="${AUTOSURE_TAMPERMONKEY_DIR:-$HOME/Downloads}"
TARGET="$TARGET_DIR/autosure-capsule.user.js"

mkdir -p "$TARGET_DIR"
cp "$SRC" "$TARGET"

echo "Autosure capsule staged: $TARGET"
echo "Next: import this file into Tampermonkey (or double-click it if your browser is configured to open userscripts there)."
