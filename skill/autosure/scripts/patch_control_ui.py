#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

SNIPPET_START = '    <script type="module" crossorigin src="./assets/index-D0pCc5YA.js"></script>'
MARKER_START = '    <script>\n      (function () {\n        var ROOT_ID = "autosure-native-capsule";'


def default_control_ui_index() -> Path:
    return Path.home() / '.volta' / 'tools' / 'image' / 'packages' / 'openclaw' / 'lib' / 'node_modules' / 'openclaw' / 'dist' / 'control-ui' / 'index.html'


def snippet_text(js_text: str) -> str:
    indented = '\n'.join('      ' + line if line else '' for line in js_text.rstrip().splitlines())
    return (
        '    <script>\n'
        f'{indented}\n'
        '    </script>\n'
        '    <script type="module" crossorigin src="./assets/index-D0pCc5YA.js"></script>'
    )


def install(index_path: Path, js_path: Path, dry_run: bool, force: bool = False) -> int:
    html = index_path.read_text(encoding='utf-8')
    if MARKER_START in html:
        if not force:
            print(f'Autosure native capsule already installed: {index_path}')
            return 0
        start = html.index(MARKER_START)
        end = html.index('    <script type="module" crossorigin src="./assets/index-D0pCc5YA.js"></script>', start)
        html = html[:start] + '    <script type="module" crossorigin src="./assets/index-D0pCc5YA.js"></script>' + html[end + len('    <script type="module" crossorigin src="./assets/index-D0pCc5YA.js"></script>'):]
    js_text = js_path.read_text(encoding='utf-8')
    marker = SNIPPET_START
    if marker not in html:
        raise RuntimeError(f'Cannot find control-ui module script tag in: {index_path}')
    patched = html.replace(marker, snippet_text(js_text), 1)
    backup = index_path.with_suffix(index_path.suffix + '.autosure.bak')
    if dry_run:
        print(f'[dry-run] would backup {index_path} -> {backup}')
        print(f'[dry-run] would inject native capsule from {js_path}')
        print('[dry-run] force reinstall enabled' if force else '[dry-run] normal install mode')
        return 0
    shutil.copy2(index_path, backup)
    index_path.write_text(patched, encoding='utf-8')
    if force:
        print(f'Backup refreshed: {backup}')
        print(f'Reinstalled autosure native capsule into: {index_path}')
    else:
        print(f'Backup created: {backup}')
        print(f'Installed autosure native capsule into: {index_path}')
    return 0


def uninstall(index_path: Path, dry_run: bool) -> int:
    html = index_path.read_text(encoding='utf-8')
    if MARKER_START not in html:
        print(f'Autosure native capsule not present: {index_path}')
        return 0
    start = html.index('    <script>\n      (function () {\n        var ROOT_ID = "autosure-native-capsule";')
    end = html.index('    <script type="module" crossorigin src="./assets/index-D0pCc5YA.js"></script>', start)
    patched = html[:start] + '    <script type="module" crossorigin src="./assets/index-D0pCc5YA.js"></script>' + html[end + len('    <script type="module" crossorigin src="./assets/index-D0pCc5YA.js"></script>'):]
    backup = index_path.with_suffix(index_path.suffix + '.autosure.remove.bak')
    if dry_run:
        print(f'[dry-run] would backup {index_path} -> {backup}')
        print(f'[dry-run] would remove native capsule block from {index_path}')
        return 0
    shutil.copy2(index_path, backup)
    index_path.write_text(patched, encoding='utf-8')
    print(f'Backup created: {backup}')
    print(f'Removed autosure native capsule from: {index_path}')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description='Install/remove autosure native fallback capsule into OpenClaw Control UI index.html')
    ap.add_argument('action', choices=['install', 'uninstall', 'reinstall'])
    ap.add_argument('--index', type=Path, default=default_control_ui_index(), help='Path to OpenClaw control-ui index.html')
    ap.add_argument('--js', type=Path, default=Path(__file__).resolve().parents[1] / 'ui-capsule' / 'repair-pack' / 'native-control-ui-capsule.js', help='Path to native capsule JS source')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--force', action='store_true', help='Replace existing autosure native capsule block if already installed')
    args = ap.parse_args()

    index_path = args.index.expanduser().resolve()
    if not index_path.exists():
        raise FileNotFoundError(f'control-ui index not found: {index_path}')

    if args.action in ('install', 'reinstall'):
        js_path = args.js.expanduser().resolve()
        if not js_path.exists():
            raise FileNotFoundError(f'native capsule source not found: {js_path}')
        return install(index_path, js_path, args.dry_run, force=(args.force or args.action == 'reinstall'))
    return uninstall(index_path, args.dry_run)


if __name__ == '__main__':
    raise SystemExit(main())
