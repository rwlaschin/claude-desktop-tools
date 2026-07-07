---
modified: 2026-07-05
dependencies: []
---

# search-input

`.hb-search` — the search row pinned to the top of the
[session-panel](session-panel.md), above the scrollable groups. Flex row,
6px gap, `8px 11px` padding, `#8f8d88` icon/placeholder color. Input itself
is borderless/transparent (`background:none;border:none;outline:none`),
inherits the panel's font, flexes to fill remaining width.

Typing filters every group (Waiting / Running / Pinned / Recent) in the
[session-panel](session-panel.md) live, by session title.
