/*
 * Claude Desktop — Chat Input Markdown Decorations
 * -------------------------------------------------
 * Visually decorates markdown syntax typed into the chat composer
 * (`**bold**`, `*italic*`, `# heading`) WITHOUT altering the underlying
 * document text. The raw markdown characters stay in the message and stay
 * visible (dimmed), never hidden — the text that reaches the Claude API is
 * byte-identical to what was typed.
 *
 * Inline `` `code` `` and `~~strikethrough~~` are NOT handled here — live
 * testing in the real app confirmed the composer already renders those
 * natively (via real input-rule marks, not decorations — the delimiter
 * characters disappear entirely), so adding decoration rules for them would
 * be redundant.
 *
 * How it works: the app's composer is a TipTap/ProseMirror editor
 * (`.tiptap.ProseMirror`). This script reads the real `Plugin`/
 * `DecorationSet` classes out of the app's OWN already-loaded ProseMirror
 * bundle (via `editor.extensionManager.plugins`) rather than importing a
 * second copy — a second copy would fail `instanceof` checks inside the
 * app's own editor view (the "dual-package hazard"). It then registers one
 * decoration plugin per composer instance via `editor.registerPlugin()`.
 * Decorations recompute on a 400ms trailing-edge debounce after typing
 * stops, never on every keystroke.
 *
 * Run now: paste into DevTools console. Not persisted — reloading the page
 * fully removes it. Remove manually any time with
 * window.__chatInputExtension.destroy().
 */
