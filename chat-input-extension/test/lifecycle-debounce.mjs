// Debounce/lifecycle: timer resets on every simulated keystroke, the
// recompute callback fires exactly once (400ms after the LAST keystroke,
// not on each one), and destroy() clears all pending timers.
import { JSDOM } from "jsdom";
import fs from "fs";
import assert from "assert";

const src = fs.readFileSync(new URL("../chat-input-extension.js", import.meta.url), "utf8");
const dom = new JSDOM("<!doctype html><html><body><div class=\"tiptap ProseMirror\"></div></body></html>", {
  url: "https://claude.ai/",
  runScripts: "outside-only"
});
const w = dom.window;

// ---- minimal fake ProseMirror kit, built inside the jsdom realm -----------
// Real Plugin/Decoration/DecorationSet classes, self-contained (no import of
// prosemirror-view — this test simulates the "app's own bundle" the real
// script sources its classes from via editor.extensionManager.plugins).
w.eval(`
  function FakeDecoration(from, to, attrs) { this.from = from; this.to = to; this.attrs = attrs; }
  FakeDecoration.inline = function (from, to, attrs) { return new FakeDecoration(from, to, attrs); };

  function FakeDecorationSet(decos) { this.decos = decos || []; }
  FakeDecorationSet.create = function (doc, decos) { return new FakeDecorationSet(decos); };
  FakeDecorationSet.empty = new FakeDecorationSet([]);
  FakeDecorationSet.prototype.find = function () { return this.decos; };

  function FakePlugin(spec) { this.spec = spec || {}; this.props = (spec && spec.props) || {}; this.key = spec && spec.key; }

  function makeDoc(text) {
    var block = { isTextblock: true, textContent: text };
    return {
      _text: text,
      descendants: function (cb) { cb(block, 0); },
      eq: function (other) { return other && other._text === this._text; }
    };
  }

  function makeState(text) {
    var doc = makeDoc(text);
    return {
      doc: doc,
      plugins: [],
      tr: { setMeta: function () { return this; } }
    };
  }

  window.__fakePm = { FakeDecoration, FakeDecorationSet, FakePlugin, makeDoc, makeState };
`);

const pm = w.__fakePm;

// stub decorations() prop that produces a real fake DecorationSet, so
// sourcePlugin() can recover both DecorationSet and Decoration constructors
const seedPlugin = new pm.FakePlugin({
  props: { decorations: function (state) { return pm.FakeDecorationSet.create(state.doc, [pm.FakeDecoration.inline(0, 1, {})]); } }
});

let currentText = "hello world";
const state = pm.makeState(currentText);
state.plugins = [seedPlugin];

const view = {
  state: state,
  dispatch: function (tr) { /* no-op transaction acknowledged */ }
};

let updateHook = null;
const editor = {
  extensionManager: { plugins: [seedPlugin] },
  view: view,
  registerPlugin: function (plugin) {
    // capture the view hook so the test can simulate ProseMirror calling it
    if (plugin && typeof plugin.spec.view === "function") {
      const viewInstance = plugin.spec.view(view);
      updateHook = viewInstance.update;
    }
  },
  unregisterPlugin: function () {}
};

const composerNode = w.document.querySelector(".tiptap.ProseMirror");
composerNode.editor = editor;

// Stub setTimeout/clearTimeout with a controllable fake clock so debounce
// timing can be asserted deterministically instead of racing real timers.
let now = 0;
let nextId = 1;
const pending = new Map(); // id -> {fireAt, fn}
w.setTimeout = function (fn, ms) {
  const id = nextId++;
  pending.set(id, { fireAt: now + ms, fn: fn });
  return id;
};
w.clearTimeout = function (id) { pending.delete(id); };
function advance(ms) {
  now += ms;
  const due = Array.from(pending.entries()).filter(([, t]) => t.fireAt <= now).sort((a, b) => a[0] - b[0]);
  due.forEach(([id, t]) => { pending.delete(id); t.fn(); });
}

w.eval(src);
const api = w.__chatInputExtension;
assert.strictEqual(api._instances.length, 1, "one composer instance should have installed");

let dispatchCalls = 0;
const originalDispatch = view.dispatch;
view.dispatch = function (tr) { dispatchCalls++; return originalDispatch(tr); };

function simulateKeystroke(newText) {
  const prevState = { doc: state.doc };
  currentText = newText;
  state.doc = pm.makeDoc(currentText);
  updateHook(view, prevState);
}

// simulate 5 keystrokes 100ms apart (well under the 400ms debounce window);
// each one should RESET the timer, not add a new one
for (let i = 0; i < 5; i++) {
  simulateKeystroke("hello world " + i);
  advance(100);
}
assert.strictEqual(dispatchCalls, 0, "the debounced recompute must not have fired yet — every keystroke should have reset the timer");

// now let the full debounce window elapse with no further keystrokes
advance(400);
assert.strictEqual(dispatchCalls, 1, "the recompute callback must fire exactly once, 400ms after the LAST keystroke");

// a further idle period must not fire it again
advance(1000);
assert.strictEqual(dispatchCalls, 1, "no further recompute should fire without a new keystroke");

// ---- destroy() clears all pending timers -----------------------------------
simulateKeystroke("one more edit");
assert.strictEqual(pending.size, 1, "a debounce timer should be pending after a keystroke");
api.destroy();
assert.strictEqual(pending.size, 0, "destroy() must clear all pending debounce timers");
advance(1000);
assert.strictEqual(dispatchCalls, 1, "no recompute should fire after destroy(), even after the debounce window would have elapsed");

console.log("lifecycle-debounce.mjs: all assertions passed");
