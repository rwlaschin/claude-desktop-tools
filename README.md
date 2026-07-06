# claude-desktop-tools

Small tools and scripts that extend the Claude desktop app from the outside —
injected into the page or patched into the app bundle. No official plugin API
exists for the desktop app, so these work by reading the app's own internals
(exposed IPC bridges, localStorage, bundled fonts) and building on top.

## Tools

- [`hotbar/`](hotbar/) — a top-of-window bar showing sessions/chats needing
  attention (running, waiting on you, blocked, errored), with live timers,
  desktop notifications, pinning, and a searchable panel.

Each tool is self-contained in its own directory with its own README.
