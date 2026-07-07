// Decoration-building layer: against a stubbed editor ({registerPlugin,
// state, view}), assert decorations(state) returns a DecorationSet-shaped
// result with the correct count, class, and range for seeded multi-pattern
// and multi-run-per-line text — the exact fixture from Use Case 2.
import { JSDOM } from "jsdom";
import fs from "fs";
import assert from "assert";

const src = fs.readFileSync(new URL("../chat-input-extension.js", import.meta.url), "utf8");
const dom = new JSDOM("<!doctype html><html><body><div class=\"tiptap ProseMirror\"></div></body></html>", {
  url: "https://claude.ai/",
  runScripts: "outside-only"
});
const w = dom.window;

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

const pm = w.__fakePm;

function buildEditorFor(text) {
  const seedPlugin = new pm.FakePlugin({
    props: { decorations: function (state) { return pm.FakeDecorationSet.create(state.doc, [pm.FakeDecoration.inline(0, 1, {})]); } }
  });
  const doc = pm.makeDoc(text);
  const state = { doc: doc, plugins: [seedPlugin], tr: { setMeta: function () { return this; } } };
  const view = { state: state, dispatch: function () {} };
  let installedPlugin = null;
  const editor = {
    extensionManager: { plugins: [seedPlugin] },
    view: view,
    registerPlugin: function (plugin) { installedPlugin = plugin; },
    unregisterPlugin: function () {}
  };
  return { editor: editor, view: view, state: state, getInstalledPlugin: () => installedPlugin };
}

// ---- Use Case 2's exact fixture: three independent runs on one line -------
{
  const text = "**bold** this is not bold **bold again**";
  const { editor } = buildEditorFor(text);
  const composerNode = w.document.querySelector(".tiptap.ProseMirror");
  composerNode.editor = editor;

  w.eval(src);
  const api = w.__chatInputExtension;
  assert.strictEqual(api._instances.length, 1, "one composer instance should install for this fixture");
  const inst = api._instances[0];

  const decoSet = inst.plugin.props.decorations(editor.view.state);
  assert.ok(decoSet, "decorations(state) must return a value");
  assert.strictEqual(typeof decoSet.find, "function", "the returned value must be DecorationSet-shaped (has .find())");

  const decos = decoSet.find();
  // each bold run now splits into delim/inner/delim decorations, so the
  // delimiter characters can render dimmed while only the word is bold.
  const boldInnerDecos = decos.filter(d => d.attrs.class === "cie-bold");
  const boldDelimDecos = decos.filter(d => d.attrs.class === "cie-delim cie-delim-bold");
  assert.strictEqual(boldInnerDecos.length, 2, "exactly two bold inner-text decorations should be produced");
  assert.strictEqual(boldDelimDecos.length, 4, "exactly four bold delimiter decorations (open+close per run) should be produced");
  assert.strictEqual(text.slice(boldInnerDecos[0].from - 1, boldInnerDecos[0].to - 1), "bold");
  assert.strictEqual(text.slice(boldInnerDecos[1].from - 1, boldInnerDecos[1].to - 1), "bold again");
  // reassembling delim+inner+delim for each run reproduces the original text
  const fullFirst = boldDelimDecos[0].from < boldInnerDecos[0].from
    ? text.slice(boldDelimDecos[0].from - 1, boldDelimDecos[1].to - 1)
    : text.slice(boldDelimDecos[1].from - 1, boldDelimDecos[0].to - 1);
  assert.strictEqual(fullFirst, "**bold**");
  // the middle plain-text run must have no decoration covering it
  const middleFrom = text.indexOf("this is not bold");
  const middleTo = middleFrom + "this is not bold".length;
  const overlapsMiddle = decos.some(d => (d.from - 1) < middleTo && (d.to - 1) > middleFrom);
  assert.strictEqual(overlapsMiddle, false, "the plain-text run between the two bold runs must have no decoration");

  api.destroy();
}

// ---- multi-pattern fixture: bold, italic, heading together ----------------
// (code/strike deliberately excluded — the app renders those natively)
{
  const text = "# Heading **bold** *italic*";
  const { editor } = buildEditorFor(text);
  const composerNode = w.document.querySelector(".tiptap.ProseMirror");
  composerNode.editor = editor;

  w.eval(src);
  const api = w.__chatInputExtension;
  const inst = api._instances[0];
  const decoSet = inst.plugin.props.decorations(editor.view.state);
  const decos = decoSet.find();
  const classes = decos.map(d => d.attrs.class).sort();

  assert.ok(classes.some(c => c.indexOf("cie-heading") === 0), "a heading decoration should be present");
  assert.ok(classes.includes("cie-bold"), "a bold decoration should be present");
  assert.ok(classes.includes("cie-italic"), "an italic decoration should be present");

  api.destroy();
}

console.log("decoration-apply.mjs: all assertions passed");
