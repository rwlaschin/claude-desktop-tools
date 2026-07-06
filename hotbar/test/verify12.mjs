import { JSDOM } from "jsdom"; import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
const w=dom.window; const NOW=Date.now();
let notes=[]; w.Notification=function(t,o){notes.push({t,body:o&&o.body});};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
w.setInterval=()=>1;w.clearInterval=()=>{};
let opened=null; w.open=(u)=>{opened=u;};
w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:[]},version:0}));
const sessions=[
  {sessionId:"credit1",title:"Out of credits chat",isRunning:false,isArchived:false,lastActivityAt:NOW-120000,errorCategory:"api_billing_error",error:"Credit balance is too low"},
  {sessionId:"net1",title:"Network broke chat",isRunning:false,isArchived:false,lastActivityAt:NOW-60000,errorCategory:"network_error",error:"Unable to connect."},
  {sessionId:"other1",title:"Other error chat",isRunning:false,isArchived:false,lastActivityAt:NOW-30000,errorCategory:"prompt_too_long",error:"Prompt is too long"},
  {sessionId:"run1",title:"Fine running one",isRunning:true,isArchived:false,lastActivityAt:NOW-5000},
];
w["claude.web"]={LocalSessions:{getAll(){return w.Promise.resolve(sessions);},onOnEvent(){return()=>{};},setFocusedSession(){},getTranscript(){return w.Promise.resolve([]);}}};
let err=null; try{w.eval(src);}catch(e){err=e;}
await new w.Promise(r=>setTimeout(r,50));
const bar=w.document.getElementById("claude-hotbar");
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};
ok(!err,"no exception: "+(err&&err.message));

const items=[...bar.querySelectorAll(".hb-item")];
console.log("bar order:", items.map(i=>i.querySelector(".hb-tt")?i.querySelector(".hb-tt").textContent:"").filter(Boolean));
const first=items[0], second=items[1];
ok(first.className.includes("error") && /Out of credits/.test(first.textContent),"credit-error session ranks first, has .error class");
ok(/Upgrade credits/.test(first.querySelector(".hb-sub").textContent),"credit row shows 'Upgrade credits' — no countdown");
ok(!/\d+[smhd]/.test(first.querySelector(".hb-sub").textContent),"credit row has NO duration/countdown text");
ok(second.className.includes("error") && /Connection lost/.test(second.querySelector(".hb-sub").textContent),"network-error session shows 'Connection lost'");
ok(!!first.querySelector(".m-alert svg"),"credit row shows the alert-triangle icon");

// badge should be RED (errors present)
const badge=bar.querySelector(".hb-count");
console.log("badge bg:", badge&&badge.style.background, "count:", badge&&badge.textContent);
ok(badge && badge.style.background==="rgb(163, 45, 45)","badge turns red when any session has an error");

// click on the credit-error row opens the upgrade URL, not jump
opened=null;
first.dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
console.log("opened:", opened);
ok(opened==="https://claude.com/buy_credits","clicking a credit-error row opens the upgrade URL");

// network-error row is NOT a credit error -> normal jump behavior (no window.open)
opened=null;
second.dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
ok(opened===null,"clicking a non-credit error row does NOT open the upgrade URL");

// notifications fired once for entering error state
ok(notes.some(n=>n.t==="Out of credits" && n.body==="Out of credits chat"),"'Out of credits' notification fired for the billing error");
ok(notes.some(n=>n.t==="Connection lost" && n.body==="Network broke chat"),"'Connection lost' notification fired for the network error");
ok(notes.some(n=>n.t==="prompt too long" && n.body==="Other error chat"),"generic category notification fired for an uncategorized error type");

// expand panel -> "Needs attention" group exists and leads
bar.querySelector(".hb-toggle").dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
await new w.Promise(r=>setTimeout(r,20));
const grps=[...bar.querySelectorAll(".hb-grp")].map(g=>g.textContent);
console.log("groups:", grps);
ok(grps[0]==="Needs attention · 3","'Needs attention' is the first panel group, with all 3 errored sessions");

console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"ERROR-STATE (credits/network/other) CHECK PASSED"));
process.exit(fail.length?1:0);
