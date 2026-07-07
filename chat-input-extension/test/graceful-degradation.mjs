// Graceful degradation: removing/mangling registerPlugin or the expected
// editor structure must warn via console.warn, never throw, and other valid
// composer instances must still install. Covers Use Case 1's Exception.
import { JSDOM } from "jsdom";
import fs from "fs";
import assert from "assert";

const src = fs.readFileSync(new URL("../chat-input-extension.js", import.meta.url), "utf8");

function fakePmSetup(w) {
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

    window.__fakePm = { FakeDecoration, FakeDecorationSet, FakePlugin, makeDoc };
  `);
  return w.__fakePm;
}

function goodEditor(w, text) {
  const pm = w.__fakePm;
  const seedPlugin = new pm.FakePlugin({
    props: { decorations: function (state) { return pm.FakeDecorationSet.create(state.doc, [pm.FakeDecoration.inline(0, 1, {})]); } }
  });
  const doc = pm.makeDoc(text);
  const state = { doc: doc, plugins: [seedPlugin], tr: { setMeta: function () { return this; } } };
  const view = { state: state, dispatch: function () {} };
  return {
    extensionManager: { plugins: [seedPlugin] },
    view: view,
    registerPlugin: function () {},
    unregisterPlugin: function () {}
  };
}

function captureWarnings(w) {
  const calls = [];
  w.console.warn = function (...args) { calls.push(args); };
  return calls;
}

// ---- registerPlugin missing entirely --------------------------------------
{
  const dom = new JSDOM("<!doctype html><html><body><div class=\"tiptap ProseMirror\"></div></body></html>", { url: "https://claude.ai/", runScripts: "outside-only" });
  const w = dom.window;
  fakePmSetup(w);
  const node = w.document.querySelector(".tiptap.ProseMirror");
  const ed = goodEditor(w, "hello");
  delete ed.registerPlugin;
  node.editor = ed;

  const warnings = captureWarnings(w);
  assert.doesNotThrow(() => { w.eval(src); }, "a missing registerPlugin must never throw during install");
  assert.ok(warnings.length > 0, "a console.warn must fire when registerPlugin is missing");
  assert.strictEqual(w.__chatInputExtension._instances.length, 0, "no instance should be recorded as installed for this composer");
  w.__chatInputExtension.destroy();
}

// ---- registerPlugin throws -------------------------------------------------
{
  const dom = new JSDOM("<!doctype html><html><body><div class=\"tiptap ProseMirror\"></div></body></html>", { url: "https://claude.ai/", runScripts: "outside-only" });
  const w = dom.window;
  fakePmSetup(w);
  const node = w.document.querySelector(".tiptap.ProseMirror");
  const ed = goodEditor(w, "hello");
  ed.registerPlugin = function () { throw new Error("boom"); };
  node.editor = ed;

  const warnings = captureWarnings(w);
  assert.doesNotThrow(() => { w.eval(src); }, "a throwing registerPlugin must never propagate out of install");
  assert.ok(warnings.length > 0, "a console.warn must fire when registerPlugin throws");
  assert.strictEqual(w.__chatInputExtension._instances.length, 0);
  w.__chatInputExtension.destroy();
}

// ---- editor missing entirely (composer node with no .editor) --------------
{
  const dom = new JSDOM("<!doctype html><html><body><div class=\"tiptap ProseMirror\"></div></body></html>", { url: "https://claude.ai/", runScripts: "outside-only" });
  const w = dom.window;
  fakePmSetup(w);
  // deliberately leave .editor unset

  const warnings = captureWarnings(w);
  assert.doesNotThrow(() => { w.eval(src); });
  assert.ok(warnings.length > 0, "a console.warn must fire when the composer has no live .editor");
  assert.strictEqual(w.__chatInputExtension._instances.length, 0);
  w.__chatInputExtension.destroy();
}

// ---- extensionManager.plugins missing/mangled (sourcePlugin go/no-go) -----
{
  const dom = new JSDOM("<!doctype html><html><body><div class=\"tiptap ProseMirror\"></div></body></html>", { url: "https://claude.ai/", runScripts: "outside-only" });
  const w = dom.window;
  fakePmSetup(w);
  const node = w.document.querySelector(".tiptap.ProseMirror");
  const ed = goodEditor(w, "hello");
  ed.extensionManager = { plugins: "not an array" }; // mangled shape
  node.editor = ed;

  const warnings = captureWarnings(w);
  assert.doesNotThrow(() => { w.eval(src); });
  assert.ok(warnings.length > 0, "a console.warn must fire when Plugin/DecorationSet sourcing fails");
  assert.strictEqual(w.__chatInputExtension._instances.length, 0);
  w.__chatInputExtension.destroy();
}

// ---- one bad instance must not prevent other valid instances from installing
{
  const dom = new JSDOM(
    "<!doctype html><html><body><div id=\"bad\" class=\"tiptap ProseMirror\"></div><div id=\"good\" class=\"tiptap ProseMirror\"></div></body></html>",
    { url: "https://claude.ai/", runScripts: "outside-only" }
  );
  const w = dom.window;
  fakePmSetup(w);
  const badNode = w.document.getElementById("bad");
  const goodNode = w.document.getElementById("good");

  const badEd = goodEditor(w, "bad one");
  delete badEd.registerPlugin; // this one is mangled
  badNode.editor = badEd;
  goodNode.editor = goodEditor(w, "good one"); // this one is fine

  const warnings = captureWarnings(w);
  assert.doesNotThrow(() => { w.eval(src); });
  assert.ok(warnings.length > 0, "the bad instance should still produce a warning");
  const api = w.__chatInputExtension;
  assert.strictEqual(api._instances.length, 1, "exactly the good instance should have installed");
  assert.strictEqual(api._instances[0].root, goodNode, "the surviving instance must be the good composer, not the bad one");
  api.destroy();
}

// ---- sourcePlugin() unit-level: stubbed editor with missing/mangled structure
{
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://claude.ai/", runScripts: "outside-only" });
  const w = dom.window;
  fakePmSetup(w);
  w.eval(src);
  const sourcePlugin = w.__chatInputExtension._sourcePlugin;

  assert.strictEqual(sourcePlugin(null), null, "sourcePlugin(null) must return null, not throw");
  assert.strictEqual(sourcePlugin(undefined), null);
  assert.strictEqual(sourcePlugin({}), null, "an editor with no extensionManager must return null");
  assert.strictEqual(sourcePlugin({ extensionManager: {} }), null, "an editor with no plugins array must return null");
  assert.strictEqual(sourcePlugin({ extensionManager: { plugins: [] } }), null, "an empty plugins array must return null");
  assert.strictEqual(
    sourcePlugin({ extensionManager: { plugins: [{ constructor: "not a function" }] } }),
    null,
    "a plugins[0] whose constructor isn't callable must return null"
  );

  w.__chatInputExtension.destroy();
}

console.log("graceful-degradation.mjs: all assertions passed");
