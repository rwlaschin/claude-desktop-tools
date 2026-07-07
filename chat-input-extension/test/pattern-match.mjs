// Pattern-matching correctness: RULES offsets, match order/precedence,
// unclosed-delimiter no-match, heading line-start-only.
// Inline code and strikethrough are deliberately not covered — live testing
// against the real app showed both already render natively (real marks,
// delimiters disappear entirely), so decoration rules for them were removed
// as redundant.
import { JSDOM } from "jsdom";
import fs from "fs";
import assert from "assert";

const src = fs.readFileSync(new URL("../chat-input-extension.js", import.meta.url), "utf8");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://claude.ai/", runScripts: "outside-only" });
const w = dom.window;
w.eval(src);
const api = w.__chatInputExtension;
assert.ok(api, "window.__chatInputExtension should exist after load");

const scanLine = api._scanLine;
const RULES = api._RULES;

// ---- RULES table shape ---------------------------------------------------
assert.strictEqual(RULES.length, 3, "RULES should have 3 entries");
// RULES/array objects live in the jsdom realm, so compare via plain
// primitives (joined string) rather than assert.deepStrictEqual, which
// checks cross-realm prototype identity and would false-fail here.
assert.strictEqual(
  Array.prototype.map.call(RULES, r => r.name).join(","),
  ["bold", "italic", "heading"].join(","),
  "RULES must be in bold, italic, heading order"
);

// ---- each rule matches its own pattern with correct offsets --------------
{
  const matches = scanLine("**bold**");
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].name, "bold");
  assert.strictEqual(matches[0].from, 0);
  assert.strictEqual(matches[0].to, 8);
}
{
  const matches = scanLine("*italic*");
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].name, "italic");
  assert.strictEqual(matches[0].from, 0);
  assert.strictEqual(matches[0].to, 8);
}
{
  const matches = scanLine("# heading");
  const heading = matches.find(m => m.name === "heading");
  assert.ok(heading, "heading rule should match a line starting with #");
  assert.strictEqual(heading.from, 0);
}

// ---- italic regex does not fire adjacent to a ** bold run -----------------
{
  const matches = scanLine("**bold**");
  const italics = matches.filter(m => m.name === "italic");
  assert.strictEqual(italics.length, 0, "a **bold** run must not also produce an italic match on its inner asterisks");
}
{
  // two adjacent bold runs back to back should still not spuriously produce italics
  const matches = scanLine("**one** **two**");
  const italics = matches.filter(m => m.name === "italic");
  assert.strictEqual(italics.length, 0);
  const bolds = matches.filter(m => m.name === "bold");
  assert.strictEqual(bolds.length, 2);
}

// ---- unclosed delimiter produces no match (Use Case 1 alternate flow) ----
{
  const matches = scanLine("**bold with no close");
  const bolds = matches.filter(m => m.name === "bold");
  assert.strictEqual(bolds.length, 0, "an unclosed ** delimiter must not decorate until closed");
}
{
  const matches = scanLine("*italic with no close");
  const italics = matches.filter(m => m.name === "italic");
  assert.strictEqual(italics.length, 0, "an unclosed * delimiter must not decorate until closed");
}
// ---- heading only matches at line start -----------------------------------
{
  const matches = scanLine("not a # heading because it's not at line start");
  const headings = matches.filter(m => m.name === "heading");
  assert.strictEqual(headings.length, 0, "a # not at line start must not match the heading rule");
}
{
  const matches = scanLine("### Level three");
  const heading = matches.find(m => m.name === "heading");
  assert.ok(heading);
  assert.strictEqual(heading.sizeClass, "cie-h3");
}
{
  // #### through ###### collapse into the ### size
  ["####", "#####", "######"].forEach(hashes => {
    const matches = scanLine(hashes + " Deep heading");
    const heading = matches.find(m => m.name === "heading");
    assert.ok(heading, hashes + " should still match the heading rule");
    assert.strictEqual(heading.sizeClass, "cie-h3", hashes + " must collapse into the h3 size class");
  });
}
{
  const h1 = scanLine("# One").find(m => m.name === "heading");
  const h2 = scanLine("## Two").find(m => m.name === "heading");
  assert.strictEqual(h1.sizeClass, "cie-h1");
  assert.strictEqual(h2.sizeClass, "cie-h2");
}

// ---- no nesting support in v1 ------------------------------------------
// plan.md's bold regex is `\*\*([^\s*][^*]*?)\*\*` — its inner character
// class ([^*]*?) excludes literal "*" entirely, so it structurally cannot
// span an embedded *italic* run. Given the exact RULES regex specified in
// plan.md (which this test must match byte-for-byte per the plan), the
// bold rule simply produces no match at all on "**bold *italic* still
// bold**", and the *italic* segment WITHIN it is picked up by the italic
// rule instead. This is the correct, literal behavior of the specified
// regex table for this input — no nested/overlapping decorations are ever
// produced (single decoration, not two overlapping ones), which is what
// "no nesting support" guarantees at the regex level.
{
  const text = "**bold *italic* still bold**";
  const matches = scanLine(text);
  const bolds = matches.filter(m => m.name === "bold");
  const italics = matches.filter(m => m.name === "italic");
  assert.strictEqual(bolds.length, 0, "the bold regex's [^*]*? class cannot span an embedded * run, per plan.md's literal RULES table");
  assert.strictEqual(italics.length, 1, "the embedded *italic* run is matched by the italic rule");
  assert.strictEqual(text.slice(italics[0].from, italics[0].to), "*italic*");
  // no overlapping/duplicate decorations are ever produced for the same span
  const spans = matches.map(m => m.from + ":" + m.to);
  assert.strictEqual(spans.length, new Set(spans).size, "no duplicate/overlapping decorations for the same range");
}

// ---- three independent runs on one line (Use Case 2) ------------------------
{
  const text = "**bold** this is not bold **bold again**";
  const matches = scanLine(text).filter(m => m.name === "bold");
  assert.strictEqual(matches.length, 2, "exactly two bold runs should be found");
  assert.strictEqual(text.slice(matches[0].from, matches[0].to), "**bold**");
  assert.strictEqual(text.slice(matches[1].from, matches[1].to), "**bold again**");
}

console.log("pattern-match.mjs: all assertions passed");
