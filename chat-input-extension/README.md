# Claude Desktop — Chat Input Markdown Decorations

A console-paste-in script for the Claude desktop app that visually decorates
markdown syntax typed into the chat composer, **without altering the
underlying message text**:

- `**bold**` / `__bold__` → bold weight
- `*italic*` / `_italic_` → italic slant
- `` `code` `` → monospace, subtle background
- `~~strike~~` → strikethrough
- `# heading` / `## heading` / `### heading` (and further `#### `–`###### `,
  which collapse into the `###` size) → larger, bolder text

The raw markdown characters (`**`, `` ` ``, `~~`, `#`) stay in the message and
stay **visible, dimmed — never hidden**. Precise cursor placement between a
delimiter and the word matters more than clean prose in a short-lived chat
message. The composer's actual text content is byte-identical to what was
typed at all times — that raw text is exactly what reaches the Claude API.

Decorations recompute on a 400ms trailing-edge debounce after typing stops
(reset on every keystroke), not on every keystroke — so editing inside an
already-decorated range causes no flicker.

## How it works

The app's composer is a TipTap/ProseMirror editor (`.tiptap.ProseMirror`,
with a live `.editor`). This script:

1. Finds every composer instance on the page
   (`document.querySelectorAll('.tiptap.ProseMirror')`) and installs an
   independent decoration plugin + debounce timer on each.
2. Sources the real `Plugin`/`Decoration`/`DecorationSet` classes out of the
   app's **own already-loaded ProseMirror bundle**, via
   `editor.extensionManager.plugins` — it does not import a second copy of
   these classes. A second copy would fail `instanceof` checks inside the
   app's own editor view (the "dual-package hazard"), silently breaking
   decoration rendering.
3. Registers one ProseMirror decoration plugin per composer instance via
   `editor.registerPlugin()`. On every transaction, `decorations(state)` is
   wrapped in its own try/catch — if a decoration pass ever throws, it warns
   once (never spammed) and returns an empty `DecorationSet`, so a decoration
   bug can never break typing or sending a message.
4. Watches `document.body` with a `MutationObserver` so a composer that
   mounts after the script has already run is picked up automatically, no
   manual re-paste needed.

Matching rules run in this order every debounced pass — code first, so
`` `**not bold**` `` inside a code span is never matched by the bold rule:
code → bold → italic → strike → heading. An unclosed delimiter (`"**bold"`
with no closing pair yet) produces no decoration until it's closed, so there's
no flicker while typing. There is no nesting support in v1 — an outer pair
"wins" the span it claims; inner delimiters within an already-claimed span are
not separately decorated.

No app files are touched by the script itself — it runs entirely in the page,
and only visually restyles ranges in the composer; it never edits the
document.

## Try it now (zero risk, no patching)

1. In the Claude app: **View ▸ Toggle Developer Tools** (or `Cmd+Opt+I`)
2. Open the **Console** tab
3. Paste the entire contents of
   [`chat-input-extension.js`](chat-input-extension.js) and press Enter

Typing `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, or `# heading` now
renders visually styled about 400ms after you stop typing.

## Removing it

```js
window.__chatInputExtension.destroy();
```

This fully unregisters the decoration plugin from every composer instance and
restores plain, undecorated typing — even if only some composer instances
installed successfully in the first place.

There is no auto-load/persistence step for this script — **simply reloading
the page also fully removes it**, since nothing is patched into the app
itself. Pasting it again is always safe: the script guards against a double
install by tearing down any prior install first.

## Files

- `chat-input-extension.js` — the script itself (paste-in only; not
  auto-loaded)
- `test/` — jsdom unit test suite (no browser/dev-server dependency); run
  `npm install && npm test` inside `test/`

## Known limitations

- jsdom cannot run a real ProseMirror editor, so the full test suite is unit
  coverage of the pattern-matching, debounce/lifecycle, decoration-building,
  multi-instance, and failure-mode logic — not an end-to-end proof against
  the live app. Cursor-stability behavior during a live decoration pass was
  verified manually in the real Claude desktop app.
- If a future app version changes its ProseMirror bundle's internal shape
  enough that `Plugin`/`DecorationSet` sourcing fails, every composer
  instance degrades to a console warning and plain (undecorated) typing —
  never a thrown error or a broken composer.
