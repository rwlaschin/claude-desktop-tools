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

**Platform: macOS only.** Every tool's optional `install-persist.sh` patches
`/Applications/Claude.app`'s `app.asar` and re-signs it with `codesign` — both
macOS-specific. The paste-in-console script itself (no install) is likely
platform-agnostic if the Claude desktop app exists on your OS, but the
auto-load installer is not.
