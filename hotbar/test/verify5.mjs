import { JSDOM } from "jsdom"; import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
function boot(unreadIds, extraLS){
  const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
  const w=dom.window; w.Notification=function(){};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
  w.setInterval=()=>1;w.clearInterval=()=>{};
  w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds},version:0}));
  if (extraLS) Object.keys(extraLS).forEach(k=>w.localStorage.setItem(k, JSON.stringify(extraLS[k])));
  w["claude.web"]={LocalSessions:{getAll(){return w.Promise.resolve([
    {sessionId:"r1",title:"Running one",isRunning:true,isArchived:false,lastActivityAt:Date.now()-3000},
    {sessionId:"w1",title:"Waiting one",isRunning:false,isArchived:false,lastActivityAt:Date.now()-9000},
  ]);},onOnEvent(){return()=>{};},setFocusedSession(){},getTranscript(){return w.Promise.resolve([]);}}};
  w.eval(src); return w;
}
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};

// only running -> green badge
let w=boot([]); await new w.Promise(r=>setTimeout(r,40));
let badge=w.document.querySelector("#claude-hotbar .hb-count");
console.log("running-only badge bg:", badge&&badge.style.background, "text:", badge&&badge.textContent);
ok(badge && badge.style.background==="rgb(93, 202, 165)" && badge.textContent==="1","running-only badge is green, count 1");

// a freshly-waiting session (no prior timing.waiting stamp, lastActivityAt
// only 9s ago -> age is tiny -> "fresh") -> blue badge
w=boot(["w1"]); await new w.Promise(r=>setTimeout(r,40));
badge=w.document.querySelector("#claude-hotbar .hb-count");
console.log("fresh-waiting badge bg:", badge&&badge.style.background, "text:", badge&&badge.textContent);
ok(badge && badge.style.background==="rgb(55, 138, 221)" && badge.textContent==="2","fresh-waiting badge is blue, count 2");

// same session but timing.waiting predates it by past FRESH_MS -> aging -> coral badge
const NOW=Date.now();
w=boot(["w1"], {"hotbar-timing":{running:{},waiting:{w1:NOW-700000}}});
await new w.Promise(r=>setTimeout(r,40));
badge=w.document.querySelector("#claude-hotbar .hb-count");
console.log("aging-waiting badge bg:", badge&&badge.style.background, "text:", badge&&badge.textContent);
ok(badge && badge.style.background==="rgb(224, 103, 59)" && badge.textContent==="2","aging-waiting badge is coral, count 2");

// same session, but its cached transcript reads as a question -> red question
// badge. transcriptCache isn't exposed directly, so drive it the supported
// way: seed getTranscript() and let the proactive fetchPreview populate it —
// the proactive fetch fires on the first "fresh" tick (no prior timing.waiting
// stamp), so boot it fresh rather than pre-aged.
w=boot(["w1"]);
w["claude.web"].LocalSessions.getTranscript=function(){return w.Promise.resolve([{message:{role:"assistant",content:[{type:"text",text:"Should I proceed with the migration?"}]}}]);};
w.eval(src);
await new w.Promise(r=>setTimeout(r,40));   // first tick: fresh, proactive fetchPreview kicks off (async)
await new w.Promise(r=>setTimeout(r,40));   // let the fetch resolve into transcriptCache
w.__claudeHotbar.refresh();                 // second tick: state() now sees the cached transcript
await new w.Promise(r=>setTimeout(r,40));
badge=w.document.querySelector("#claude-hotbar .hb-count");
console.log("question badge bg:", badge&&badge.style.background, "text:", badge&&badge.textContent);
ok(badge && badge.style.background==="rgb(226, 75, 74)" && badge.textContent==="2","question badge is red (#e24b4a), count 2");

console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"BADGE COLOR CHECKS PASSED"));
process.exit(fail.length?1:0);
