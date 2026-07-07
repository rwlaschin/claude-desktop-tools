---
modified: 2026-07-07
dependencies: []
supersedes: null
---

# Plan: markdown-decorations

## Problem

Claude desktop app's chat composer (TipTap/ProseMirror, `.tiptap.ProseMirror`)
has no bold/italic/heading mark or node in its schema — typing `**bold**` or
`# heading` does nothing visually. Lists (`-`, `*`, `1.`) already convert via
native input rules; bold/italic/heading/inline-code do not.

## Solution

Register a ProseMirror decoration plugin on the live composer
(`editor.registerPlugin()`, confirmed callable) that visually restyles
matched markdown ranges after a debounced pause, without altering the
document. The stored/submitted text stays exactly as typed — required,
since that raw text is what reaches the Claude API. Strikethrough
(`~~x~~`) uses the same decoration approach as bold/italic/heading, not the
schema's existing real `strike` mark, for one consistent mental model across
every pattern this tool handles.

## Target Design Docs

Produces `docs/design/chat-input-extension.md` (does not exist yet — this
plan builds the first version of this tool). Sections populated at build
time per this project's design-doc convention: Sensitive Areas (undocumented
Electron bridge dependency, same category of risk as `hotbar`'s), Design
Constraints (no build step — paste-in console script — must source
`Plugin`/`Decoration` classes from the app's own already-loaded bundle, not
import them), Feature Overview, Architecture, Functions, Models, Use Cases
(below), Tests, UI/UX (references `docs/mockups/`), Dependencies, Diagrams,
References.

## Parallel / Dependent Breakdown

| Area | Owner |
|---|---|
| `Plugin`/`Decoration` sourcing verification, pattern-matching rules, debounce/lifecycle state machine, failure modes | Architect |
| Delimiter visibility, debounce timing, heading scope, nesting behavior, mockup | UI/UX |
| File list, atomic edit groups, test-file scope | Senior Dev |

Dependent build order: `Plugin`/`Decoration` sourcing verification (live,
first — a go/no-go gate) → pattern-matching module (pure functions, no DOM/
PM) → debounce/lifecycle scaffold → decoration-building layer → multi-
instance discovery/attach loop → defensive guards → full regression →
manual live-paste verification.

## Scope

**Directory**: `chat-input-extension/` (sibling to `hotbar/`, zero shared
code). Entry script `chat-input-extension.js`, matching the established
`hotbar.js` tool-name-matches-entry-file convention.

**Composer discovery**: `document.querySelectorAll('.tiptap.ProseMirror')`
— confirmed live to return 2 elements; iterate all, install an independent
plugin + independent debounce timer per instance. Add a `MutationObserver`
on `document.body` (childList/subtree) that re-scans for newly-mounted
composer elements, so the script self-heals if pasted before the composer
exists.

