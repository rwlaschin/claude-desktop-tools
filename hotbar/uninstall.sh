#!/usr/bin/env bash
# Restore the original Claude app.asar and remove the hotbar patch.
set -euo pipefail

APP="/Applications/Claude.app"
ASAR="$APP/Contents/Resources/app.asar"
BACKUP="$ASAR.hotbar-backup"

[ -f "$BACKUP" ] || { echo "No backup found at $BACKUP — nothing to restore."; exit 1; }

if pgrep -x "Claude" >/dev/null; then
  echo "Claude is running. Quit it first (Cmd+Q), then re-run."; exit 1
fi

echo "==> Restoring original app.asar"
cp "$BACKUP" "$ASAR"
rm -f "$BACKUP"

echo "==> Re-signing ad-hoc"
codesign --force --deep --sign - "$APP" || true

echo "==> Done. The hotbar patch is removed."
