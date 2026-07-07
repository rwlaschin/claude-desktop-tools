import { JSDOM } from "jsdom"; import fs from "fs";
// Use Case 2 (docs/plans/hotbar-state-model-fix/plan.md): jump(id) stamps
// dismissed[id] and persists it; a dismissed session no longer resolves to
// an attention state on the next tick. Exception: once unread[id] clears,
// updateTiming() deletes the stale dismissed[id] entry; if unread[id]
// becomes true again later (new activity), state() resolves to an
// attention state again — dismissal is not permanent.
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
function boot(sessions, extraLS){
  const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
  const w=dom.window; w.Notification=function(){};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
  w.setInterval=()=>1;w.clearInterval=()=>{};
  w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:sessions.filter(s=>s._unread!==false).map(s=>s.sessionId)},version:0}));
  if (extraLS) Object.keys(extraLS).forEach(k=>w.localStorage.setItem(k, JSON.stringify(extraLS[k])));
  w["claude.web"]={LocalSessions:{getAll(){return w.Promise.resolve(sessions);},onOnEvent(){return()=>{};},setFocusedSession(id){w.__focused=id;},getTranscript(){return w.Promise.resolve([]);}}};
  w.eval(src); return w;
}
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};
const NOW=Date.now();

// 1. Basic course of events: jump() on a fresh session sets + persists
// dismissed[id]; the session no longer resolves to an attention state on
// the next tick.
{
  const w=boot(
    [{sessionId:"f1",title:"Fresh dismiss me",isRunning:false,isArchived:false,lastActivityAt:NOW-5000}],
    {"hotbar-timing":{running:{},waiting:{f1:NOW-60000}}}   // fresh (1min old, under FRESH_MS)
  );
  await new w.Promise(r=>setTimeout(r,40));
  let item=[...w.document.querySelectorAll(".hb-item")].find(i=>/Fresh dismiss me/.test(i.textContent));
  ok(item && item.className.includes("fresh"),"precondition: session renders as 'fresh' before dismissal");

  item.dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
  const dismissed=JSON.parse(w.localStorage.getItem("hotbar-dismissed")||"{}");
  console.log("dismissed after jump:", dismissed);
  ok(dismissed.f1!=null,"jump(id) sets dismissed[id]");
  ok(typeof dismissed.f1==="number","dismissed[id] is a timestamp");
  ok(w.__focused==="f1","jump(id) still calls the existing bridge (setFocusedSession) alongside the dismiss stamp");

  w.__claudeHotbar.refresh();
  await new w.Promise(r=>setTimeout(r,40));
  item=[...w.document.querySelectorAll(".hb-item")].find(i=>/Fresh dismiss me/.test(i.textContent));
  console.log("class after dismiss + next tick:", item&&item.className);
  ok(!item || (!item.className.includes("fresh") && !item.className.includes("aging") && !item.className.includes("question")),"dismissed session no longer resolves to an attention state on the next tick");
}

// 2. same for aging and question states
{
  const w=boot(
    [{sessionId:"a1",title:"Aging dismiss me",isRunning:false,isArchived:false,lastActivityAt:NOW-700000}],
    {"hotbar-timing":{running:{},waiting:{a1:NOW-700000}}}   // aging
  );
  await new w.Promise(r=>setTimeout(r,40));
  let item=[...w.document.querySelectorAll(".hb-item")].find(i=>/Aging dismiss me/.test(i.textContent));
  ok(item && item.className.includes("aging"),"precondition: session renders as 'aging' before dismissal");
  item.dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
  w.__claudeHotbar.refresh();
  await new w.Promise(r=>setTimeout(r,40));
  item=[...w.document.querySelectorAll(".hb-item")].find(i=>/Aging dismiss me/.test(i.textContent));
  ok(!item || !item.className.includes("aging"),"dismissing an aging session clears its badge on the next tick");
}
{
  const w=boot(
    [{sessionId:"q1",title:"Question dismiss me",isRunning:false,isArchived:false,lastActivityAt:NOW-5000}]
  );
  w["claude.web"].LocalSessions.getTranscript=function(){return w.Promise.resolve([{message:{role:"assistant",content:[{type:"text",text:"Should I proceed?"}]}}]);};
  w.eval(src);
  await new w.Promise(r=>setTimeout(r,40));
  await new w.Promise(r=>setTimeout(r,40));
  w.__claudeHotbar.refresh();
  await new w.Promise(r=>setTimeout(r,40));
  let item=[...w.document.querySelectorAll(".hb-item")].find(i=>/Question dismiss me/.test(i.textContent));
  ok(item && item.className.includes("question"),"precondition: session renders as 'question' before dismissal");
  item.dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
  w.__claudeHotbar.refresh();
  await new w.Promise(r=>setTimeout(r,40));
  item=[...w.document.querySelectorAll(".hb-item")].find(i=>/Question dismiss me/.test(i.textContent));
  ok(!item || !item.className.includes("question"),"dismissing a question session clears its badge on the next tick");
}

// 3. Exception: unread[id] clears on its own -> updateTiming() deletes the
// stale dismissed[id] entry
{
  const w=boot(
    [{sessionId:"c1",title:"Clears on its own",isRunning:false,isArchived:false,lastActivityAt:NOW-5000}],
    {"hotbar-timing":{running:{},waiting:{c1:NOW-60000}},"hotbar-dismissed":{c1:NOW-1000}}
  );
  await new w.Promise(r=>setTimeout(r,40));
  let dismissed=JSON.parse(w.localStorage.getItem("hotbar-dismissed")||"{}");
  console.log("dismissed while still unread:", dismissed);
  ok(dismissed.c1!=null,"precondition: dismissed[id] is set while the session is still unread");

  // simulate unread[id] clearing (app-side read-state update): remove it
  // from epitaxy-unread-v1 and re-tick
  w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:[]},version:0}));
  w.__claudeHotbar.refresh();
  await new w.Promise(r=>setTimeout(r,40));
  dismissed=JSON.parse(w.localStorage.getItem("hotbar-dismissed")||"{}");
  console.log("dismissed after unread clears:", dismissed);
  ok(dismissed.c1==null,"updateTiming() deletes the stale dismissed[id] entry once unread[id] is false");

  // 4. dismissal is not permanent: unread[id] becomes true again (new
  // activity) -> state() resolves to an attention state again
  w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:["c1"]},version:0}));
  w.__claudeHotbar.refresh();
  await new w.Promise(r=>setTimeout(r,40));
  const item=[...w.document.querySelectorAll(".hb-item")].find(i=>/Clears on its own/.test(i.textContent));
  console.log("class after new activity re-pings:", item&&item.className);
  ok(item && (item.className.includes("fresh")||item.className.includes("aging")||item.className.includes("question")),"a subsequent new unread ping on the same session resolves to an attention state again — dismissal is not permanent");
}

console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"DISMISS-ON-JUMP + RE-ARM CHECKS PASSED"));
process.exit(fail.length?1:0);
