# claude-desktop-tools

Small tools and scripts that extend the Claude desktop app from the outside —
injected into the page or patched into the app bundle. No official plugin API
exists for the desktop app, so these work by reading the app's own internals
(exposed IPC bridges, localStorage, bundled fonts) and building on top.

## Tools

- [`hotbar/`](hotbar/) — a top-of-window bar showing sessions/chats needing
  attention (running, waiting on you, blocked, errored), with live timers,
  desktop notifications, pinning, and a searchable panel.
- [`chat-input-extension/`](chat-input-extension/) — visually decorates
  markdown (bold/italic/heading) typed into the chat composer, without
  altering the underlying message text.

Each tool is self-contained in its own directory with its own README.

**Platform: macOS and Linux.** Every tool's optional `install-persist.sh`
auto-detects `app.asar`'s location — `/Applications/Claude.app` (or
`~/Applications/Claude.app`) on macOS, `/usr/lib/claude-desktop` (the
official apt package's install path) on Linux — and only re-signs with
`codesign` on macOS, where it's required. The Linux path is based on
Anthropic's documented install location, not verified against a live Linux
install; if it doesn't find yours, edit `detect_asar()` in the script.
Windows isn't supported by these bash scripts. The paste-in-console script
itself (no install) has no such platform dependency.

**Multiple tools patch the same `app.asar`.** Each tool's installer/
uninstaller only touches its own backup/marker, but because all tools share
one underlying file, uninstalling and reinstalling tools out of order can
resurrect a stale copy of another tool's already-uninstalled patch (each
tool's backup is a full snapshot of `app.asar` taken at that tool's own
first-install time, which may include whatever other patches existed then).
If you ever see a tool "still there" after uninstalling it, or duplicated
console log lines from one tool, extract `app.asar` and search for that
tool's `__CLAUDE_*_LOADER__` marker to check for stale copies.

## Help wanted

Both `hotbar/` and `chat-input-extension/` are macOS/Linux only today.
Contributions welcome for:

- **Windows.** `install-persist.sh` is bash + `codesign`, neither of which
  apply on Windows. Needs a PowerShell (or similar) equivalent: find
  `app.asar` under the Windows install path (typically
  `%LOCALAPPDATA%\Programs\Claude\resources\app.asar` — unverified, please
  confirm on a real Windows install), inject the same loader into
  `mainView.js`, and skip the re-signing step entirely (Windows has no
  direct equivalent, though code-signing/SmartScreen implications are worth
  checking).
- **Mobile.** Unclear this is even feasible with the current approach — both
  tools rely on DevTools console access and patching an Electron app's
  `app.asar`, neither of which the Claude mobile apps expose. If you know of
  a way to extend either tool's behavior on mobile, open an issue with what
  you've found before sending a PR — this needs a feasibility discussion
  first, not just a port.
