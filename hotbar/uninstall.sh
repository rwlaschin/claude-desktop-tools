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
  APP="$(dirname "$(dirname "$(dirname "$ASAR")")")"

  # Restore the original Info.plist (install rewrote its ElectronAsarIntegrity
  # hash). Without this the restored original asar and the modified hash would
  # not match and Electron would crash on launch (SIGTRAP).
  INFO_BACKUP="$(dirname "$(dirname "$ASAR")")/Info.plist.hotbar-backup"
  if [ -f "$INFO_BACKUP" ]; then
    echo "==> Restoring original Info.plist"
    cp "$INFO_BACKUP" "$APP/Contents/Info.plist"
    rm -f "$INFO_BACKUP"
  fi

  # Re-sign ad-hoc, innermost-first (NOT --deep, which breaks framework seals;
  # NO hardened runtime, which AMFI rejects for an ad-hoc signature).
  echo "==> Re-signing ad-hoc"
  sign_one() { codesign --force --sign - "$1" >/dev/null 2>&1; }
  while IFS= read -r -d '' dylib; do sign_one "$dylib"; done \
    < <(find "$APP/Contents/Frameworks" -name "*.dylib" -type f -print0 2>/dev/null)
  for fw in "$APP"/Contents/Frameworks/*.framework; do [ -d "$fw" ] && sign_one "$fw"; done
  for helper in "$APP"/Contents/Frameworks/*.app; do [ -d "$helper" ] && sign_one "$helper"; done
  sign_one "$APP" || true
fi

echo "==> Done. The hotbar patch is removed."
