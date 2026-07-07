---
modified: 2026-07-07
dependencies: [status-indicator, pin-icon, hover-preview-popover]
---

# attention-item

`.hb-item` — one chip in the collapsed [collapsed-dock](collapsed-dock.md),
one per session shown (up to `TOP_N`). Flex row, 8px gap, `8px 12px`
padding, max-width 230px, right border divider (`1px solid
rgba(255,255,255,.07)`), cursor pointer (click jumps to the session).

Composition: [status-indicator](status-indicator.md) dot, truncated title
(`.hb-tt`, max-width 140px), live duration (`.hb-sub`, 11px, `#9a9891`),
[pin-icon](pin-icon.md) inline if pinned.

State backgrounds (left border + tinted fill), in the `state()` priority
order (`error > question > blocked > fresh > aging > running > idle`):

| State | Background | Left border |
|---|---|---|
| error | `rgba(163,45,45,.16)` | `3px solid #A32D2D` |
| question | `rgba(226,75,74,.16)` | `3px solid #e24b4a` |
| blocked | `rgba(224,162,75,.18)` | `3px solid #e0a24b` |
| fresh | `rgba(55,138,221,.16)` | `3px solid #378ADD` |
| aging | `rgba(216,90,48,.16)` | `3px solid #e0673b` |

`error` and `question` are deliberately far apart (dark saturated red vs.
plain red) so a broken session is never mistaken for one that's merely
asking a question. `fresh`/`aging` are the age-split retirement of the old
single `waiting` state — both read the same `timing.waiting[id]` stamp;
only the marker and item tint change at the `FRESH_MS` (10min) boundary.

`.hb-sub` recolors to match the active state (`#f0a3a2` error/question,
`#d8b483` blocked, `#9dc3ee` fresh, `#c9a08c` aging) so the duration text
stays legible against the tint.

Hovering an item shows the [hover-preview-popover](hover-preview-popover.md).
Empty state (no active sessions): a single idle dot + "No active sessions"
in muted gray (`#9a9891`).
