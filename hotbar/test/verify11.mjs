import { JSDOM } from "jsdom"; import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
const w=dom.window; const NOW=Date.now();
let notes=[]; w.Notification=function(t,o){notes.push({t,body:o&&o.body});};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
w.setInterval=()=>1;w.clearInterval=()=>{};
Object.defineProperty(w.document,"fonts",{configurable:true,value:{load:()=>w.Promise.reject(new Error("x")),check:()=>false}});
w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:["ask"]},version:0}));
const sessions=[
  {sessionId:"blk",title:"Blocked one",isRunning:true,isArchived:false,lastActivityAt:NOW-120000,pendingToolPermissions:[{requestId:"r1",toolName:"mcp__x"}]},
  {sessionId:"ask",title:"Question one",isRunning:false,isArchived:false,lastActivityAt:NOW-5000},
  {sessionId:"run",title:"Running one",isRunning:true,isArchived:false,lastActivityAt:NOW-3000},
];
w["claude.web"]={LocalSessions:{getAll(){return w.Promise.resolve(sessions);},onOnEvent(){return()=>{};},setFocusedSession(){},
  getTranscript(id){ return w.Promise.resolve(id==="ask" ? [{message:{role:"assistant",content:[{type:"text",text:"Should I proceed with the deploy?"}]}}] : []); }}};
w.eval(src);
await new w.Promise(r=>setTimeout(r,50));   // first tick: proactive fetchPreview kicks off for "ask"
await new w.Promise(r=>setTimeout(r,50));   // let the fetch resolve into transcriptCache
w.__claudeHotbar.refresh();                 // second tick: state() now sees "ask" as a question
await new w.Promise(r=>setTimeout(r,30));
const bar=w.document.getElementById("claude-hotbar");
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};
const items=[...bar.querySelectorAll(".hb-item")];
const first=items[0], second=items[1];
console.log("bar order:", items.map(i=>i.querySelector(".hb-tt")?i.querySelector(".hb-tt").textContent:"").filter(Boolean));
// priority chain: error > question > blocked > fresh > aging > running > idle
ok(first.className.includes("question") && /Question one/.test(first.textContent),"question session ranks ABOVE blocked");
ok(second.className.includes("blocked") && /Blocked one/.test(second.textContent),"blocked session ranks second (below question, above running)");
ok(second.querySelector(".m.blocked"),"blocked marker (amber square) present");
ok(/needs you/.test(second.querySelector(".hb-sub").textContent),"blocked row label = 'needs you'");
const badge=bar.querySelector(".hb-count");
console.log("badge:",badge&&badge.textContent,badge&&badge.style.background);
ok(badge && badge.style.background==="rgb(226, 75, 74)","badge is question-red when both a question and a blocked session are present");
ok(notes.some(n=>n.t==="Needs your answer" && n.body==="Blocked one"),"'Needs your answer' notification fired");
// running one should NOT be blocked
const runItem=items.find(i=>/Running one/.test(i.textContent));
ok(runItem && runItem.querySelector(".m.running"),"running session still shows running (green circle)");
// expand -> 'Needs you' + 'Question' groups present, Question before Needs you? no —
// per bar-concat order question comes before blocked, but panel group order in
// Scope places "Question" between "blocked" and "waiting"-derived groups
bar.querySelector(".hb-toggle").dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
await new w.Promise(r=>setTimeout(r,20));
const grps=[...bar.querySelectorAll(".hb-grp")].map(g=>g.textContent);
console.log("groups:",grps);
ok(grps.some(g=>/Needs you . 1/.test(g)),"panel has 'Needs you' group");
ok(grps.some(g=>/Question . 1/.test(g)),"panel has 'Question' group");
console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"BLOCKED/QUESTION-STATE ORDER CHECK PASSED"));
process.exit(fail.length?1:0);
