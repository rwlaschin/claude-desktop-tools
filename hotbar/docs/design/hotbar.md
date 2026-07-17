---
modified: 2026-07-07
dependencies: []
---

# hotbar — sessions attention bar

The runtime UI injected into the Claude desktop app's page: a top-of-window
strip that surfaces which sessions need attention, notifies on status
changes, and expands into a searchable panel over all sessions. Read this
before changing `hotbar.js` or adding a new data source/bridge call.

## Sensitive Areas

- Depends entirely on **undocumented internal Electron bridges** exposed by
  the Claude desktop app's preload (`mainView.js`): `window["claude.web"]`
  and several `localStorage` keys (`epitaxy-*`, `ccd-*`, `persisted.*`).
  Anthropic can change or remove these without notice in any app update —
  there is no supported API contract here.
- `LocalAgentModeSessions` (a separate bridge, used only for cowork chats)
  returns stale persisted history and **never reports `isRunning`** — it
  must never be used as a source of live run state. Use `LocalSessions` for
  that.
- `LocalSessions.getAgents({sessionId})` returns the agent *registry*
  (available agent types), not running instances. A live "running sub-agents"
  count is NOT exposed either: the app tracks it as `activeBackgroundTasks`
  (a Map) on the main-process session model, but `getAll()` marshals that down
  to the boolean `hasBackgroundActivity` before the renderer sees it. So the
  hotbar can show WHETHER a session has background tasks (drives the
  orangy-green "running" marker), but not HOW MANY — dot only, no number.
- `epitaxy-session-result:<id>` is telemetry (cost/ms/message-uuids), not a
  content summary — using it for the hover preview would silently show the
  wrong thing. The hover preview must use `getTranscript`, falling back to
  `initialMessage`.
- Spy mode reads the full contents of every `claude.web.*` store and
  `epitaxy-*`/`ccd-*` localStorage key it can diff, some of which may carry
  session content. It is off by default, does no writes and no network
  calls, and only ever produces a local JSON export the user explicitly
  downloads — that boundary must be preserved if spy mode is extended.

## Design Constraints

- Must run entirely as a script injected into the page — **no app files are
  touched by `hotbar.js` itself** (persisting it across launches is a
  separate concern; see `installer`).
- Must be safe to try with zero risk: paste into DevTools console, verify,
  and `window.__claudeHotbar.destroy()` or reload to remove — no
  installation step required to evaluate it.
- The app exposes no run-start / wait-start timestamp for a session, so the
  hotbar must stamp state transitions itself and persist them
  (`hotbar-timing`) so elapsed times survive a reload instead of resetting.
- The expanded panel must scale to hundreds of sessions (grouped + search),
  not just the handful shown in the collapsed dock.
- Status must be distinguishable by **shape and color together** (not color
  alone) — fresh ● blue, aging ◆ coral, question ▲ red, blocked ■ amber,
  running ● green, idle ○ hollow gray. `error` (dark red, `#A32D2D`) and
  `question` (`#e24b4a`) are deliberately kept far apart in hue/saturation so
  a broken session is never mistaken for one that's merely asking a
  question.

## Feature Overview

Claude desktop sessions run in the background with no ambient way to see,
at a glance, which ones are waiting on you versus still running, or to get
notified the moment one needs you. The hotbar exists to close that gap
without modifying the app: a top-of-window strip that

1. Lists sessions needing attention (fresh/aging/question, blocked,
   running, or pinned), each with a live-counting duration measured from
   the real state transition (not session age), and a hover preview of the
   latest activity.
2. Fires a de-duplicated desktop notification when a session's status
   changes or it newly pings, distinguishing a session whose last message
   reads as a question ("Question for you") from one that's simply
   finished and aging ("Still waiting on you").
3. Expands into a grouped, searchable panel (Needs attention / Question /
   Needs you / Done / Aging / Running / Pinned / Recent) that scales to
   hundreds of sessions, for jumping to or pinning any of them.
4. Clears a session's attention badge the moment you open it
   (`jump(id)`), independent of the app's own read-state, via a small
   local dismiss set — so a stale ping never sits in the bar forever just
   because the underlying app hasn't caught up.

An optional, off-by-default **spy mode** periodically diffs every
`claude.web.*` store and `epitaxy-*`/`ccd-*` localStorage key into a
1000-item circular buffer, purely to help discover which internal keys
carry live data during future development — no visible log, no writes,
just an export-to-JSON button.

## Architecture

A single self-invoking script (`hotbar.js`) injected into the page.
Guards against double-injection by checking/destroying
`window.__claudeHotbar` before rebuilding.

