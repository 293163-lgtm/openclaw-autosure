#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${AUTOSURE_TAMPERMONKEY_DIR:-$HOME/Downloads}"
TARGET="$TARGET_DIR/autosure-capsule.user.js"
DISABLED="$TARGET_DIR/autosure-capsule.user.js.disabled"

if [[ -f "$TARGET" ]]; then
  mv "$TARGET" "$DISABLED"
  echo "Autosure capsule file renamed for disable workflow: $DISABLED"
else
  echo "No staged userscript file found at: $TARGET"
  echo "If the script is already installed in Tampermonkey, disable it there manually."
fi
