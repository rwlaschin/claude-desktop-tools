import { JSDOM } from "jsdom"; import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
const w=dom.window; const NOW=Date.now();
let notes=[]; w.Notification=function(t,o){notes.push({t,body:o&&o.body});};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
w.setInterval=()=>1;w.clearInterval=()=>{};
Object.defineProperty(w.document,"fonts",{configurable:true,value:{load:()=>w.Promise.reject(new Error("x")),check:()=>false}});
w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:[]},version:0}));
const sessions=[
  {sessionId:"blk",title:"Blocked one",isRunning:true,isArchived:false,lastActivityAt:NOW-120000,pendingToolPermissions:[{requestId:"r1",toolName:"mcp__x"}]},
  {sessionId:"run",title:"Running one",isRunning:true,isArchived:false,lastActivityAt:NOW-3000},
];
w["claude.web"]={LocalSessions:{getAll(){return w.Promise.resolve(sessions);},onOnEvent(){return()=>{};},setFocusedSession(){},getTranscript(){return w.Promise.resolve([]);}}};
w.eval(src);
await new w.Promise(r=>setTimeout(r,50));
const bar=w.document.getElementById("claude-hotbar");
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};
const items=[...bar.querySelectorAll(".hb-item")];
const first=items[0];
console.log("bar order:", items.map(i=>i.querySelector(".hb-tt")?i.querySelector(".hb-tt").textContent:"").filter(Boolean));
ok(first.className.includes("blocked"),"blocked session ranks first + has .blocked class");
ok(first.querySelector(".m.blocked"),"blocked marker (amber square) present");
ok(/needs you/.test(first.querySelector(".hb-sub").textContent),"blocked row label = 'needs you'");
const badge=bar.querySelector(".hb-count");
console.log("badge:",badge&&badge.textContent,badge&&badge.style.background);
ok(badge && badge.style.background==="rgb(224, 162, 75)","badge is amber when a session needs input");
ok(notes.some(n=>n.t==="Needs your answer" && n.body==="Blocked one"),"'Needs your answer' notification fired");
// running one should NOT be blocked
const runItem=items.find(i=>/Running one/.test(i.textContent));
ok(runItem && runItem.querySelector(".m.running"),"running session still shows running (green circle)");
// expand -> 'Needs you' group present
bar.querySelector(".hb-toggle").dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
await new w.Promise(r=>setTimeout(r,20));
const grps=[...bar.querySelectorAll(".hb-grp")].map(g=>g.textContent);
console.log("groups:",grps);
ok(grps.some(g=>/Needs you . 1/.test(g)),"panel has 'Needs you' group");
console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"BLOCKED-STATE CHECK PASSED"));
process.exit(fail.length?1:0);
