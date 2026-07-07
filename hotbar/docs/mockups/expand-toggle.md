---
modified: 2026-07-07
dependencies: []
---

# expand-toggle

`.hb-toggle` — the ▾ control at the right end of the
[collapsed-dock](collapsed-dock.md) that opens/closes the
[session-panel](session-panel.md). `8px 11px` padding, flex row with 5px
gap, `#d9d7d0` text.

States:
- **hover**: `rgba(255,255,255,.06)` fill, right-side corners rounded to
  match the dock (`0 12px 12px 0`).
- **active** (pressed): `rgba(255,255,255,.16)` fill, same corner
  rounding.

Shows an `.hb-count` badge when there's at least one session needing
attention: pill shape (9px radius), text color contrasts the fill, on a
background that escalates by severity — `#5dcaa5` green (running only) →
`#378ADD` blue (fresh) → `#e0673b` coral (aging) → `#e0a24b` amber
(blocked, dark `#3a2a08` text for contrast) → `#e24b4a` red (question) →
`#A32D2D` dark red (errored) — same severity order used for the
[attention-item](attention-item.md) state priority (`error > question >
blocked > fresh > aging > running`). `error` and `question` are
deliberately far apart in hue/saturation — plain coral read as
near-identical to the old single "waiting" dot color at badge size, so
`error` gets its own visually distinct dark red separate from the coral/red
tones used by `aging`/`question`.
