#!/usr/bin/env bash
# Restore app.asar to its state before chat-input-extension's auto-load patch.
# Supports macOS and Linux. Independent of hotbar/'s installer/backup — this
# only reverts this tool's own patch.
set -euo pipefail

OS="$(uname -s)"

detect_asar() {
  case "$OS" in
    Darwin)
      for app in "/Applications/Claude.app" "$HOME/Applications/Claude.app"; do
        if [ -f "$app/Contents/Resources/app.asar.chat-input-extension-backup" ]; then
          echo "$app/Contents/Resources/app.asar"
          return 0
        fi
      done
      ;;
    Linux)
      for asar in \
        "/usr/lib/claude-desktop/resources/app.asar" \
        "/usr/lib/claude-desktop/app.asar" \
        "/opt/Claude/resources/app.asar" \
        "/opt/claude-desktop/resources/app.asar"
      do
        if [ -f "$asar.chat-input-extension-backup" ]; then
          echo "$asar"
          return 0
        fi
      done
      ;;
  esac
  return 1
}

is_running() {
  case "$OS" in
    Darwin) pgrep -x "Claude" >/dev/null 2>&1 ;;
    Linux)  pgrep -x "claude-desktop" >/dev/null 2>&1 ;;
    *)      return 1 ;;
  esac
}

ASAR="$(detect_asar)" || { echo "No chat-input-extension backup found on this system (uname: $OS) — nothing to restore."; exit 1; }
BACKUP="$ASAR.chat-input-extension-backup"

if is_running; then
  echo "Claude is running. Quit it first, then re-run."; exit 1
fi

echo "==> Restoring app.asar to its pre-chat-input-extension state ($ASAR)"
cp "$BACKUP" "$ASAR"
rm -f "$BACKUP"

if [ "$OS" = "Darwin" ]; then
  echo "==> Re-signing ad-hoc"
  APP="$(dirname "$(dirname "$(dirname "$ASAR")")")"
  codesign --force --deep --sign - "$APP" || true
fi

echo "==> Done. The chat-input-extension auto-load patch is removed."