(function () {
  "use strict";
  if (window.__chatInputExtension) { window.__chatInputExtension.destroy(); }

  // ---- config ------------------------------------------------------------
  var COMPOSER_SELECTOR = ".tiptap.ProseMirror";
  var DEBOUNCE_MS = 400;
  var PLUGIN_KEY = "chatInputExtensionDecorations";

  // ---- pattern-matching rules --------------------------------------------
  // Checked in this order every debounced pass: bold, italic, heading.
  // Inline code and strikethrough are handled natively by the app already
  // (see header comment) and are deliberately not in this table.
  // Exported on the API for unit testing.
  var RULES = [
    { name: "bold",    re: /\*\*([^\s*][^*]*?)\*\*|__([^\s_][^_]*?)__/g },
    { name: "italic",  re: /(?<![*\w])\*([^\s*][^*]*?)\*(?!\*)|(?<![_\w])_([^\s_][^_]*?)_(?!_)/g },
    { name: "heading", re: /^(#{1,3}|#{4,6})\s+\S.*$/ } // line-start only, tested once per line
  ];

  // heading level -> css size class; #### - ###### collapse into the ### size
  function headingSizeClass(hashes) {
    var level = hashes.length;
    if (level >= 3) return "cie-h3";
    return "cie-h" + level;
  }

  // delimiter length per rule, used to split each match into
  // delimiter/inner/delimiter decorations so the delimiter characters render
  // dimmed (muted, always visible, never hidden) while only the inner text
  // gets the emphasis styling.
  var DELIM_LEN = { bold: 2, italic: 1 };

  // ---- scanner: pure function, no DOM/PM dependency ----------------------
  // Scans one block of text (a paragraph or heading-candidate line) and
  // returns an array of {name, from, to, hashLen} matches, in document
  // order, with no overlaps. No nesting support: once a range is claimed by
  // one rule, nothing else can match inside it (outer pair wins).
  function scanLine(text) {
    var matches = [];
    var claimed = []; // sorted array of [from, to) already-claimed ranges

    function isClaimed(from, to) {
      for (var i = 0; i < claimed.length; i++) {
        var c = claimed[i];
        if (from < c[1] && to > c[0]) return true;
      }
      return false;
    }
    function claim(from, to) { claimed.push([from, to]); }

    // heading: line-start only, tested once (not a global exec loop)
    var headingMatch = RULES[2].re.exec(text);
    if (headingMatch) {
      var hashes = headingMatch[1];
      var from = headingMatch.index;
      var to = from + hashes.length; // decorate only the leading hashes+space marker region is handled by caller; we report the hash range
      matches.push({ name: "heading", from: from, to: from + text.length, hashLen: hashes.length, sizeClass: headingSizeClass(hashes) });
      // heading claims the whole line for rendering purposes, but inline
      // rules (bold/italic) may still run inside it, so we do NOT add it to
      // `claimed` — it's a block-level decoration, not an inline exclusion.
    }

    for (var r = 0; r < 2; r++) {
      var rule = RULES[r];
      rule.re.lastIndex = 0;
      var m;
      while ((m = rule.re.exec(text)) !== null) {
        var mFrom = m.index;
        var mTo = m.index + m[0].length;
        if (mFrom === mTo) { rule.re.lastIndex++; continue; } // guard zero-length
        if (isClaimed(mFrom, mTo)) continue;
        matches.push({ name: rule.name, from: mFrom, to: mTo });
        claim(mFrom, mTo);
      }
    }

    // sort by position for deterministic decoration ordering
    matches.sort(function (a, b) { return a.from - b.from || (a.name === "heading" ? -1 : 1); });
    return matches;
  }

  // ---- Plugin/DecorationSet sourcing (isolated + unit-testable) ---------
  // Reads the real Plugin/DecorationSet classes out of the app's own
  // already-loaded ProseMirror bundle via editor.extensionManager.plugins,
  // per plan.md's sourcing algorithm:
  //   1. plugins[0].constructor is the real Plugin class.
  //   2. Walk the array for an entry whose props.decorations is a function;
  //      call it against editor.view.state; the result's constructor is the
  //      real DecorationSet class.
  //   3. Verify `new PluginCtor({props:{}})` does not throw, and the
  //      Decoration/DecorationSet instance passes `instanceof` checks
  //      against editor.view.state.plugins entries.
  // Returns null (never throws) if anything about the expected shape is
  // missing/mangled — callers must treat null as "skip this instance".
  function sourcePlugin(editor) {
    try {
      if (!editor || !editor.extensionManager || !Array.isArray(editor.extensionManager.plugins)) return null;
      var plugins = editor.extensionManager.plugins;
      if (!plugins.length) return null;

      var PluginCtor = plugins[0] && plugins[0].constructor;
      if (typeof PluginCtor !== "function") return null;

      var DecorationSetCtor = null;
      var DecorationCtor = null;
      var state = editor.view && editor.view.state;
      for (var i = 0; i < plugins.length; i++) {
        var p = plugins[i];
        var decosFn = p && p.props && p.props.decorations;
        if (typeof decosFn !== "function" || !state) continue;
        var result;
        try { result = decosFn(state); } catch (e) { continue; }
        if (!result || !result.constructor) continue;
        DecorationSetCtor = result.constructor;
        // recover the singular Decoration constructor from any decoration
        // this set already contains (find() returns live Decoration
        // instances); if this set happens to be empty, keep scanning other
        // plugins' decoration sets before giving up.
        try {
          var found = typeof result.find === "function" ? result.find() : null;
          if (found && found.length && found[0] && found[0].constructor) {
            DecorationCtor = found[0].constructor;
            break;
          }
        } catch (e2) { /* keep DecorationSetCtor, keep scanning for Decoration */ }
      }
      if (!DecorationSetCtor) return null;

      // verify PluginCtor is actually constructible per plan.md's go/no-go check
      var probe;
      try { probe = new PluginCtor({ props: {} }); } catch (e) { return null; }

      // verify instanceof against the live view's own plugin list, when available
      if (state && Array.isArray(state.plugins) && state.plugins.length) {
        if (!(state.plugins[0] instanceof PluginCtor)) return null;
      }

      return { Plugin: PluginCtor, DecorationSet: DecorationSetCtor, Decoration: DecorationCtor, probe: probe };
    } catch (e) {
      return null;
    }
  }

  // ---- decoration building (per-instance) --------------------------------
  // Builds a DecorationSet-shaped result from the current doc's text blocks.
  // Wrapped by the caller's decorations(state) in its own try/catch — this
  // function may throw (e.g. on unexpected doc shape) and that is expected
  // to be caught one level up, once, with a single console.warn.
  function buildDecorations(doc, DecorationSetCtor, DecorationCtor) {
    var decos = [];
    doc.descendants(function (node, pos) {
      if (!node.isTextblock) return;
      var text = node.textContent || "";
      if (!text) return;
      var blockMatches = scanLine(text);
      blockMatches.forEach(function (m) {
        var from = pos + 1 + m.from;
        var to = pos + 1 + Math.min(m.to, text.length);

        if (m.name === "heading") {
          // hashes render dimmed (delimiter); the heading text after the
          // leading whitespace gets the size/weight styling. The single
          // space between them is left undecorated.
          var hashTo = from + m.hashLen;
          var rest = text.slice(m.hashLen);
          var wsLen = (rest.match(/^\s+/) || [""])[0].length;
          var textFrom = hashTo + wsLen;
          decos.push(DecorationCtor.inline(from, hashTo, { class: "cie-delim cie-delim-heading" }));
          if (textFrom < to) {
            decos.push(DecorationCtor.inline(textFrom, to, { class: "cie-heading " + m.sizeClass }));
          }
          return;
        }

        var delimLen = DELIM_LEN[m.name] || 0;
        if (delimLen > 0 && (to - from) >= delimLen * 2) {
          decos.push(DecorationCtor.inline(from, from + delimLen, { class: "cie-delim cie-delim-" + m.name }));
          decos.push(DecorationCtor.inline(from + delimLen, to - delimLen, { class: "cie-" + m.name }));
          decos.push(DecorationCtor.inline(to - delimLen, to, { class: "cie-delim cie-delim-" + m.name }));
        } else {
          decos.push(DecorationCtor.inline(from, to, { class: "cie-" + m.name }));
        }
      });
    });
    return DecorationSetCtor.create(doc, decos);
  }

  // ---- per-instance install -----------------------------------------------
  var instances = []; // { root, editor, plugin, timer, warned, destroy() }

  function installOn(root) {
    try {
      var editor = root && root.editor;
      if (!editor || typeof editor.registerPlugin !== "function") {
        console.warn("[chat-input-extension] composer found but editor.registerPlugin is missing; skipping this instance.");
        return null;
      }

      var sourced = sourcePlugin(editor);
      if (!sourced) {
        console.warn("[chat-input-extension] could not source Plugin/DecorationSet from this editor's bundle; skipping this instance.");
        return null;
      }

      var PluginCtor = sourced.Plugin;
      var DecorationSetCtor = sourced.DecorationSet;
      var DecorationCtor = sourced.Decoration;
      if (!DecorationCtor) {
        console.warn("[chat-input-extension] could not locate a Decoration constructor; skipping this instance.");
        return null;
      }

      var warnedOnce = false;
      var timer = null;
      var currentSet = DecorationSetCtor.empty;

      function recompute(state) {
        try {
          currentSet = buildDecorations(state.doc, DecorationSetCtor, DecorationCtor);
        } catch (e) {
          if (!warnedOnce) {
            console.warn("[chat-input-extension] decoration pass failed; showing no decorations for this instance until the next successful pass.", e);
            warnedOnce = true;
          }
          currentSet = DecorationSetCtor.empty;
        }
      }

      var pmPlugin = new PluginCtor({
        key: undefined, // PluginKey is optional; app's Plugin ctor tolerates a plain object
        props: {
          decorations: function (state) {
            // This callback runs on every ProseMirror transaction, not just
            // at install time — it must never throw, or typing/sending
            // breaks. Always return a valid (possibly empty) DecorationSet.
            try {
              return currentSet || DecorationSetCtor.empty;
            } catch (e) {
              if (!warnedOnce) {
                console.warn("[chat-input-extension] decorations(state) threw; returning an empty set.", e);
                warnedOnce = true;
              }
              try { return DecorationSetCtor.empty; } catch (e2) { return null; }
            }
          }
        },
        view: function (view) {
          return {
            update: function (view2, prevState) {
              try {
                if (!view2.state.doc.eq(prevState.doc)) {
                  scheduleRecompute(view2);
                }
              } catch (e) { /* never break typing */ }
            },
            destroy: function () {
              if (timer) { clearTimeout(timer); timer = null; }
            }
          };
        }
      });

      function scheduleRecompute(view) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          timer = null;
          recompute(view.state);
          try {
            view.dispatch(view.state.tr.setMeta(PLUGIN_KEY, true));
          } catch (e) { /* never break typing */ }
        }, DEBOUNCE_MS);
      }

      editor.registerPlugin(pmPlugin);
      // run an initial pass immediately so pre-existing content decorates
      // without waiting for the first keystroke
      recompute(editor.view.state);

      var instance = {
        root: root,
        editor: editor,
        plugin: pmPlugin,
        getTimer: function () { return timer; },
        destroy: function () {
          if (timer) { clearTimeout(timer); timer = null; }
          try {
            if (typeof editor.unregisterPlugin === "function") {
              editor.unregisterPlugin(pmPlugin);
            } else if (pmPlugin.spec && pmPlugin.spec.key) {
              editor.unregisterPlugin(pmPlugin.spec.key);
            }
          } catch (e) { /* best effort */ }
        },
        // test hooks (harmless in production; never called by app code)
        _scheduleRecompute: scheduleRecompute,
        _recompute: recompute,
        _getSet: function () { return currentSet; }
      };
      return instance;
    } catch (e) {
      console.warn("[chat-input-extension] failed to install on a composer instance; skipping it.", e);
      return null;
    }
  }

  // ---- multi-instance discovery + MutationObserver fallback --------------
  var observer = null;

  function scanAndInstall() {
    var nodes = document.querySelectorAll(COMPOSER_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var already = instances.some(function (inst) { return inst.root === node; });
      if (already) continue;
      var inst = installOn(node);
      if (inst) instances.push(inst);
    }
  }

  function startObserver() {
    try {
      observer = new MutationObserver(function () { scanAndInstall(); });
      observer.observe(document.body, { childList: true, subtree: true });
    } catch (e) {
      console.warn("[chat-input-extension] MutationObserver could not be started; composers mounted later will not be picked up automatically.", e);
    }
  }

  // ---- styles --------------------------------------------------------------
  var style = document.createElement("style");
  style.setAttribute("data-chat-input-extension", "1");
  style.textContent = [
    ".cie-bold{font-weight:700;}",
    ".cie-italic{font-style:italic;}",
    ".cie-heading{font-weight:600;}",
    ".cie-h1{font-size:1.5em;}",
    ".cie-h2{font-size:1.3em;}",
    ".cie-h3{font-size:1.15em;}",
    // delimiters stay visible, just muted/dimmed — never hidden, so cursor
    // placement between a delimiter and the word is always exact
    ".cie-delim{color:#8f8d88;font-weight:400;font-style:normal;",
    "  text-decoration:none;background:none;}"
  ].join("");
  document.documentElement.appendChild(style);

  // ---- boot ----------------------------------------------------------------
  scanAndInstall();
  startObserver();

  window.__chatInputExtension = {
    destroy: function () {
      instances.forEach(function (inst) {
        try { inst.destroy(); } catch (e) { /* best effort */ }
      });
      instances = [];
      try { if (observer) observer.disconnect(); } catch (e) {}
      observer = null;
      try { if (style && style.parentNode) style.parentNode.removeChild(style); } catch (e) {}
      delete window.__chatInputExtension;
    },
    // exposed for debugging/testing only — not used by the app
    _instances: instances,
    _sourcePlugin: sourcePlugin,
    _scanLine: scanLine,
    _RULES: RULES
  };

  console.log(
    "[chat-input-extension] running on " + instances.length + " composer instance(s). " +
    "Remove with window.__chatInputExtension.destroy() — or just reload the page; " +
    "this script is not persisted anywhere, so a reload fully removes it."
  );
})();
