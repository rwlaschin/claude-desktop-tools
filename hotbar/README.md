# Claude Desktop — Sessions Hotbar

A top-of-window strip for the Claude desktop app that does three things:

1. **Lists the sessions needing attention** (top-right dock) — waiting on you
   (◆ coral, live wait time) or running (● green, live run time), with idle as
   ○ hollow gray. Status is shape **and** color. Run/wait time counts from the
   real state transition, not session age. Pin (📌) a session to keep it in the
   bar. Hover any row for a preview of the latest activity.
2. **Fires a desktop notification** when a session changes status *or* newly
   pings you ("Waiting on you"), de-duplicated so it fires once per ping.
3. **Expands to a grouped, searchable panel** (▾ toggle) — Waiting / Running /
   Pinned / Recent — that scales to hundreds of sessions; click to jump, pin to keep.

Plus an optional **spy mode** (🕵 icon, off by default): periodically diffs every
`claude.web.*` store and `epitaxy-*`/`ccd-*` localStorage key to discover which
carry live data, into a 1000-item circular buffer. No visible log, no writes —
just a ⭳ export button that downloads the captured events as JSON.

## How it works

The desktop app is an Electron wrapper around `claude.ai`. Its preload
(`mainView.js`) exposes internal bridges to the page. The hotbar uses:

```js
window["claude.web"].LocalSessions        // LIVE coding sessions (accurate isRunning)
window.localStorage["epitaxy-unread-v1"]  // sessions with unseen activity ("pings")
```

| Need | Source |
|------|--------|
| list code sessions + live `isRunning` | `LocalSessions.getAll()` |
| list cowork chats | `LocalAgentModeSessions.getAll()` (merged in, tagged `chat`) |
| code "waiting on you" / pings | `localStorage["epitaxy-unread-v1"].state.unreadIds` |
| cowork unread | `localStorage["persisted.cowork-read-state.<account>"]`: `explicitUnread[id]`, or `lastActivityAt > sessions[id]` (only chats opened before, so old chats don't flood) |
| live change nudge | `LocalSessions.onOnEvent(cb)` (+ 3s polling fallback) |
| hover preview (last message) | `LocalSessions.getTranscript(id)` → last message |
| jump to a session | `LocalSessions.setFocusedSession(id)` |
| stop a task | `LocalSessions.stopTask(id)` |
| pins / spy state / run-wait timing | persisted in `localStorage` (`hotbar-pins`, `hotbar-spy`, `hotbar-timing`) |

The app exposes no run-start / wait-start timestamp, so the hotbar stamps state
transitions itself into `hotbar-timing` (persisted, so times survive reloads).
For a session already running/waiting before the hotbar loads, the first shown
duration estimates from `lastActivityAt` until the next real transition.

`epitaxy-session-result:<id>` is **telemetry** (cost/ms/message-uuids), not a
summary — so the hover preview uses `getTranscript`, falling back to the
session's `initialMessage`.

No app files are touched by the script itself — it runs in the page.

**Note:** `LocalAgentModeSessions` (a different bridge) returns only stale
persisted history and never reports `isRunning` — don't use it. And
`LocalSessions.getAgents({sessionId})` returns the agent *registry* (available
agent types), not running instances, so a live "running sub-agents" list isn't
exposed here.

## Try it now (zero risk, no patching)

1. In the Claude app: **View ▸ Toggle Developer Tools** (or `Cmd+Opt+I`)
2. Open the **Console** tab
3. Paste the entire contents of [`hotbar.js`](hotbar.js) and press Enter

The bar appears at the top. Remove it with `window.__claudeHotbar.destroy()`.
This disappears when you reload/relaunch — it's the safe way to test.

## Auto-load on every launch (optional, advanced — macOS only)

`install-persist.sh` patches the preload so the hotbar loads automatically.
**macOS only** — it hardcodes `/Applications/Claude.app` and re-signs with
`codesign`, both macOS-specific. The paste-in-console step above has no such
requirement.

```bash
cd claude-hotbar
./install-persist.sh     # quit Claude first
```

**Understand the tradeoffs first:**

- It modifies `app.asar`, which **breaks Anthropic's code signature**. The
  script re-signs the app ad-hoc so it still launches, but this is **unsupported
  by Anthropic** and could interfere with app integrity checks.
- A **Claude app update wipes the patch** (it replaces `app.asar`). Re-run the
  script after each update.
- It's tied to the current app version's internals (var names / the exposed
  `claude.web` namespace). If a future version changes these, the script may
  need updating.

Reverse it any time:

```bash
./uninstall.sh
```

A one-time backup (`app.asar.hotbar-backup`) is created on first install so the
original can always be restored.

## Files

- `hotbar.js` — the hotbar itself (paste-in or auto-loaded)
- `install-persist.sh` — patch preload to auto-load; backs up + re-signs
- `uninstall.sh` — restore original app.asar