- **Data acquisition**: `LocalSessions.getAll()` for code sessions (live
  `isRunning`), `LocalAgentModeSessions.getAll()` for cowork chats (merged
  in and tagged `chat` via a `kindById` map used for routing/open). Updates
  arrive via `LocalSessions.onOnEvent(cb)` with a 3s polling fallback
  (`POLL_MS`).
- **State tracking**: `lastStatus`, `lastUnread`, `lastBlocked`,
  `lastErrored`, `lastQuestion`, `lastAging` — in-memory maps keyed by
  session id, diffed each tick to detect the transitions that drive
  notifications and re-renders.
- **Persistence**: four `localStorage` keys — `hotbar-pins` (pinned
  session ids), `hotbar-timing` (per-id running/waiting state-entry
  timestamps), `hotbar-dismissed` (per-id local dismiss stamps, see below),
  `hotbar-spy` (spy mode on/off + buffer) — read/written via
  `loadJSON`/`saveJSON` helpers, so pins, elapsed times, dismissals, and spy
  state all survive a reload.
- **Rendering**: collapsed dock showing the top `TOP_N` attention items;
  expandable panel (▾ toggle) rendering the full grouped, searchable,
  scrollable list (`RECENT_CAP` cap on the Recent group).

## Functions

- `loadJSON(key, dflt)` / `saveJSON(key, val)` — guarded localStorage
  read/write helpers used by every persisted piece of state.
- `state(s, unread)` — the state-machine priority chain:
  `error > question > blocked > fresh > aging > running > idle`. `question`
  and the `fresh`/`aging` split both require `!dismissed[id]` to match —
  a dismissed session falls through to `running`/`idle` regardless of its
  underlying unread signal.
- `looksLikeQuestion(text)` — heuristic on the last known message
  (`transcriptCache[id]`, populated by `fetchPreview`, never fetched a
  second time by this function): `true` if the trimmed text ends in `?`,
  else tests a small set of phrase-openers (`could you`, `would you like`,
  `should i`, `which one`, `do you want`, `can you`, `what would you`)
  against just the first 60 characters. `false` for empty/null input.
- `waitAgeState(id, unread)` — returns `null` if the session isn't unread,
  else ages `timing.waiting[id]` (falling back to `Date.now()`, i.e. age 0,
  if never stamped) against `FRESH_MS` (600000ms/10min) to return `"fresh"`
  or `"aging"`. `AGING_MS` (900000ms/15min) is a documentation-only
  constant naming the fresh/aging boundary — there is no third threshold.
- `durationFor(s, st)` — duration to show for a row; `fresh`/`aging`/
  `question` all read `timing.waiting[id]`, same as the retired `waiting`
  branch they replace.
- Transition tracker — on each poll/event tick, diffs current status
  against `lastStatus` and stamps entries into `timing.running`/
  `timing.waiting` on real state changes only.
- `updateTiming(sessions, unread)` — after its existing running/waiting
  bookkeeping, clears `dismissed[id]` (and persists) for any session whose
  `unread[id]` has gone false — a dismissal only suppresses the CURRENT
  ping, not future ones.
- Notification dispatcher — fires a desktop notification on a detected
  status change or new ping (including first-tick entry into `question` or
  `aging`), de-duplicated so a given change fires exactly once.
- Hover preview — calls `LocalSessions.getTranscript(id)` for the last
  message, falling back to the session's `initialMessage` if no transcript
  is available yet. Also fetched proactively (unconditionally, not gated on
  hover) the first tick a session resolves to `fresh`, so
  `transcriptCache[id]` is populated before `looksLikeQuestion` needs it on
  a later tick.
- Pin toggle — adds/removes a session id from `pins` and persists to
  `hotbar-pins`.
- `jump(id)` — first stamps `dismissed[id] = Date.now()` and persists to
  `hotbar-dismissed`, THEN proceeds with its existing bridge call
  (`setFocusedSession` / router navigation). Opening a session is what
  clears its badge, immediately and independently of the app's own
  read-state.
- Panel search/group — filters and buckets the full session list into
  Needs attention (error) / Question / Needs you (blocked) / Done (fresh) /
  Aging / Running / Pinned / Recent for the expanded view.
- Stop action — `LocalSessions.stopTask(id)` to stop a session.
- Spy loop — periodically diffs every reachable `claude.web.*` store and
  matching localStorage key, appends discovered changes to a 1000-item
  circular buffer, and exposes an export-to-JSON action. No-op unless spy
  mode is explicitly enabled.

## Models

