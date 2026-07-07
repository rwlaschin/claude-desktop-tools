import { JSDOM } from "jsdom"; import fs from "fs";
// looksLikeQuestion() fixtures per plan.md: ends-with-"?" primary signal,
// each phrase-opener in the regex as a secondary signal (checked against the
// first 60 chars), a plain statement returns false, empty/null returns
// false. Also covers the async-fetch caveat: seed transcriptCache[id] empty
// then populated mid-test, assert state()'s resolved value changes on the
// next call.
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
const w=dom.window;
w.Notification=function(){};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
w.setInterval=()=>1;w.clearInterval=()=>{};
w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:[]},version:0}));
w["claude.web"]={LocalSessions:{getAll(){return w.Promise.resolve([]);},onOnEvent(){return()=>{};},setFocusedSession(){},getTranscript(){return w.Promise.resolve([]);}}};
w.eval(src);

const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};
// looksLikeQuestion isn't exported on window, so reach it via a fresh eval
// in a throwaway scope that returns it — the function is defined with `var`
// inside the IIFE, so it's not directly reachable; instead re-derive the
// same logic surface indirectly through a second, minimal harness that
// exposes it for direct unit testing.
function extractFn(name) {
  // hotbar.js is a single self-invoking (function(){...})() — pull the fn
  // source out and eval it standalone against the same constants, so this
  // test exercises the ACTUAL regex/logic defined in hotbar.js, not a copy.
  var m = src.match(new RegExp("function " + name + "\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}"));
  if (!m) throw new Error("could not locate function " + name + " in hotbar.js");
  return m[0];
}
var openerLine = src.match(/var QUESTION_OPENER_RE = .*?;/)[0];
var looksLikeQuestionSrc = extractFn("looksLikeQuestion");
var fn = new Function(openerLine + "\n" + looksLikeQuestionSrc + "; return looksLikeQuestion;")();

// 1. ends with "?"
ok(fn("Should we ship this today?")===true, "ends-with-? returns true");
ok(fn("Is this ready?   ")===true, "ends-with-? tolerates trailing whitespace");

// 2. each phrase-opener in the regex
["could you", "would you like", "should i", "which one", "do you want", "can you", "what would you"].forEach(function (opener) {
  var text = opener.charAt(0).toUpperCase() + opener.slice(1) + " confirm the deploy plan";
  ok(fn(text)===true, "phrase-opener '" + opener + "' returns true: " + JSON.stringify(text));
});

// case-insensitivity
ok(fn("COULD YOU confirm this")===true, "phrase-opener matching is case-insensitive");

// phrase-opener only checked against the first 60 chars
{
  var padded = "x".repeat(65) + "could you confirm this";
  ok(fn(padded)===false, "phrase-opener beyond the first 60 chars is NOT matched");
}

// 3. plain statement -> false
ok(fn("Deployed the new build to staging.")===false, "plain statement returns false");
ok(fn("Here is a summary of what changed in this PR.")===false, "plain statement (no ? or opener) returns false");

// 4. empty/null input -> false
ok(fn(null)===false, "null input returns false");
ok(fn(undefined)===false, "undefined input returns false");
ok(fn("")===false, "empty string returns false");
ok(fn("   ")===false, "whitespace-only string returns false");

// 5. async-fetch caveat: fetchPreview/getTranscript is async, so on the very
// first tick transcriptCache[id] is still empty (fetch in flight) even
// though the real transcript (once resolved) reads as a question — state()
// must NOT resolve to "question" on that first synchronous tick. Once the
// promise resolves and populates transcriptCache, the NEXT state() call
// (next tick) picks it up. This exercises the actual proactive-fetch +
// caching code path in hotbar.js, not a re-fetch (transcriptCache is a
// write-once cache per session id by design).
{
  const NOW=Date.now();
  const dom2=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
  const w2=dom2.window;
  w2.Notification=function(){};w2.Notification.permission="granted";w2.Notification.requestPermission=()=>{};
  w2.setInterval=()=>1;w2.clearInterval=()=>{};
  w2.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:["q1"]},version:0}));
  w2["claude.web"]={LocalSessions:{getAll(){return w2.Promise.resolve([
    {sessionId:"q1",title:"Question caveat",isRunning:false,isArchived:false,lastActivityAt:NOW-5000},
  ]);},onOnEvent(){return()=>{};},setFocusedSession(){},
    // getTranscript always resolves with question content, but asynchronously
    // (a real Promise tick) — the cache is empty at the moment render() first runs
    getTranscript(){ return w2.Promise.resolve([{message:{role:"assistant",content:[{type:"text",text:"Should I proceed?"}]}}]); } }};
  w2.eval(src);
  // render() for the first tick runs synchronously inside the fetchSessions
  // .then() callback, BEFORE fetchPreview's own promise chain (kicked off by
  // detectChanges in that same tick) has a chance to resolve — so the very
  // first render() sees an empty transcriptCache.
  await new w2.Promise(r=>setTimeout(r,0));
  let item=[...w2.document.querySelectorAll(".hb-item")].find(i=>/Question caveat/.test(i.textContent));
  console.log("immediately after first tick (fetch still in flight), class:", item&&item.className);
  ok(item && !item.className.includes("question"),"before transcriptCache is populated, state() does not resolve to 'question'");

  // let the in-flight fetchPreview promise resolve, then the next tick's
  // state() call sees the now-cached question text
  await new w2.Promise(r=>setTimeout(r,40));
  w2.__claudeHotbar.refresh();
  await new w2.Promise(r=>setTimeout(r,40));
  item=[...w2.document.querySelectorAll(".hb-item")].find(i=>/Question caveat/.test(i.textContent));
  console.log("after transcript populated, class:", item&&item.className);
  ok(item && item.className.includes("question"),"once transcriptCache is populated with question text, a later state() call resolves to 'question'");
}

console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"looksLikeQuestion() + ASYNC-CACHE CHECKS PASSED"));
process.exit(fail.length?1:0);
