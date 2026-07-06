import { JSDOM } from "jsdom"; import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
const w=dom.window; const NOW=Date.now();
w.Notification=function(){};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
w.setInterval=()=>1;w.clearInterval=()=>{};
w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:[]},version:0}));
const real=[{sessionId:"real1",title:"Real session",isRunning:true,isArchived:false,lastActivityAt:NOW-3000}];
w["claude.web"]={LocalSessions:{getAll(){return w.Promise.resolve(real);},onOnEvent(){return()=>{};},setFocusedSession(){},getTranscript(){return w.Promise.resolve([]);}}};
let err=null; try{w.eval(src);}catch(e){err=e;}
await new w.Promise(r=>setTimeout(r,40));
const bar=w.document.getElementById("claude-hotbar");
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};
ok(!err,"no exception: "+(err&&err.message));
ok(typeof w.__claudeHotbar.injectFake==="function","injectFake is exposed on window.__claudeHotbar");
ok(typeof w.__claudeHotbar.clearFake==="function","clearFake is exposed on window.__claudeHotbar");

// inject a fake credit-error session (docs example) and confirm it renders + coexists with real data
w.__claudeHotbar.injectFake([{sessionId:"fake1", title:"TEST: out of credits",
  isRunning:false, isArchived:false, lastActivityAt:NOW-60000,
  errorCategory:"api_billing_error", error:"Credit balance is too low"}]);
await new w.Promise(r=>setTimeout(r,20));
const items=[...bar.querySelectorAll(".hb-item")];
console.log("bar titles:", items.map(i=>i.querySelector(".hb-tt")?i.querySelector(".hb-tt").textContent:""));
ok(items.some(i=>/TEST: out of credits/.test(i.textContent) && i.className.includes("error")),"injected fake credit-error session renders with .error styling");
ok(items.some(i=>/Real session/.test(i.textContent)),"real session still present alongside the fake one");
const badge=bar.querySelector(".hb-count");
ok(badge && badge.style.background==="rgb(163, 45, 45)","badge turns red from the injected fake error");

// clearFake removes it, real data unaffected
w.__claudeHotbar.clearFake();
await new w.Promise(r=>setTimeout(r,20));
const items2=[...bar.querySelectorAll(".hb-item")];
ok(!items2.some(i=>/TEST: out of credits/.test(i.textContent)),"clearFake removes the injected session");
ok(items2.some(i=>/Real session/.test(i.textContent)),"real session unaffected by clearFake");

console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"injectFake/clearFake DEBUG HOOK CHECK PASSED"));
process.exit(fail.length?1:0);
