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

# macOS: also back up Info.plist. We rewrite its ElectronAsarIntegrity hash
# below; uninstall.sh restores this so the original asar+hash pair matches again
# (restoring only app.asar would leave the modified hash and crash the app).
if [ "$OS" = "Darwin" ]; then
  INFO_BACKUP="$(dirname "$(dirname "$ASAR")")/Info.plist.chat-input-extension-backup"
  APP_INFO="$(dirname "$(dirname "$(dirname "$ASAR")")")/Contents/Info.plist"
  [ -f "$INFO_BACKUP" ] || cp "$APP_INFO" "$INFO_BACKUP"
fi

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
  # Decode as UTF-8, not latin-1: atob() yields a byte string, so multi-byte
  # UTF-8 chars in the payload would corrupt (e.g. "·" -> "Â·").
  printf ';(function(){try{var src=new TextDecoder().decode(Uint8Array.from(atob("%s"),function(c){return c.charCodeAt(0);}));' "$PAYLOAD_B64"
  printf 'var wf=null;try{wf=require("electron").webFrame;}catch(e){}'
  printf 'var inline=function(){try{var el=document.createElement("script");el.textContent=src;(document.head||document.documentElement).appendChild(el);el.remove();}catch(e){}};'
  printf 'if(!wf){if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){setTimeout(inline,1500);});else setTimeout(inline,1500);return;}'
  printf 'var n=0;var iv=setInterval(function(){n++;'
  printf 'wf.executeJavaScript("!!document.querySelector(\\".tiptap.ProseMirror\\")").then(function(ready){'
  printf 'if(ready){clearInterval(iv);wf.executeJavaScript(src);}else if(n>120){clearInterval(iv);}}).catch(function(){});'
  printf '},500);}catch(e){console.warn("[chat-input-extension loader]",e);}})();\n'
} >> "$PRELOAD"

echo "==> Repacking"
# Native code MUST stay on disk in app.asar.unpacked — it can't be dlopen'd from
# inside an asar. --unpack takes a GLOB (relative to source, matched by
# basename), NOT a destination path; the old --unpack-dir <path> matched nothing
# and silently packed the binaries inline. Claude's unpacked set is *.node +
# *.dylib + node-pty's extensionless spawn-helper; this glob reproduces it.
npx --yes @electron/asar pack "$WORK" "$ASAR" --unpack "{*.node,*.dylib,spawn-helper}"

if [ "$OS" = "Darwin" ]; then
  APP="$(dirname "$(dirname "$(dirname "$ASAR")")")"
  INFO_PLIST="$APP/Contents/Info.plist"

  # STEP A — Update the Electron ASAR integrity hash. Info.plist embeds a
  # SHA-256 of app.asar's header; Electron FATAL-aborts (SIGTRAP) at startup on
  # mismatch. Any edit to app.asar changes the header, so this MUST be updated
  # or the app crash-loops on launch. Hasher matches @electron/asar
  # getRawHeader()+sha256, parsing the pickle header directly (no extra deps).
  echo "==> Updating ElectronAsarIntegrity hash in Info.plist"
  NEWHASH="$(node -e '
    const fs=require("fs"),c=require("crypto");
    const fd=fs.openSync(process.argv[1],"r");
    const b1=Buffer.alloc(8); fs.readSync(fd,b1,0,8,0);
    const size=b1.readUInt32LE(4);
    const b2=Buffer.alloc(size); fs.readSync(fd,b2,0,size,8);
    const n=b2.readUInt32LE(4);
    const s=b2.toString("utf8",8,8+n);
    fs.closeSync(fd);
    process.stdout.write(c.createHash("sha256").update(s).digest("hex"));
  ' "$ASAR")"
  if [ -z "$NEWHASH" ]; then
    echo "failed to compute asar hash; restoring backup"; cp "$BACKUP" "$ASAR"; exit 1
  fi
  /usr/libexec/PlistBuddy -c \
    "Set :ElectronAsarIntegrity:Resources/app.asar:hash $NEWHASH" "$INFO_PLIST" || {
      echo "failed to set integrity hash; restoring backup"; cp "$BACKUP" "$ASAR"; exit 1
    }

  # STEP B — Re-sign ad-hoc, innermost-first (NOT --deep, which breaks framework
  # seals; NO hardened runtime, which AMFI rejects for an ad-hoc signature).
  echo "==> Re-signing ad-hoc (inner->outer, no hardened runtime)"
  sign_one() { codesign --force --sign - "$1"; }
  RESIGN_OK=1
  while IFS= read -r -d '' dylib; do
    sign_one "$dylib" || { RESIGN_OK=0; break; }
  done < <(find "$APP/Contents/Frameworks" -name "*.dylib" -type f -print0 2>/dev/null)
  if [ "$RESIGN_OK" = 1 ]; then
    for fw in "$APP"/Contents/Frameworks/*.framework; do
      [ -d "$fw" ] && { sign_one "$fw" || { RESIGN_OK=0; break; }; }
    done
  fi
  if [ "$RESIGN_OK" = 1 ]; then
    for helper in "$APP"/Contents/Frameworks/*.app; do
      [ -d "$helper" ] && { sign_one "$helper" || { RESIGN_OK=0; break; }; }
    done
  fi
  [ "$RESIGN_OK" = 1 ] && { sign_one "$APP" || RESIGN_OK=0; }
  if [ "$RESIGN_OK" != 1 ]; then
    echo "codesign failed; restoring backup"; cp "$BACKUP" "$ASAR"; exit 1
  fi
  echo "==> Verifying signature"
  codesign --verify --deep --strict "$APP" 2>&1 || echo "   (warning: strict verify reported issues)"
else
  echo "==> Skipping code-signing step (not applicable on $OS)"
fi

rm -rf "$WORK"
echo "==> Done. Launch Claude — chat-input-extension loads automatically."
echo "    Remove any time from a running app with: window.__chatInputExtension.destroy()"
echo "    To remove the auto-load patch entirely: ./uninstall.sh"
