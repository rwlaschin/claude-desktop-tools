---
modified: 2026-07-05
dependencies: [status-indicator]
---

# hover-preview-popover

`.claudehotbar-pop` — 260px wide floating card, fixed position next to the
hovered [attention-item](attention-item.md) or
[session-row](session-row.md). Dark (`rgba(20,20,22,.98)`), `10px` radius,
`11px 13px` padding, drop shadow (`0 10px 28px rgba(0,0,0,.45)`),
`pointer-events:none` so it never intercepts the hover it's reacting to.

Contents: a header (`h4`, 12px, weight 500) pairing a small
[status-indicator](status-indicator.md) dot with the session title, then
the latest-activity preview text (`p`, 11px, `#a8a69f`), then a `.meta`
line (10px, `#78766f`) for supporting detail.

Preview text source: `LocalSessions.getTranscript(id)`'s last message,
falling back to the session's `initialMessage` if no transcript is
available yet (see [hotbar design doc](../design/hotbar.md#functions)).