- `pins`: `{ [sessionId]: 1 }` — persisted as `hotbar-pins`.
- `timing`: `{ running: { [sessionId]: ms }, waiting: { [sessionId]: ms } }`
  — persisted as `hotbar-timing`; the ms value is the timestamp the session
  entered that state. `timing.waiting[id]` is also the age baseline for the
  `fresh`/`aging` split.
- `dismissed`: `{ [sessionId]: dismissedAtMs }` — persisted as
  `hotbar-dismissed`. Set by `jump(id)`, cleared by `updateTiming()` once
  the session's `unread[id]` goes false. A one-shot local ack of the
  CURRENT ping, not a permanent per-session mute — it does not survive
  the next unread ping on the same session.
- `lastStatus` / `lastUnread` / `lastBlocked` / `lastErrored` /
  `lastQuestion` / `lastAging`: in-memory `{ [sessionId]: value }` maps, not
  persisted — used only for transition/change detection within a single
  page lifetime.
- `kindById`: `{ [sessionId]: "code" | "cowork" }` — routing map so a
  session opens/behaves correctly regardless of which bridge it came from.
- Spy buffer: a 1000-item circular buffer of diffed store/localStorage
  change events, persisted under `hotbar-spy` while spy mode is on.

## Use Cases

### UC1 — Monitor attention from the collapsed dock

- **Goal**: see, without switching windows, which sessions are waiting on
  the user right now and for how long.
- **Stakeholders**: the developer running multiple Claude sessions.
- **Actors**: the user (primary); the hotbar script (polls/reacts to
  `LocalSessions` and renders status).
- **Preconditions**: `hotbar.js` is loaded in the page and the
  `claude.web.LocalSessions` bridge is present.
- **Postconditions**: the user can identify any fresh/aging/question/
  blocked/errored session and its live duration at a glance.
- **Basic Course of Events (BCE)**: hotbar polls/reacts to `LocalSessions`
  changes → computes per-session status via the `error > question >
  blocked > fresh > aging > running > idle` priority chain → renders up to
  `TOP_N` attention items in the collapsed dock with shape+color status and
  live duration → user glances at the dock and identifies which session(s)
  need action → opening a session (`jump(id)`) immediately dismisses its
  badge, so a session already looked at never occupies a bar slot forever.
- **Alternate Flows**: user hovers an item — the
  [hover-preview-popover](../mockups/hover-preview-popover.md) shows the
  latest activity without switching to the session.
- **Exceptions**: if the `LocalSessions` bridge isn't found, hotbar logs a
  console warning and does not render (see Sensitive Areas).

### UC2 — Get notified on a status change

- **Goal**: be alerted when a background session finishes, starts waiting,
  or gets a new ping, without watching the dock continuously.
- **Stakeholders**: the developer.
- **Actors**: the user; the hotbar script (detects transitions, fires the
  notification); the OS notification center.
- **Preconditions**: desktop notification permission granted; hotbar
  loaded.
- **Postconditions**: exactly one desktop notification fires per detected
  transition.
- **Basic Course of Events (BCE)**: hotbar diffs current status against
  `lastStatus`/`lastUnread` on each poll/event tick → detects a status
  change or new unread ping → fires a desktop notification once for that
  change → records the change so it isn't re-fired.
- **Alternate Flows**: none beyond the basic course.
- **Exceptions**: a session that flips state more than once within a
  single tick only produces one notification for the net transition — the
  de-duplication is what prevents a notification storm.

### UC3 — Search and jump to a session from the expanded panel

- **Goal**: locate and open any session, including ones outside the
  collapsed dock's top-N, from a large history.
- **Stakeholders**: the developer.
- **Actors**: the user; the [session-panel](../mockups/session-panel.md)
  UI.
- **Preconditions**: [expand-toggle](../mockups/expand-toggle.md) clicked,
  panel open.
- **Postconditions**: the matching session opens
  (`LocalSessions.setFocusedSession`) or is pinned to stay visible in the
  collapsed dock.
- **Basic Course of Events (BCE)**: user clicks expand-toggle → panel opens
  showing grouped sessions (Needs attention / Question / Needs you / Done /
  Aging / Running / Pinned / Recent, Recent capped at `RECENT_CAP`) → user
  types in
  [search-input](../mockups/search-input.md) → all groups filter live by
  title → user clicks a row to jump to that session.
- **Alternate Flows**: user clicks the row's
  [pin-icon](../mockups/pin-icon.md) instead of jumping — the session moves
  into/stays in the Pinned group and remains visible in the collapsed dock.
- **Exceptions**: none noted.

