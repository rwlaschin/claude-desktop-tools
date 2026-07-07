#!/usr/bin/env bash
# Patch the Claude desktop app so chat-input-extension.js auto-loads on every
# launch.
#
# WHAT IT DOES
#   - Backs up app.asar (one-time, alongside the original)
#   - Injects a tiny loader into the mainView.js preload that runs
#     chat-input-extension.js in the page's main world after load
#   - Re-signs the app ad-hoc so macOS will still launch it
#
# CAVEATS (read before running)
#   - Modifying the app breaks Anthropic's code signature; this script re-signs
#     ad-hoc so it launches, but this is unsupported by Anthropic.
#   - A Claude app UPDATE replaces app.asar and wipes this patch. Re-run after updates.
#   - Quit Claude completely before running.
#   - Independent of hotbar/'s installer — each tool backs up and patches
#     under its own marker/backup file, so installing/uninstalling one does
#     not touch the other's patch.
#
# Reverse with: ./uninstall.sh
set -euo pipefail

APP="/Applications/Claude.app"
ASAR="$APP/Contents/Resources/app.asar"
BACKUP="$ASAR.chat-input-extension-backup"
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_JS="$HERE/chat-input-extension.js"
WORK="$(mktemp -d)"

[ -f "$ASAR" ]      || { echo "app.asar not found at $ASAR"; exit 1; }
[ -f "$SCRIPT_JS" ] || { echo "chat-input-extension.js not found next to this script"; exit 1; }

if pgrep -x "Claude" >/dev/null; then
  echo "Claude is running. Quit it first (Cmd+Q), then re-run."; exit 1
fi

echo "==> Backing up app.asar"
[ -f "$BACKUP" ] || cp "$ASAR" "$BACKUP"

echo "==> Extracting"
npx --yes @electron/asar extract "$ASAR" "$WORK"

PRELOAD="$WORK/.vite/build/mainView.js"
[ -f "$PRELOAD" ] || { echo "mainView.js not found — app layout changed; aborting"; exit 1; }

if grep -q "__CLAUDE_CHAT_INPUT_EXTENSION_LOADER__" "$PRELOAD"; then
  echo "==> Loader already present, refreshing payload"
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
# strip any stale patched asar then rebuild from working dir
npx --yes @electron/asar pack "$WORK" "$ASAR" \
  --unpack-dir "$APP/Contents/Resources/app.asar.unpacked" 2>/dev/null || \
  npx --yes @electron/asar pack "$WORK" "$ASAR"

echo "==> Re-signing ad-hoc"
codesign --force --deep --sign - "$APP" || {
  echo "codesign failed; restoring backup"; cp "$BACKUP" "$ASAR"; exit 1;
}

rm -rf "$WORK"
echo "==> Done. Launch Claude — chat-input-extension loads automatically."
echo "    Remove any time from a running app with: window.__chatInputExtension.destroy()"
echo "    To remove the auto-load patch entirely: ./uninstall.sh"
