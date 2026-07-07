#!/usr/bin/env bash
# Restore app.asar to its state before chat-input-extension's auto-load patch.
# (Independent of hotbar/'s installer/backup — this only reverts this tool's
# own patch.)
set -euo pipefail

APP="/Applications/Claude.app"
ASAR="$APP/Contents/Resources/app.asar"
BACKUP="$ASAR.chat-input-extension-backup"

[ -f "$BACKUP" ] || { echo "No backup found at $BACKUP — nothing to restore."; exit 1; }

if pgrep -x "Claude" >/dev/null; then
  echo "Claude is running. Quit it first (Cmd+Q), then re-run."; exit 1
fi

echo "==> Restoring app.asar to its pre-chat-input-extension state"
cp "$BACKUP" "$ASAR"
rm -f "$BACKUP"

echo "==> Re-signing ad-hoc"
codesign --force --deep --sign - "$APP" || true

echo "==> Done. The chat-input-extension auto-load patch is removed."
