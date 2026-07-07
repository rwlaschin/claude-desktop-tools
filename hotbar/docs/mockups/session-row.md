---
modified: 2026-07-05
dependencies: [status-indicator, pin-icon, hover-preview-popover]
---

# session-row

`.hb-row` — one row inside a group in the
[session-panel](session-panel.md)'s scroll area. Flex row, 8px gap, `7px
11px` padding, cursor pointer (click jumps to the session).

Composition: [status-indicator](status-indicator.md) dot, title, and a
[pin-icon](pin-icon.md) action button that appears on row hover (or always,
at reduced opacity, if already pinned — see pin-icon's row-action state).

Errored rows recolor their sub-text the same way as
[attention-item](attention-item.md)'s error state (`#f0a3a2`), so an
errored session reads consistently whether it's shown collapsed or in the
full panel.
