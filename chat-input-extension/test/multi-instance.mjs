// Multi-instance discovery: 0, 1, and 2 fake .tiptap.ProseMirror nodes,
// correct attach count, independent decoration/debounce state per instance,
// and a composer added to the DOM after script load is picked up via the
// MutationObserver fallback.
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

function attachFakeEditor(w, node, text) {
  const pm = w.__fakePm;
  const seedPlugin = new pm.FakePlugin({
    props: { decorations: function (state) { return pm.FakeDecorationSet.create(state.doc, [pm.FakeDecoration.inline(0, 1, {})]); } }
  });
  const doc = pm.makeDoc(text);
  const state = { doc: doc, plugins: [seedPlugin], tr: { setMeta: function () { return this; } } };
  const view = { state: state, dispatch: function () {} };
  const editor = {
    extensionManager: { plugins: [seedPlugin] },
    view: view,
    registerPlugin: function () {},
    unregisterPlugin: function () {}
  };
  node.editor = editor;
  return editor;
}

// ---- 0 composer instances ---------------------------------------------
{
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://claude.ai/", runScripts: "outside-only" });
  const w = dom.window;
  fakePmSetup(w);
  w.eval(src);
  const api = w.__chatInputExtension;
  assert.strictEqual(api._instances.length, 0, "no composer nodes in the DOM should mean 0 installed instances");
  assert.doesNotThrow(() => api.destroy(), "destroy() must be safe to call even with zero installed instances");
}

// ---- 1 composer instance ------------------------------------------------
{
  const dom = new JSDOM("<!doctype html><html><body><div class=\"tiptap ProseMirror\"></div></body></html>", { url: "https://claude.ai/", runScripts: "outside-only" });
  const w = dom.window;
  fakePmSetup(w);
  const node = w.document.querySelector(".tiptap.ProseMirror");
  attachFakeEditor(w, node, "hello");
  w.eval(src);
  const api = w.__chatInputExtension;
  assert.strictEqual(api._instances.length, 1, "one composer node should mean exactly 1 installed instance");
  api.destroy();
}

// ---- 2 composer instances with independent state -------------------------
{
  const dom = new JSDOM(
    "<!doctype html><html><body><div id=\"a\" class=\"tiptap ProseMirror\"></div><div id=\"b\" class=\"tiptap ProseMirror\"></div></body></html>",
    { url: "https://claude.ai/", runScripts: "outside-only" }
  );
  const w = dom.window;
  fakePmSetup(w);
  const nodeA = w.document.getElementById("a");
  const nodeB = w.document.getElementById("b");
  attachFakeEditor(w, nodeA, "**bold in A**");
  attachFakeEditor(w, nodeB, "*italic in B*");
  w.eval(src);
  const api = w.__chatInputExtension;
  assert.strictEqual(api._instances.length, 2, "two composer nodes should mean exactly 2 installed instances");

  const instA = api._instances.find(i => i.root === nodeA);
  const instB = api._instances.find(i => i.root === nodeB);
  assert.ok(instA && instB, "each instance should be traceable back to its own root node");
  assert.notStrictEqual(instA.plugin, instB.plugin, "each instance must have its own independent plugin object");

  const decosA = instA.plugin.props.decorations(nodeA.editor.view.state).find();
  const decosB = instB.plugin.props.decorations(nodeB.editor.view.state).find();
  assert.ok(decosA.some(d => d.attrs.class === "cie-bold"), "instance A's decorations reflect its own bold text");
  assert.ok(decosB.some(d => d.attrs.class === "cie-italic"), "instance B's decorations reflect its own italic text");
  assert.strictEqual(decosA.some(d => d.attrs.class === "cie-italic"), false, "instance A must not pick up instance B's italic decoration");
  assert.strictEqual(decosB.some(d => d.attrs.class === "cie-bold"), false, "instance B must not pick up instance A's bold decoration");

  // destroying the whole extension must tear down both instances
  api.destroy();
  assert.strictEqual(w.__chatInputExtension, undefined, "destroy() must remove the global API entirely");
}

// ---- a composer mounted AFTER script load is picked up via MutationObserver
{
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://claude.ai/", runScripts: "outside-only" });
  const w = dom.window;
  fakePmSetup(w);
  w.eval(src);
  const api = w.__chatInputExtension;
  assert.strictEqual(api._instances.length, 0, "no composer exists yet at script load");

  const lateNode = w.document.createElement("div");
  lateNode.className = "tiptap ProseMirror";
  attachFakeEditor(w, lateNode, "late arrival");
  w.document.body.appendChild(lateNode);

  // MutationObserver callbacks are microtask/macrotask-scheduled by jsdom;
  // give the event loop a couple of turns to let it fire.
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.strictEqual(api._instances.length, 1, "a composer mounted after script load must be picked up via the MutationObserver fallback, no manual re-run needed");
  assert.strictEqual(api._instances[0].root, lateNode);

  api.destroy();
}

console.log("multi-instance.mjs: all assertions passed");