**`Plugin`/`Decoration` sourcing** (build task, not a design fork — resolve
live during implementation, first task in `tasks.md`): read
`editor.extensionManager.plugins` (a live array of real `Plugin` instances
from the app's own bundle); take `plugins[0].constructor` as the real
`Plugin` class. Walk the same array for an entry whose `props.decorations`
is a function; call it against `editor.view.state` and take the result's
constructor as the real `DecorationSet`. Verify via
`new PluginCtor({props:{}})` not throwing, and the located
`Decoration`/`DecorationSet` passing `instanceof` checks against
`editor.view.state.plugins` entries, before writing any decoration-producing
code against these classes. If this fails on the live app, that is a
stop-and-replan event per this project's docs convention — do not fall back
to bundling a separate `Plugin`/`Decoration` implementation silently; a
second copy of these classes fails `instanceof` checks inside the app's own
ProseMirror view (dual-package hazard).

**Pattern-matching rules** — one scanner run per debounced pass, against
each paragraph/heading-candidate text block, checked in this order (code
first, so `` `**not bold**` `` inside a code span is never matched by the
bold rule):

```js
var RULES = [
  { name: "code",   re: /`([^`\n]+)`/g },
  { name: "bold",   re: /\*\*([^\s*][^*]*?)\*\*|__([^\s_][^_]*?)__/g },
  { name: "italic", re: /(?<![*\w])\*([^\s*][^*]*?)\*(?!\*)|(?<![_\w])_([^\s_][^_]*?)_(?!_)/g },
  { name: "strike", re: /~~([^\s~][^~]*?)~~/g },
  { name: "heading",re: /^(#{1,3})\s+\S.*$/ } // line-start only, tested once per line, not global
];
```

Multi-run-per-line and "exit block" behavior require no special mechanic —
a non-greedy global `exec` loop naturally advances past each closed pair;
unclosed delimiters (no matching close yet) produce no decoration until
closed, avoiding flicker.

**Debounce**: 400ms, trailing-edge only, reset on every keystroke
(`tr.docChanged` in the plugin's `view.update` hook resets a single
`setTimeout`). Below ~300ms risks decorating mid-word; above ~600ms reads as
laggy.

**Delimiter visibility**: `**`, `#`, `~~`, `` ` `` render at a muted/
secondary color, always visible, never hidden — precise cursor placement
between a delimiter and the word matters more than clean prose in a
short-lived chat message.

**Heading scope**: `#`/`##`/`###` get distinct sizes; `####`–`######`
collapse into the `###` size (chat messages are short, six distinct heading
sizes has no practical use here).

**Nesting**: not supported in v1 — `**bold *italic* still bold**` resolves
as one bold run with the inner `*...*` rendered as plain text within it
(outer pair wins).

**Graceful degradation**: wrap the entire install step per composer
instance in try/catch; on failure, `console.warn` and skip that instance,
continuing with any others found — never throw, never break the user's
ability to type. Matches `hotbar.js`'s existing
`if (!api || typeof api.getAll !== "function") { console.warn(...); return; }`
pattern.

**Performance**: full-block-text rescan per debounced pass is bounded by
realistic chat-message length (low single-digit KB); regex passes at that
size run in sub-millisecond to low-single-digit-millisecond time, and the
400ms debounce caps this to at most a couple of passes per second even
during fast typing. No profiling required at this scale.

## Files

```
chat-input-extension/
  chat-input-extension.js      # injectable IIFE, window.__chatInputExtension API
  README.md                    # mirrors hotbar/README.md structure
  test/
    package.json                # jsdom devDependency, npm test runs all *.mjs
    pattern-match.mjs           # regex/scanner correctness, offsets, precedence, code-span exclusion
    lifecycle-debounce.mjs      # debounce timing, reset-on-keystroke, destroy() cleanup
    decoration-apply.mjs        # stubbed editor, asserts DecorationSet output
    multi-instance.mjs          # 0/1/2+ composer instances, independent state per instance
    graceful-degradation.mjs    # missing registerPlugin/editor structure, no-throw, warns
```

## Use Cases

### Use case 1 — user types markdown, it renders decorated after a pause

- **Goal**: see bold/italic/heading/strike/inline-code rendered visually
  without the underlying message text changing.
- **Stakeholders**: the user.
- **Actors**: the user (typing); the registered ProseMirror plugin.
- **Preconditions**: a `.tiptap.ProseMirror` composer with a live `.editor`
  exists on the page; the script has successfully called
  `editor.registerPlugin()` on it.
- **Postconditions**: matched ranges render with the corresponding visual
  style (bold weight / italic slant / monospace / larger heading size /
  strikethrough); the composer's actual text content is byte-identical to
  what the user typed.
- **Basic Course of Events**:
  1. User types `**bold**` (or another supported pattern) into the composer.
  2. Each keystroke's `tr.docChanged` resets the plugin's 400ms debounce timer.
  3. 400ms after the last keystroke, the scanner runs `RULES` against the
     current block text, in the order in Scope (code, bold, italic, strike,
     heading).
  4. A `DecorationSet` is built from all matches and stored in the plugin's
     instance-local variable; a no-op transaction
     (`view.dispatch(state.tr.setMeta(pluginKey, true))`) triggers
     `decorations(state)` to return the new set.
  5. ProseMirror repaints the matched range with the corresponding CSS
     class; the document's actual text is unchanged.
- **Alternate Flows**: user types a pattern with an unclosed delimiter
  (`"**bold"`, no closing pair) — no decoration renders until a closing
  delimiter appears in a later keystroke.
- **Exceptions**: `registerPlugin` throws or is missing on this app
  version — `console.warn`, skip that composer instance, no decoration
  behavior for it, no thrown error, typing is unaffected.

### Use case 2 — three independent runs on one line

- **Goal**: correctly decorate multiple separate markdown runs on a single
  line without merging or misattributing ranges.
- **Stakeholders**: the user.
- **Actors**: the scanner's regex exec loop.
- **Preconditions**: a line of text contains two or more closed markdown
  pairs of the same or different types, separated by plain text.
- **Postconditions**: each closed pair decorates independently; plain text
  between and around them remains undecorated.
- **Basic Course of Events**:
  1. Line text is `"**bold** this is not bold **bold again**"`.
  2. First `exec` call on the bold rule matches `**bold**` at index 0–8;
     `lastIndex` advances to 8.
  3. Second `exec` call resumes from index 8; `" this is not bold "`
     contains no closing pair, scan continues; matches `**bold again**` at
     index 27–41.
  4. Loop terminates (no further matches); two decorations are added to the
     `DecorationSet`, the middle plain-text run has none.
- **Alternate Flows**: none — this is the general case the exec-loop
  mechanism handles for any number of runs per line.
- **Exceptions**: none specific to this use case beyond Use Case 1's.

## Testing Requirements

All coverage below is unit test coverage via a jsdom harness (`node <file>.mjs`,
no browser/dev-server dependency), matching the convention already
established in `hotbar/test/`.

- `test/pattern-match.mjs` — unit tests asserting: each `RULES` entry
  matches its pattern with correct offsets; the code rule excludes its
  matched span from being re-matched by bold/italic/strike; the italic
  regex does not fire adjacent to a `**` bold run; an unclosed delimiter
  produces no match; the heading regex only matches at line start. Covers
  Use Case 1's Alternate Flow (unclosed delimiter).
- `test/lifecycle-debounce.mjs` — unit tests stubbing `setTimeout`/
  `clearTimeout`, asserting: the debounce timer resets on every simulated
  keystroke; the decoration recompute callback fires exactly once, 400ms
  after the last keystroke, not on each keystroke; `destroy()` clears all
  pending timers. Covers Use Case 1's Basic Course of Events steps 2–4.
- `test/decoration-apply.mjs` — unit tests against a stubbed `editor`
  object (`{registerPlugin, state, view}`) asserting the plugin's
  `decorations(state)` returns a `DecorationSet`-shaped result with the
  correct count, class, and range for seeded multi-pattern and
  multi-run-per-line text (the exact fixture from Use Case 2's Basic Course
  of Events). Covers Use Case 2 fully.
- `test/multi-instance.mjs` — unit tests seeding 0, 1, and 2 fake
  `.tiptap.ProseMirror` nodes in jsdom, asserting correct attach count and
  independent decoration/debounce state per instance, and that a composer
  added to the DOM after script load is picked up via the
  `MutationObserver` fallback.
- `test/graceful-degradation.mjs` — unit tests removing/mangling
  `registerPlugin` or the expected editor structure, asserting
  `console.warn` fires, no exception is thrown, and other valid composer
  instances are still installed. Covers Use Case 1's Exception.

Full-suite regression: all files under `chat-input-extension/test/` must
pass via `npm test` before this feature is considered complete.

## Success Criteria

- [ ] `Plugin`/`DecorationSet` successfully sourced from the live app's own
      `editor.extensionManager.plugins`, verified via `instanceof` against
      `editor.view.state.plugins` entries (first implementation task — a
      failure here is a stop-and-replan event, not a silent fallback)
- [ ] Typing `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `# heading`
      each render visually styled 400ms after the pause, delimiters visible
      and dimmed, not hidden
- [ ] The composer's actual text content is byte-identical to what was
      typed at all times — verified by reading `editor.getText()` (or
      equivalent) before and after a decoration pass
- [ ] Editing inside an already-decorated range causes no visible flicker
      or re-render pop
- [ ] `**bold** this is not bold **bold again**` decorates exactly the two
      bold runs, per Use Case 2
- [ ] Works correctly with 2 simultaneous composer instances (confirmed
      live count) with independent state
- [ ] A composer that mounts after the script runs is picked up via the
      `MutationObserver` fallback, no manual re-run needed
- [ ] Missing/changed app internals (`registerPlugin` absent, schema
      changed) degrade to a console warning for that instance only, never
      a thrown error or broken composer
- [ ] All `test/*.mjs` pass via `npm test`
- [ ] `node --check chat-input-extension.js` passes
- [ ] Manually verified live in the real Claude desktop app: cursor never
      jumps during or after a decoration pass (jsdom cannot run a real
      ProseMirror editor, so this step cannot be automated)
