#!/usr/bin/env bash
# Patch the Claude desktop app so chat-input-extension.js auto-loads on every
# launch.
#
# WHAT IT DOES
#   - Locates app.asar (macOS or Linux; see detect_asar below)
#   - Backs up app.asar (one-time, alongside the original)
#   - Injects a tiny loader into the mainView.js preload that runs
#     chat-input-extension.js in the page's main world after load
#   - On macOS only: re-signs the app ad-hoc so macOS will still launch it
#
# PLATFORMS
#   - macOS: supported, tested against /Applications/Claude.app and
#     ~/Applications/Claude.app.
#   - Linux: supported against the official apt package's install location
#     (/usr/lib/claude-desktop) — added based on documented install paths,
#     not verified against a live Linux install. If it doesn't find your
#     app.asar, edit the CANDIDATES list below or open an issue with the
#     real path.
#   - Windows: not supported by this script (bash + codesign don't apply).
#
# CAVEATS (read before running)
#   - On macOS, modifying the app breaks Anthropic's code signature; this
#     script re-signs ad-hoc so it launches, but this is unsupported by
#     Anthropic. On Linux there's no equivalent signature check, but a
#     package manager integrity check (e.g. `dpkg -V claude-desktop`) will
#     now flag app.asar as modified — harmless, but expected.
#   - A Claude app UPDATE replaces app.asar and wipes this patch. Re-run after updates.
#   - Quit Claude completely before running.
#   - Independent of hotbar/'s installer — each tool backs up and patches
#     under its own marker/backup file, so installing/uninstalling one does
#     not touch the other's patch.
#
# Reverse with: ./uninstall.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_JS="$HERE/chat-input-extension.js"
OS="$(uname -s)"

detect_asar() {
  case "$OS" in
    Darwin)
      for app in "/Applications/Claude.app" "$HOME/Applications/Claude.app"; do
        if [ -f "$app/Contents/Resources/app.asar" ]; then
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
        if [ -f "$asar" ]; then
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

[ -f "$SCRIPT_JS" ] || { echo "chat-input-extension.js not found next to this script"; exit 1; }

ASAR="$(detect_asar)" || {
  echo "Could not find Claude's app.asar on this system (uname: $OS)."
  echo "Locations checked:"
  case "$OS" in
    Darwin) echo "  /Applications/Claude.app, ~/Applications/Claude.app" ;;
    Linux)  echo "  /usr/lib/claude-desktop, /opt/Claude, /opt/claude-desktop" ;;
    *)      echo "  (no candidates known for '$OS' — this script supports macOS and Linux only)" ;;
  esac
  echo "If Claude is installed somewhere else, edit detect_asar() in this script and re-run."
  exit 1
}
BACKUP="$ASAR.chat-input-extension-backup"
WORK="$(mktemp -d)"

echo "==> Found app.asar: $ASAR"

if is_running; then
  echo "Claude is running. Quit it first, then re-run."; exit 1
fi

echo "==> Backing up app.asar"
[ -f "$BACKUP" ] || cp "$ASAR" "$BACKUP"

echo "==> Extracting"
npx --yes @electron/asar extract "$ASAR" "$WORK"

PRELOAD="$WORK/.vite/build/mainView.js"
[ -f "$PRELOAD" ] || { echo "mainView.js not found — app layout changed; aborting"; exit 1; }

if grep -q "__CLAUDE_CHAT_INPUT_EXTENSION_LOADER__" "$PRELOAD"; then
  echo "==> Loader already present — removing before re-injecting fresh payload"
  # Each prior injection is exactly two lines: the marker comment, then the
  # one-line IIFE right after it. Strip every such pair (handles the case of
  # more than one stale copy from an earlier buggy run) before appending.
  awk -v m="__CLAUDE_CHAT_INPUT_EXTENSION_LOADER__" '
    $0 ~ m { skip=2; next }
    skip>0 { skip--; next }
    { print }
  ' "$PRELOAD" > "$PRELOAD.tmp" && mv "$PRELOAD.tmp" "$PRELOAD"
else
  echo "==> Injecting loader into preload"
fi

# Build the loader. chat-input-extension.js must run in the page's MAIN world
# (where the composer's .editor lives). claude.ai's CSP blocks injected inline
# <script>, so we prefer webFrame.executeJavaScript() from the preload — it
# runs in the main world and bypasses page CSP. Falls back to inline injection
# if webFrame isn't reachable. We poll (via the main world) until at least one
# composer instance has mounted.
PAYLOAD_B64="$(base64 < "$SCRIPT_JS" | tr -d '\n')"
{
  printf '\n/* __CLAUDE_CHAT_INPUT_EXTENSION_LOADER__ */\n'
  printf ';(function(){try{var src=atob("%s");' "$PAYLOAD_B64"
  printf 'var wf=null;try{wf=require("electron").webFrame;}catch(e){}'
  printf 'var inline=function(){try{var el=document.createElement("script");el.textContent=src;(document.head||document.documentElement).appendChild(el);el.remove();}catch(e){}};'
  printf 'if(!wf){if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){setTimeout(inline,1500);});else setTimeout(inline,1500);return;}'
  printf 'var n=0;var iv=setInterval(function(){n++;'
  printf 'wf.executeJavaScript("!!document.querySelector(\\".tiptap.ProseMirror\\")").then(function(ready){'
  printf 'if(ready){clearInterval(iv);wf.executeJavaScript(src);}else if(n>120){clearInterval(iv);}}).catch(function(){});'
  printf '},500);}catch(e){console.warn("[chat-input-extension loader]",e);}})();\n'
} >> "$PRELOAD"

echo "==> Repacking"
UNPACK_DIR="$(dirname "$ASAR")/app.asar.unpacked"
npx --yes @electron/asar pack "$WORK" "$ASAR" \
  --unpack-dir "$UNPACK_DIR" 2>/dev/null || \
  npx --yes @electron/asar pack "$WORK" "$ASAR"

if [ "$OS" = "Darwin" ]; then
  echo "==> Re-signing ad-hoc"
  APP="$(dirname "$(dirname "$(dirname "$ASAR")")")"
  codesign --force --deep --sign - "$APP" || {
    echo "codesign failed; restoring backup"; cp "$BACKUP" "$ASAR"; exit 1;
  }
else
  echo "==> Skipping code-signing step (not applicable on $OS)"
fi

rm -rf "$WORK"
echo "==> Done. Launch Claude — chat-input-extension loads automatically."
echo "    Remove any time from a running app with: window.__chatInputExtension.destroy()"
echo "    To remove the auto-load patch entirely: ./uninstall.sh"
