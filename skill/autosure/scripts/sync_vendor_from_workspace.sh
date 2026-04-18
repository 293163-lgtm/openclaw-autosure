#!/usr/bin/env bash
# Maintainer: refresh vendor/autosure-resume from the live workspace plugin tree.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}/plugins/autosure-resume"
DST="$ROOT/vendor/autosure-resume"
if [[ ! -d "$SRC" ]]; then
  echo "Source missing: $SRC" >&2
  exit 1
fi
rm -rf "$DST"
cp -R "$SRC" "$DST"
echo "OK synced $SRC -> $DST"
