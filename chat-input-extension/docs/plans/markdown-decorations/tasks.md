---
modified: 2026-07-06
dependencies: [plan.md]
---

# Tasks: markdown-decorations

1. **Architect** — verify `Plugin`/`DecorationSet` sourcing live against
   `editor.extensionManager.plugins` per plan.md's sourcing section. Go/no-go
   gate; stop-and-replan if it fails, no silent fallback.
2. **Full-stack** — pattern-matching module (`RULES`, pure functions, no
   DOM/PM dependency).
3. **Full-stack** — debounce/lifecycle scaffold (400ms trailing-edge timer,
   reset on `tr.docChanged`, `destroy()` cleanup).
4. **Full-stack** — decoration-building layer (`decorations(state)` →
   `DecorationSet`, wrapped in a per-call try/catch that returns an empty
   set and warns once on failure — typing must never break even if a
   decoration pass throws).
5. **Full-stack** — multi-instance discovery/attach loop
   (`querySelectorAll('.tiptap.ProseMirror')` + `MutationObserver` fallback
   for composers mounted later).
6. **Full-stack** — defensive guards: try/catch per composer install,
   `window.__chatInputExtension` API with `destroy()` (removes plugins from
   every instance, restores plain composer) and a reinstall guard at top of
   file (`if (window.__chatInputExtension) destroy();`) matching `hotbar.js`
   convention.
7. **Test Engineer** — write `test/*.mjs` per plan.md's Testing
   Requirements (pattern-match, lifecycle-debounce, decoration-apply,
   multi-instance, graceful-degradation).
8. **Full-stack** — full regression: `npm test` green, `node --check
   chat-input-extension.js` passes.
9. **Complete** — manual live-paste verification in the real app (cannot be
   automated in jsdom); confirm `destroy()` cleanly removes all styling and
   restores normal typing.
