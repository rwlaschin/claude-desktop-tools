#!/usr/bin/env bash
# Restore the original Claude app.asar and remove the hotbar patch.
# Supports macOS and Linux (see detect_asar in install-persist.sh for why).
set -euo pipefail

OS="$(uname -s)"

detect_asar() {
  case "$OS" in
    Darwin)
      for app in "/Applications/Claude.app" "$HOME/Applications/Claude.app"; do
        if [ -f "$app/Contents/Resources/app.asar.hotbar-backup" ]; then
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
        if [ -f "$asar.hotbar-backup" ]; then
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

ASAR="$(detect_asar)" || { echo "No hotbar backup found on this system (uname: $OS) — nothing to restore."; exit 1; }
BACKUP="$ASAR.hotbar-backup"

if is_running; then
  echo "Claude is running. Quit it first, then re-run."; exit 1
fi

echo "==> Restoring original app.asar ($ASAR)"
cp "$BACKUP" "$ASAR"
rm -f "$BACKUP"

if [ "$OS" = "Darwin" ]; then
  echo "==> Re-signing ad-hoc"
  APP="$(dirname "$(dirname "$(dirname "$ASAR")")")"
  codesign --force --deep --sign - "$APP" || true
fi

echo "==> Done. The hotbar patch is removed."
