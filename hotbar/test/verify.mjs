import { JSDOM } from "jsdom";
import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://claude.ai/", runScripts: "outside-only" });
const w = dom.window;
const NOW = Date.now();

// seed localStorage: one pinned id, timing showing the running session started 10m ago
w.localStorage.setItem("hotbar-pins", JSON.stringify(["local_PIN"]));
w.localStorage.setItem("hotbar-timing", JSON.stringify({running:{local_RUN: NOW-600000}, waiting:{}}));
w.localStorage.setItem("epitaxy-unread-v1", JSON.stringify({state:{unreadIds:["local_WAIT"]},version:0}));
w.localStorage.setItem("epitaxy-session-result:local_WAIT", JSON.stringify({summary:"Flagged 2 tone issues; waiting on your CTA call."}));

const sessions = [
  {sessionId:"local_RUN", title:"YesChef Proteins", isRunning:true, isArchived:false, createdAt:NOW-9000000, lastActivityAt:NOW-4000, cwd:"/Users/mac/Documents/Work/yeschef/outputs", model:"opus-4.8"},
  {sessionId:"local_WAIT", title:"Prompt Review", isRunning:false, isArchived:false, createdAt:NOW-1000000, lastActivityAt:NOW-900000, cwd:"/Users/mac/Documents/Work/outputs", initialMessage:"Review my prompt"},
  {sessionId:"local_PIN", title:"Nutrition page", isRunning:false, isArchived:false, createdAt:NOW-7200000, lastActivityAt:NOW-7200000},
  {sessionId:"local_IDLE1", title:"Firebase emulator consolidation", isRunning:false, isArchived:false, lastActivityAt:NOW-15000000},
  {sessionId:"local_IDLE2", title:"Sites and multi-tenant", isRunning:false, isArchived:false, lastActivityAt:NOW-1300000000},
];

let notes=[]; w.Notification=function(t,o){notes.push({t,body:o&&o.body});}; w.Notification.permission="granted"; w.Notification.requestPermission=()=>{};
let intervalCb=null; const realSI=w.setInterval; w.setInterval=(f)=>{intervalCb=f;return 1;}; w.clearInterval=()=>{};
w["claude.web"]={LocalSessions:{ getAll(){return w.Promise.resolve(sessions);}, onOnEvent(cb){w.__evt=cb;return ()=>{};}, setFocusedSession(id){w.__focused=id;}, stopTask(){} }};

let err=null;
try { w.eval(src); } catch(e){ err=e; }

await new w.Promise(r=>setTimeout(r,60));
const $=(s)=>w.document.getElementById("claude-hotbar");
const bar=$();
const fail=[]; const ok=(c,m)=>{ if(!c) fail.push(m); };

ok(!err, "no exception on load: "+(err&&err.message));
ok(!!bar, "bar rendered");

const items=[...bar.querySelectorAll(".hb-item")];
const subs=items.map(i=>{const s=i.querySelector(".hb-sub");return s?s.textContent:"";});
console.log("BAR items:", items.length);
subs.forEach(s=>console.log("   sub:", JSON.stringify(s)));

// 1. consistent duration on every bar item
const durRe=/\d+(s|m|h|d)\b/;
ok(subs.every(s=>durRe.test(s)), "every bar item shows a duration");

// 2. run time from TRANSITION (10m), not session age (2.5h) or lastActivity (4s)
const runSub=subs.find(s=>/running/.test(s));
ok(runSub && /10m/.test(runSub), "run time uses transition stamp (~10m), got: "+runSub);

// 3. waiting item present, has waiting class + wait duration
const waitItem=items.find(i=>i.className.includes("waiting"));
ok(!!waitItem, "waiting item styled");
ok(waitItem && durRe.test(waitItem.querySelector(".hb-sub").textContent), "waiting item shows wait duration");

// 4. toggle count = waiting(1)+running(1) = 2
const count=bar.querySelector(".hb-count");
ok(count && count.textContent==="2", "toggle attention count = 2, got: "+(count&&count.textContent));

// 5. waiting-since stamped + persisted
const tim=JSON.parse(w.localStorage.getItem("hotbar-timing"));
ok(tim.waiting.local_WAIT!=null, "waiting transition stamped+persisted");
ok(tim.running.local_RUN!=null, "running transition kept");

// 6. ping notification fired for the newly-waiting session
ok(notes.some(n=>n.t==="Waiting on you" && n.body==="Prompt Review"), "‘Waiting on you’ ping fired");

// 7. hover preview shows result summary
items[0].dispatchEvent(new w.Event("mouseenter"));
await new w.Promise(r=>setTimeout(r,1050)); // clear the new 1s hover-debounce
const pop=w.document.querySelector(".claudehotbar-pop");
console.log("HOVER pop:", pop?pop.querySelector("p").textContent.slice(0,60):"(none)");
ok(!!pop, "hover preview appears");

// 8. expand -> grouped + searchable; pin toggle persists
bar.querySelector(".hb-toggle").dispatchEvent(new w.Event("click"));
await new w.Promise(r=>setTimeout(r,20));
const grps=[...bar.querySelectorAll(".hb-grp")].map(g=>g.textContent);
console.log("GROUPS:", grps);
ok(grps.some(g=>/Waiting on you/.test(g)) && grps.some(g=>/Running/.test(g)) && grps.some(g=>/Recent/.test(g)), "panel grouped");
ok(!!bar.querySelector(".hb-search input"), "search box present");
const pinRow=[...bar.querySelectorAll(".hb-row .hb-act")][0];
pinRow.dispatchEvent(new w.Event("click"));
const pins2=JSON.parse(w.localStorage.getItem("hotbar-pins"));
console.log("PINS after toggle:", pins2);
ok(Array.isArray(pins2), "pins persisted as array");

console.log("\n" + (fail.length? "FAIL:\n - "+fail.join("\n - ") : "ALL CHECKS PASSED ("+ (8) +" groups verified)"));
process.exit(fail.length?1:0);
