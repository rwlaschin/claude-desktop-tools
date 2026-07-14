import { JSDOM } from "jsdom"; import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
const w=dom.window; const NOW=Date.now();
w.Notification=function(t,o){(w.__n=w.__n||[]).push({t,body:o&&o.body});};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
w.setInterval=()=>1;w.clearInterval=()=>{};
w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:[]},version:0}));
// both cowork sessions have activity after the last read -> both unread & fresh
w.localStorage.setItem("persisted.cowork-read-state.acct123",JSON.stringify({
  sessions:{ aq: NOW-600000, uq: NOW-600000 }, explicitUnread:{}, initializedAt: NOW-9000000 }));
const cowork=[
  {sessionId:"aq",title:"LLM is asking",  isRunning:false,isArchived:false,lastActivityAt:NOW-4000}, // assistant asked a question
  {sessionId:"uq",title:"User asked",     isRunning:false,isArchived:false,lastActivityAt:NOW-4000}, // user's question is the last msg
];
const transcripts={
  aq:[{message:{role:"user",content:[{type:"text",text:"migrate the db"}]}},
      {message:{role:"assistant",content:[{type:"text",text:"Should I proceed with the migration?"}]}}],
  uq:[{message:{role:"assistant",content:[{type:"text",text:"Done, all tests pass."}]}},
      {message:{role:"user",content:[{type:"text",text:"can you also fix the flaky test?"}]}}],
};
w["claude.web"]={
  LocalSessions:{getAll(){return w.Promise.resolve([]);},onOnEvent(){return()=>{};},setFocusedSession(){},getTranscript(){return w.Promise.resolve([]);}},
  LocalAgentModeSessions:{getAll(){return w.Promise.resolve(cowork);},setFocusedSession(){},getTranscript(id){return w.Promise.resolve(transcripts[id]||[]);}},
};
let err=null; try{w.eval(src);}catch(e){err=e;}
// first tick populates transcriptCache/transcriptRole (proactive fetch on fresh),
// second tick re-renders now that the cache/role are known
await new w.Promise(r=>setTimeout(r,60));
w.__claudeHotbar.refresh();
await new w.Promise(r=>setTimeout(r,60));

const bar=w.document.getElementById("claude-hotbar");
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};
ok(!err,"no exception: "+(err&&err.message));

const items=[...bar.querySelectorAll(".hb-item")];
const stateOf=(title)=>{ const el=items.find(e=>new RegExp(title).test(e.textContent)); return el?el.className:"(absent)"; };
console.log("assistant-question row class:", stateOf("LLM is asking"));
console.log("user-question row class:    ", stateOf("User asked"));

const notes=(w.__n||[]).filter(n=>n.t==="Question for you").map(n=>n.body);
console.log("Question pings:", notes);

// assistant asked -> question state + ping
ok(/\bquestion\b/.test(stateOf("LLM is asking")),"assistant question -> 'question' state");
ok(notes.includes("LLM is asking"),"assistant question fires 'Question for you' ping");
// user's question as last message -> NOT question (should be fresh instead), no ping
ok(!/\bquestion\b/.test(stateOf("User asked")),"user question is NOT classified as 'question'");
ok(/\bfresh\b/.test(stateOf("User asked")),"user question falls through to 'fresh' (unread, waiting)");
ok(!notes.includes("User asked"),"user question does NOT fire a 'Question for you' ping");

console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"QUESTION-ROLE CHECKS PASSED"));
process.exit(fail.length?1:0);
