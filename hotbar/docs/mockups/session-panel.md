---
modified: 2026-07-05
dependencies: [search-input, session-row]
---

# session-panel

`.hb-panel` — the expanded panel opened by
[expand-toggle](expand-toggle.md), anchored below the
[collapsed-dock](collapsed-dock.md) (`top:calc(100% + 6px)`, right-aligned,
6px gap). 300px wide, max-height 60vh, dark (`rgba(24,24,26,.98)`), 10px
radius, column flex layout with `overflow:hidden` on the frame so only the
inner list scrolls.

Structure, top to bottom:
1. [search-input](search-input.md) — fixed, does not scroll.
2. Scrollable group list (`.hb-scroll`) — custom 9px thin scrollbar
   (`rgba(255,255,255,.16)`, brightening to `.28` on hover), containing, in
   fixed order:
   - **Needs attention** (errored) — `#e24b4a` group header
   - **Needs you** (blocked) — `#e0a24b`
   - **Waiting on you** — `#e0673b`
   - **Running** — `#5dcaa5`
   - **Pinned** — `#6b9bd1`
   - **Recent** (capped at `RECENT_CAP`, header shows "showing N of total")
     — `#8f8d88`

Each group header (`.hb-grp`) is 10px uppercase text with letter-spacing,
naming the group and its count. Each group's members render as
[session-row](session-row.md).