### UC4 — Discover new live-data sources via spy mode

- **Goal**: find which additional `claude.web.*`/localStorage keys carry
  data worth wiring into the hotbar next.
- **Stakeholders**: a developer extending the hotbar (not an end-user
  workflow).
- **Actors**: the developer; the spy loop.
- **Preconditions**: spy mode explicitly toggled on via
  [utility-icon-button](../mockups/utility-icon-button.md).
- **Postconditions**: a JSON export of the diffed store/localStorage
  changes is downloaded locally; no data leaves the machine.
- **Basic Course of Events (BCE)**: developer toggles spy mode on → the
  spy loop periodically diffs every `claude.web.*` store and matching
  localStorage key → diffs are appended to a 1000-item circular buffer →
  developer clicks export → the buffer downloads as JSON.
- **Alternate Flows**: none.
- **Exceptions**: the buffer is circular — once it reaches 1000 items, the
  oldest diffs are dropped first.

## Tests

DOM-level tests under `test/*.mjs`, run with jsdom (no browser needed):

```bash
cd test && npm init -y && npm install jsdom
for f in *.mjs; do node "$f"; done
```

Covers: attention list + durations, run/wait timing from transitions,
fresh/aging pings and eviction, question-state detection (including the
async-fetch caveat around `transcriptCache`), dismiss-on-jump and its
re-arming on new activity, click-to-open routing, drag + position
persistence, badge color (including the full fresh/aging/question/blocked/
error ramp), spy-mode ring buffer + export, and the transcript-backed hover
preview.

## UI/UX

Top-of-window strip. See `docs/mockups/` for the per-element visual spec:
[collapsed-dock](../mockups/collapsed-dock.md) (root strip, draggable) →
[attention-item](../mockups/attention-item.md) (per-session chip) →
[status-indicator](../mockups/status-indicator.md) (shape+color dot) +
[pin-icon](../mockups/pin-icon.md) →
[utility-icon-button](../mockups/utility-icon-button.md) (spy/export) →
[expand-toggle](../mockups/expand-toggle.md) →
[session-panel](../mockups/session-panel.md) (grouped, searchable) →
[search-input](../mockups/search-input.md) +
[session-row](../mockups/session-row.md) →
[hover-preview-popover](../mockups/hover-preview-popover.md).

**Attention states, shape+color** (status-indicator's full ramp):
- `error` — dark saturated red (`#A32D2D`), alert-triangle icon. Reserved
  exclusively for `hasError(s)`; never reassigned. `hasError` fires on either
  a non-empty `errorCategory` OR a non-empty `error` string — the app populates
  usage-limit and 529-overloaded failures via `error`/`errorAt` only, leaving
  `errorCategory` empty, so keying on the category alone silently dropped them.
  A bare `error` string counts only while `errorAt >= lastActivityAt`, so an
  error the user has already retried past (later activity) is not shown as live.
  Category (from `errorCategory`, else derived from the `error` string) drives
  the label/action: billing → `Upgrade credits` (opens billing, no duration);
  usage-limit → `Usage limit` (no duration); overloaded → `Service busy · <dur>`;
  network → `Connection lost · <dur>`; else humanized category · duration.
- `question` — red (`#e24b4a`), alert-triangle icon (same glyph as `error`,
  distinguished by the darker/more-saturated error color and its own
  `.question` class). The last known message reads like it's asking the
  user something (`looksLikeQuestion`). Ranked below `blocked`, above
  `fresh`/`aging`; excluded from the aging/eviction bucket logic.
- `blocked` — amber (`#e0a24b`), filled square. Needs your permission
  answer.
- `fresh` — blue (`#378ADD`), filled circle. A session went unread less
  than `FRESH_MS` (10min) ago. Label: `"done · <duration>"`.
- `aging` — coral (`#e0673b`), diamond. Same session, `FRESH_MS` or later.
  Label unchanged (`"done · <duration>"`) — only the marker's color/shape
  differs from `fresh`.
- `running` — green (`#5dcaa5`), filled circle.
- `idle` — hollow gray circle.

Clicking any row (`jump(id)`) dismisses its badge on the next tick,
regardless of state — see `dismissed` in Models.

## Dependencies

None — this design doc has no dependencies on other subsystems.
`installer` (see `docs/design/installer.md`) depends on this one, since it
exists to load `hotbar.js` automatically.

## Diagrams

No diagrams are currently maintained for this subsystem.

## References

- Project `README.md` — user-facing quick-start ("Try it now" / "Auto-load"
  instructions); this design doc is the technical/architecture source of
  truth, the README stays the onboarding doc.
