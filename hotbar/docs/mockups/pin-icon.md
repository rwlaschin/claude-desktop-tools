---
modified: 2026-07-05
dependencies: []
---

# pin-icon

📌, `#e0a24b` amber. Two placements:

- Inline in a title (`.hb-pin`, 4px right margin) when a session is pinned
  — shown in both [attention-item](attention-item.md) and
  [session-row](session-row.md).
- As a row action button (`.hb-act`) in [session-row](session-row.md):
  40% opacity by default, full opacity + amber when the row is pinned
  (`.hb-act.pinned`); a short 0.08s transform transition on toggle.

Click toggles pinned state; pinning adds the session to the `Pinned` group
and keeps it visible in the collapsed dock.
