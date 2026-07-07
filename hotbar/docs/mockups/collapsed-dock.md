---
modified: 2026-07-05
dependencies: [attention-item, utility-icon-button, expand-toggle]
---

# collapsed-dock

`#claude-hotbar` — the root strip, the only thing visible until
[expand-toggle](expand-toggle.md) opens the
[session-panel](session-panel.md). Fixed position (`top:28px;right:12px`),
max z-index, dark pill (`rgba(28,28,30,.96)`, 12px radius, subtle border +
drop shadow), flex row, capped at `70vw` wide, draggable via a grip handle
(`.hb-grip`, 45% opacity, `grab` cursor) at the left edge — position
persists across reloads.

Left to right: drag grip, up to `TOP_N`
[attention-item](attention-item.md) chips (or the empty state if none),
[utility-icon-button](utility-icon-button.md) spy/export controls, then
[expand-toggle](expand-toggle.md) at the far right.
