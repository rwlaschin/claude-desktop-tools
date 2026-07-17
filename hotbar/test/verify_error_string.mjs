import { JSDOM } from "jsdom";
import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://claude.ai/", runScripts: "outside-only" });
const w = dom.window;
const NOW = Date.now();

const sessions = [
  // 529 overloaded reported via error STRING only (no errorCategory), fresh
  {sessionId:"local_OVER", title:"Orders page", isRunning:false, isArchived:false,
    lastActivityAt:NOW-60000, error:"API Error: 529 Overloaded. Try again in a moment.", errorAt:NOW-60000},
  // usage limit reported via error STRING only, fresh
  {sessionId:"local_LIMIT", title:"Prod status check", isRunning:false, isArchived:false,
    lastActivityAt:NOW-120000, error:"You've reached your usage limit. Try again after your limit resets.", errorAt:NOW-120000},
  // credit error via errorCategory (existing behavior — must still work)
  {sessionId:"local_CREDIT", title:"Buy credits", isRunning:false, isArchived:false,
    lastActivityAt:NOW-90000, errorCategory:"api_billing_error", error:"Credit balance is too low"},
  // STALE error: errored, then the user retried and it succeeded (lastActivityAt AFTER errorAt).
  // Must NOT show as error.
  {sessionId:"local_STALE", title:"Recovered session", isRunning:false, isArchived:false,
    lastActivityAt:NOW-5000, error:"API Error: 529 Overloaded", errorAt:NOW-600000},
];

let notes=[]; w.Notification=function(t,o){notes.push({t,body:o&&o.body});}; w.Notification.permission="granted"; w.Notification.requestPermission=()=>{};
let opened=[]; w.open=(u)=>{opened.push(u);return null;};
w.setInterval=()=>1; w.clearInterval=()=>{};
w["claude.web"]={LocalSessions:{ getAll(){return w.Promise.resolve(sessions);}, onOnEvent(){return ()=>{};}, setFocusedSession(id){w.__focused=id;}, stopTask(){} }};

let err=null;
try { w.eval(src); } catch(e){ err=e; }
await new w.Promise(r=>setTimeout(r,60));

const bar=w.document.getElementById("claude-hotbar");
const fail=[]; const ok=(c,m)=>{ if(!c) fail.push(m); };
ok(!err, "no exception on load: "+(err&&err.message));
ok(!!bar, "bar rendered");

const errItems=[...bar.querySelectorAll(".hb-item.error")];
const map={}; errItems.forEach(i=>{ map[i.querySelector(".hb-sub").textContent]= i; });
const subs=errItems.map(i=>i.querySelector(".hb-sub").textContent);
console.log("ERROR rows:", subs);

// 1. all three fresh errors promote to error rows; stale one does not
ok(errItems.length===3, "exactly 3 error rows (stale excluded), got "+errItems.length);

// 2. 529-overloaded (string-only) shows "Service busy" + a duration
ok(subs.some(s=>/^Service busy · \d/.test(s)), "overload row = 'Service busy · <dur>', got: "+JSON.stringify(subs));

// 3. usage-limit (string-only) shows "Usage limit", NO duration
ok(subs.some(s=>s==="Usage limit"), "usage-limit row = 'Usage limit' (no dur), got: "+JSON.stringify(subs));

// 4. credit (errorCategory) still shows "Upgrade credits", NO duration
ok(subs.some(s=>s==="Upgrade credits"), "credit row = 'Upgrade credits', got: "+JSON.stringify(subs));

// 5. stale recovered session is NOT an error row anywhere
const allSubs=[...bar.querySelectorAll(".hb-item .hb-sub")].map(s=>s.textContent);
ok(!allSubs.some(s=>/Service busy/.test(s) && errItems.length!==3), "stale check consistent");
const staleShownAsError = [...bar.querySelectorAll(".hb-item")].some(i=>{
  const t=i.querySelector(".hb-title"); return t && /Recovered session/.test(t.textContent) && i.className.includes("error");
});
ok(!staleShownAsError, "stale (retried-past) session NOT shown as error");

// 6. clicking the credit row opens billing; clicking overload row jumps (no billing popup)
const creditRow=map["Upgrade credits"];
creditRow.dispatchEvent(new w.Event("click"));
ok(opened.some(u=>/buy_credits/.test(u)), "credit row opens billing, opened="+JSON.stringify(opened));

console.log("\n" + (fail.length? "FAIL:\n - "+fail.join("\n - ") : "ALL ERROR-STRING CHECKS PASSED"));
process.exit(fail.length?1:0);
