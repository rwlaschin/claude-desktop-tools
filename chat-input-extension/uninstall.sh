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
  APP="$(dirname "$(dirname "$(dirname "$ASAR")")")"

  # Restore the Info.plist captured with this backup asar (install rewrote its
  # ElectronAsarIntegrity hash). The backup asar + backup Info.plist are a
  # matched pair, so the restored hash matches the restored asar; restoring only
  # app.asar would leave a mismatched hash and crash the app (SIGTRAP).
  INFO_BACKUP="$(dirname "$(dirname "$ASAR")")/Info.plist.chat-input-extension-backup"
  if [ -f "$INFO_BACKUP" ]; then
    echo "==> Restoring Info.plist"
    cp "$INFO_BACKUP" "$APP/Contents/Info.plist"
    rm -f "$INFO_BACKUP"
  fi

  # Re-sign ad-hoc, innermost-first (NOT --deep; NO hardened runtime).
  echo "==> Re-signing ad-hoc"
  sign_one() { codesign --force --sign - "$1" >/dev/null 2>&1; }
  while IFS= read -r -d '' dylib; do sign_one "$dylib"; done \
    < <(find "$APP/Contents/Frameworks" -name "*.dylib" -type f -print0 2>/dev/null)
  for fw in "$APP"/Contents/Frameworks/*.framework; do [ -d "$fw" ] && sign_one "$fw"; done
  for helper in "$APP"/Contents/Frameworks/*.app; do [ -d "$helper" ] && sign_one "$helper"; done
  sign_one "$APP" || true
fi

echo "==> Done. The chat-input-extension auto-load patch is removed."
