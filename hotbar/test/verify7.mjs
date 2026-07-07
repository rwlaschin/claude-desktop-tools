import { JSDOM } from "jsdom"; import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
const w=dom.window; const NOW=Date.now();
w.Notification=function(t,o){(w.__n=w.__n||[]).push({t,body:o&&o.body});};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
w.setInterval=()=>1;w.clearInterval=()=>{};
w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:[]},version:0}));
// cowork read-state: cw1 read long ago (has new activity), cw3 read recently, cw2 explicitly unread
w.localStorage.setItem("persisted.cowork-read-state.acct123",JSON.stringify({
  sessions:{ cw1: NOW-600000, cw3: NOW-1000 }, explicitUnread:{ cw2:true }, initializedAt: NOW-9000000 }));
const code=[{sessionId:"code1",title:"Proteins",isRunning:true,isArchived:false,lastActivityAt:NOW-3000}];
const cowork=[
  {sessionId:"cw1",title:"Late night food ideas",isRunning:false,isArchived:false,lastActivityAt:NOW-5000},   // activity after read -> unread
  {sessionId:"cw2",title:"Explicit unread chat",isRunning:false,isArchived:false,lastActivityAt:NOW-800000},   // explicitUnread -> unread
  {sessionId:"cw3",title:"Already read chat",isRunning:false,isArchived:false,lastActivityAt:NOW-900000},       // read after activity -> NOT
  {sessionId:"cw4",title:"Never opened chat",isRunning:false,isArchived:false,lastActivityAt:NOW-100000},       // no readState entry -> NOT (no flood)
];
let coworkFocused=null, coworkTranscriptId=null;
w["claude.web"]={
  LocalSessions:{getAll(){return w.Promise.resolve(code);},onOnEvent(){return()=>{};},setFocusedSession(){},getTranscript(){return w.Promise.resolve([]);}},
  LocalAgentModeSessions:{getAll(){return w.Promise.resolve(cowork);},setFocusedSession(id){coworkFocused=id;},getTranscript(id){coworkTranscriptId=id;return w.Promise.resolve([{message:{role:"assistant",content:[{type:"text",text:"how about grilled cheese at midnight"}]}}]);}},
};
w.__TSR_ROUTER__={navigate(o){w.__nav=o;}};
let err=null; try{w.eval(src);}catch(e){err=e;}
await new w.Promise(r=>setTimeout(r,60));
const bar=w.document.getElementById("claude-hotbar");
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};
ok(!err,"no exception: "+(err&&err.message));

const barTitles=[...bar.querySelectorAll(".hb-item .hb-tt")].map(e=>e.textContent);
console.log("bar items:", barTitles);
const notes=(w.__n||[]).filter(n=>n.t==="Waiting on you").map(n=>n.body);
console.log("waiting pings:", notes);

ok(barTitles.some(t=>/Late night food ideas/.test(t)),"cowork chat with new activity shows as waiting");
ok(notes.includes("Late night food ideas"),"ping fired for cowork new-activity chat");
ok(notes.includes("Explicit unread chat"),"ping fired for explicitly-unread cowork chat");
ok(!notes.includes("Already read chat"),"read cowork chat does NOT ping");
ok(!notes.includes("Never opened chat"),"never-opened cowork chat does NOT ping (no flood)");
ok(barTitles.some(t=>/Proteins/.test(t)),"code session still present (merged)");

// count badge should be coral (waiting present) and count = 2 waiting + 1 running = 3
const badge=bar.querySelector(".hb-count");
console.log("badge:", badge&&badge.textContent, badge&&badge.style.background);
ok(badge && badge.textContent==="3","attention count merges code+cowork (3)");

// jump on a cowork item clicks the app's own "Cowork" tab switcher (so the
// view actually mounts even if the code tab is currently active) and then
// focuses the session via the cowork bridge — it does NOT router-navigate
// to /epitaxy (that's the code-session route).
const coworkTab=w.document.createElement("button");
coworkTab.textContent="Cowork";
let coworkTabClicked=false;
coworkTab.addEventListener("click",()=>{coworkTabClicked=true;});
w.document.body.appendChild(coworkTab);
w.__nav=null;
const foodItem=[...bar.querySelectorAll(".hb-item")].find(e=>/Late night food ideas/.test(e.textContent));
foodItem.dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
console.log("cowork tab clicked:",coworkTabClicked,"| cowork focus:",coworkFocused,"| router nav:",w.__nav);
ok(coworkTabClicked,"cowork jump clicks the app's Cowork tab switcher");
ok(coworkFocused==="cw1","cowork jump calls LocalAgentModeSessions.setFocusedSession");
ok(w.__nav===null,"cowork jump does NOT router-navigate to /epitaxy");

// jump() also stamps+persists the dismiss alongside the bridge call
const dismissed=JSON.parse(w.localStorage.getItem("hotbar-dismissed")||"{}");
console.log("dismissed after jump:", dismissed);
ok(dismissed.cw1!=null,"jump(id) stamps dismissed[id] and persists to hotbar-dismissed");

// hover a cowork item -> uses cowork transcript
foodItem.dispatchEvent(new w.Event("mouseenter"));
await new w.Promise(r=>setTimeout(r,1050)); // clear the new 1s hover-debounce
const prev=w.document.querySelector(".claudehotbar-pop .hb-prev");
console.log("cowork hover:", prev&&prev.textContent, "| transcript id:", coworkTranscriptId);
ok(coworkTranscriptId==="cw1" && prev && /grilled cheese/.test(prev.textContent),"cowork hover reads cowork transcript");

console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"COWORK INTEGRATION CHECKS PASSED"));
process.exit(fail.length?1:0);
