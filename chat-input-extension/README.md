# Claude Desktop — Chat Input Markdown Decorations

A console-paste-in script for the Claude desktop app that visually decorates
markdown syntax typed into the chat composer, **without altering the
underlying message text**:

- `**bold**` / `__bold__` → bold weight
- `*italic*` / `_italic_` → italic slant
- `# heading` / `## heading` / `### heading` (and further `#### `–`###### `,
  which collapse into the `###` size) → larger, bolder text

Inline `` `code` `` and `~~strikethrough~~` are intentionally **not**
handled — live testing in the real app showed the composer already renders
both natively (real marks; the delimiter characters disappear entirely,
unlike this script's dimmed-but-visible approach), so decoration rules for
them would be redundant.

The raw markdown characters (`**`, `#`) stay in the message and stay
**visible, dimmed — never hidden**. Precise cursor placement between a
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

Matching rules run in this order every debounced pass: bold → italic →
heading. An unclosed delimiter (`"**bold"` with no closing pair yet) produces
no decoration until it's closed, so there's no flicker while typing. There is
no nesting support in v1 — an outer pair "wins" the span it claims; inner
delimiters within an already-claimed span are not separately decorated.

No app files are touched by the script itself — it runs entirely in the page,
and only visually restyles ranges in the composer; it never edits the
document.

## Try it now (zero risk, no patching)

1. In the Claude app: **View ▸ Toggle Developer Tools** (or `Cmd+Opt+I`)
2. Open the **Console** tab
3. Paste the entire contents of
   [`chat-input-extension.js`](chat-input-extension.js) and press Enter

Typing `**bold**`, `*italic*`, or `# heading` now renders visually styled
about 400ms after you stop typing.

## Removing it

```js
window.__chatInputExtension.destroy();
```

This fully unregisters the decoration plugin from every composer instance and
restores plain, undecorated typing — even if only some composer instances
installed successfully in the first place.

If you haven't run `install-persist.sh` (below), **simply reloading the page
also fully removes it**, since nothing is patched into the app. Pasting it
again is always safe: the script guards against a double install by tearing
down any prior install first.

## Auto-load on every launch (optional, advanced — macOS/Linux)

`install-persist.sh` patches the preload so the script loads automatically,
same approach as `hotbar/`'s installer — its own backup file and marker, so
installing/uninstalling this tool doesn't directly touch hotbar's patch code.
It auto-detects `app.asar`'s location: `/Applications/Claude.app` or
`~/Applications/Claude.app` on macOS, `/usr/lib/claude-desktop` (the official
apt package's install path) on Linux. **Windows is not supported** by this
bash script. The Linux path is based on Anthropic's documented install
location, not verified against a live Linux install — if it doesn't find
yours, edit `detect_asar()` in the script. The paste-in-console step above
has no platform dependency.

```bash
cd chat-input-extension
./install-persist.sh     # quit Claude first
```

**Understand the tradeoffs first:**

- On macOS, it modifies `app.asar`, which **breaks Anthropic's code
  signature**. The script re-signs the app ad-hoc so it still launches, but
  this is **unsupported by Anthropic** and could interfere with app
  integrity checks. On Linux there's no equivalent signature check, but a
  package-manager integrity check (`dpkg -V claude-desktop`) will flag
  `app.asar` as modified — harmless, but expected.
- A **Claude app update wipes the patch** (it replaces `app.asar`). Re-run the
  script after each update.
- It's tied to the current app version's internals (the `.tiptap.ProseMirror`
  selector, `mainView.js`'s layout). If a future version changes these, the
  script may need updating.
- Auto-loading raises the stakes of a bug slightly, since you no longer get a
  reload-to-remove safety net for free — you'd need
  `window.__chatInputExtension.destroy()` or `./uninstall.sh`. The script's
  own defensive guards (never-throw decoration passes, graceful skip on
  sourcing failure) still apply either way.
- If `hotbar/`'s installer is also in use on this machine: both tools patch
  the same shared `app.asar`. Uninstalling/reinstalling out of order can
  resurrect a stale copy of the other tool's patch — see the top-level
  `README.md`'s note on this.

Reverse it any time:

```bash
./uninstall.sh
```

A one-time backup (`app.asar.chat-input-extension-backup`) is created on
first install so the pre-patch state can always be restored.

## Files

- `chat-input-extension.js` — the script itself (paste-in or auto-loaded)
- `install-persist.sh` — patch preload to auto-load; backs up + re-signs
- `uninstall.sh` — restore app.asar to its pre-patch state
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
