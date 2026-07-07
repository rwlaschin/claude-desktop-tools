import { JSDOM } from "jsdom"; import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");

// 1. color-distance check: no two semantic group/badge colors should be near-duplicates
const hexes = [...src.matchAll(/,\s*"(#[0-9a-fA-F]{6})",\s*[A-Za-z]/g)].map(m=>m[1]);
const toRgb = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
const dist = (a,b) => Math.sqrt(a.reduce((s,v,i)=>s+(v-b[i])**2,0));
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};
console.log("group colors found:", hexes);
for (let i=0;i<hexes.length;i++) for (let j=i+1;j<hexes.length;j++) {
  const d = dist(toRgb(hexes[i]), toRgb(hexes[j]));
  if (d < 28) fail.push(`near-duplicate colors: ${hexes[i]} vs ${hexes[j]} (distance ${d.toFixed(1)})`);
}
ok(!hexes.includes("#c9a24b"), "old clashing pinned color (#c9a24b) removed from source");
// the state-model fix reassigns these hexes to new group() entries — confirm
// the reassigned palette (question/#e24b4a, aging/#e0673b, plus the new
// fresh/#378ADD and error/#A32D2D) is present and still pairwise-distinct
// (verified by the loop above, which covers every group() color literal)
ok(hexes.includes("#e24b4a"), "question group color (#e24b4a, reassigned from sole error ownership) present");
ok(hexes.includes("#e0673b"), "aging group color (#e0673b, reassigned from waiting) present");
ok(hexes.includes("#378ADD"), "fresh group color (#378ADD) present");
ok(hexes.includes("#A32D2D"), "error/'Needs attention' group uses the dark saturated red, distinct from question's #e24b4a");

// 2. injectFake auto-expiry
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
const w=dom.window; const NOW=Date.now();
w.Notification=function(){};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
w.setInterval=()=>1;w.clearInterval=()=>{};
w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:[]},version:0}));
w["claude.web"]={LocalSessions:{getAll(){return w.Promise.resolve([]);},onOnEvent(){return()=>{};},setFocusedSession(){},getTranscript(){return w.Promise.resolve([]);}}};
w.eval(src);
await new w.Promise(r=>setTimeout(r,40));
const bar=w.document.getElementById("claude-hotbar");
w.__claudeHotbar.injectFake([{sessionId:"fk",title:"TEST forget-to-clear",isRunning:false,isArchived:false,lastActivityAt:NOW-10000,errorCategory:"api_billing_error"}], 150);
await new w.Promise(r=>setTimeout(r,20));
ok(bar.textContent.includes("TEST forget-to-clear"),"injected fake session appears immediately");
await new w.Promise(r=>setTimeout(r,220));  // past the 150ms ttl
ok(!bar.textContent.includes("TEST forget-to-clear"),"fake session auto-expires and is removed without calling clearFake");

console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"COLOR-DISTINCTNESS + AUTO-EXPIRY CHECK PASSED"));
process.exit(fail.length?1:0);
