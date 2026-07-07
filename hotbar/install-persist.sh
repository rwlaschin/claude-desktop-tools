#!/usr/bin/env bash
# Patch the Claude desktop app so the hotbar auto-loads on every launch.
#
# WHAT IT DOES
#   - Locates app.asar (macOS or Linux; see detect_asar below)
#   - Backs up app.asar (one-time, alongside the original)
#   - Injects a tiny loader into the mainView.js preload that runs hotbar.js
#     in the page's main world after load
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
#
# Reverse with: ./uninstall.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOTBAR_JS="$HERE/hotbar.js"
OS="$(uname -s)"

# Candidate app.asar locations to check, in order, per platform. macOS entries
# are full .app bundles (asar lives at Contents/Resources/app.asar inside);
# Linux entries are asar paths directly (no bundle concept).
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

[ -f "$HOTBAR_JS" ] || { echo "hotbar.js not found next to this script"; exit 1; }

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
BACKUP="$ASAR.hotbar-backup"
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
  INFO_BACKUP="$(dirname "$(dirname "$ASAR")")/Info.plist.hotbar-backup"
  APP_INFO="$(dirname "$(dirname "$(dirname "$ASAR")")")/Contents/Info.plist"
  [ -f "$INFO_BACKUP" ] || cp "$APP_INFO" "$INFO_BACKUP"
fi

echo "==> Extracting"
npx --yes @electron/asar extract "$ASAR" "$WORK"

PRELOAD="$WORK/.vite/build/mainView.js"
[ -f "$PRELOAD" ] || { echo "mainView.js not found — app layout changed; aborting"; exit 1; }

if grep -q "__CLAUDE_HOTBAR_LOADER__" "$PRELOAD"; then
  echo "==> Loader already present — removing before re-injecting fresh payload"
  # Each prior injection is exactly two lines: the marker comment, then the
  # one-line IIFE right after it. Strip every such pair (handles the case of
  # more than one stale copy from an earlier buggy run) before appending.
  awk -v m="__CLAUDE_HOTBAR_LOADER__" '
    $0 ~ m { skip=2; next }
    skip>0 { skip--; next }
    { print }
  ' "$PRELOAD" > "$PRELOAD.tmp" && mv "$PRELOAD.tmp" "$PRELOAD"
else
  echo "==> Injecting loader into preload"
fi

# Build the loader. hotbar.js must run in the page's MAIN world (where
# window['claude.web'] lives). claude.ai's CSP blocks injected inline <script>,
# so we prefer webFrame.executeJavaScript() from the preload — it runs in the
# main world and bypasses page CSP. Falls back to inline injection if webFrame
# isn't reachable. We poll (via the main world) until the bridge is exposed.
PAYLOAD_B64="$(base64 < "$HOTBAR_JS" | tr -d '\n')"
{
  printf '\n/* __CLAUDE_HOTBAR_LOADER__ */\n'
  # Decode as UTF-8, not latin-1: atob() yields a byte string, so multi-byte
  # UTF-8 chars in the payload (e.g. the "·" separator) would corrupt to "Â·".
  printf ';(function(){try{var src=new TextDecoder().decode(Uint8Array.from(atob("%s"),function(c){return c.charCodeAt(0);}));' "$PAYLOAD_B64"
  printf 'var wf=null;try{wf=require("electron").webFrame;}catch(e){}'
  printf 'var inline=function(){try{var el=document.createElement("script");el.textContent=src;(document.head||document.documentElement).appendChild(el);el.remove();}catch(e){}};'
  printf 'if(!wf){if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){setTimeout(inline,1500);});else setTimeout(inline,1500);return;}'
  printf 'var n=0;var iv=setInterval(function(){n++;'
  printf 'wf.executeJavaScript("!!(window[\\"claude.web\\"]&&window[\\"claude.web\\"].LocalSessions)").then(function(ready){'
  printf 'if(ready){clearInterval(iv);wf.executeJavaScript(src);}else if(n>120){clearInterval(iv);}}).catch(function(){});'
  printf '},500);}catch(e){console.warn("[hotbar loader]",e);}})();\n'
} >> "$PRELOAD"

echo "==> Repacking"
# Native code MUST stay on disk as real files in app.asar.unpacked — it can't
# be dlopen'd from inside an asar. --unpack takes a GLOB (relative to source,
# matched by basename), NOT a destination path; passing the app.asar.unpacked
# directory (as the old code did) matches nothing, silently packs the binaries
# inline, and the app fails to load them at runtime. Claude's unpacked set is
# *.node + *.dylib + node-pty's extensionless `spawn-helper`; this glob
# reproduces it exactly (verified against the pristine app.asar.unpacked).
npx --yes @electron/asar pack "$WORK" "$ASAR" --unpack "{*.node,*.dylib,spawn-helper}"

if [ "$OS" = "Darwin" ]; then
  APP="$(dirname "$(dirname "$(dirname "$ASAR")")")"
  INFO_PLIST="$APP/Contents/Info.plist"

  # ---------------------------------------------------------------------------
  # STEP A — Update the Electron ASAR integrity hash. THIS IS THE STEP WHOSE
  # ABSENCE CAUSED THE ORIGINAL CRASH LOOP.
  #
  # Info.plist embeds ElectronAsarIntegrity -> Resources/app.asar -> hash, a
  # SHA-256 of app.asar's *header* (the pickled JSON file table, not the whole
  # file). At startup Electron recomputes that hash and, on mismatch, calls a
  # FATAL abort (electron/shell/common/asar/asar_util.cc) which raises
  # SIGTRAP / EXC_BREAKPOINT and kills the app before any window appears. Any
  # edit to app.asar changes the header, so patching the asar WITHOUT updating
  # this hash guarantees a crash-on-launch loop. We recompute it here.
  #
  # The hasher parses the asar/chromium-pickle header directly (no extra deps)
  # and matches @electron/asar's getRawHeader()+sha256 exactly.
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
  echo "    new app.asar header hash: $NEWHASH"
  /usr/libexec/PlistBuddy -c \
    "Set :ElectronAsarIntegrity:Resources/app.asar:hash $NEWHASH" "$INFO_PLIST" || {
      echo "failed to set integrity hash in Info.plist; restoring backup"
      cp "$BACKUP" "$ASAR"; exit 1
    }

  # ---------------------------------------------------------------------------
  # STEP B — Re-sign ad-hoc. Modifying app.asar + Info.plist breaks Anthropic's
  # signature; macOS needs a valid (even if ad-hoc) signature to launch.
  #
  # DO NOT use `codesign --deep --sign -`: --deep re-signs a bundle before its
  # own nested Mach-Os, invalidating framework seals ("a sealed resource is
  # missing or invalid"). Sign explicitly innermost-first instead:
  #   inner dylibs -> frameworks -> helper apps -> outer app
  #
  # Plain ad-hoc, NO `--options runtime`, NO entitlements. Two reasons:
  #   * Ad-hoc + hardened runtime is rejected by AMFI at launch (SIGKILL),
  #     because ad-hoc is not a trusted signature for a hardened binary.
  #   * Without hardened runtime, V8's JIT works WITHOUT allow-jit and library
  #     validation is not enforced, so Claude's own native modules load fine.
  #   This matches how unsigned/dev Electron apps run locally.
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
  codesign --verify --deep --strict "$APP" 2>&1 || \
    echo "   (warning: strict verify reported issues)"
else
  echo "==> Skipping code-signing step (not applicable on $OS)"
fi

rm -rf "$WORK"
echo "==> Done. Launch Claude — the hotbar loads automatically."
echo "    To remove: ./uninstall.sh"
