import { JSDOM } from "jsdom"; import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
const w=dom.window; const NOW=Date.now();
w.Notification=function(){};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
let intervalCb=null; w.setInterval=(f)=>{intervalCb=f;return 1;}; w.clearInterval=()=>{};
let jumped=null;
w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:[]},version:0}));
const sessions=[{sessionId:"s1",title:"Session one",isRunning:true,isArchived:false,lastActivityAt:NOW-3000}];
w["claude.web"]={LocalSessions:{getAll(){return w.Promise.resolve(sessions);},onOnEvent(){return()=>{};},setFocusedSession(id){jumped=id;},getTranscript(){return w.Promise.resolve([]);}}};
let err=null; try{w.eval(src);}catch(e){err=e;}
await new Promise(r=>setTimeout(r,40));
const bar=w.document.getElementById("claude-hotbar");
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};
ok(!err,"no exception: "+(err&&err.message));
const item=bar.querySelector(".hb-item");

// --- 1. hover delay: no preview immediately, none at 500ms, present after ~1050ms ---
item.dispatchEvent(new w.Event("mouseenter"));
await new Promise(r=>setTimeout(r,50));
ok(!w.document.querySelector(".claudehotbar-pop"),"no preview immediately on mouseenter");
await new Promise(r=>setTimeout(r,500));
ok(!w.document.querySelector(".claudehotbar-pop"),"no preview after 500ms (delay not elapsed yet)");
await new Promise(r=>setTimeout(r,550));
ok(!!w.document.querySelector(".claudehotbar-pop"),"preview appears once ~1000ms of hover has elapsed");
item.dispatchEvent(new w.Event("mouseleave"));
await new Promise(r=>setTimeout(r,10));
ok(!w.document.querySelector(".claudehotbar-pop"),"leaving removes the preview");

// --- cancel-on-leave: hover briefly then leave before 1s -> preview never appears ---
item.dispatchEvent(new w.Event("mouseenter"));
await new Promise(r=>setTimeout(r,200));
item.dispatchEvent(new w.Event("mouseleave"));
await new Promise(r=>setTimeout(r,1100));
ok(!w.document.querySelector(".claudehotbar-pop"),"a quick hover-then-leave never shows the preview (debounce cancelled)");

// --- 2. periodic tick during a click doesn't eat it: mousedown -> tick fires -> click still lands ---
item.dispatchEvent(new w.MouseEvent("mousedown",{bubbles:true}));
intervalCb();                                     // simulate the 3s poll landing mid-click
await new Promise(r=>setTimeout(r,20));
const sameNode = w.document.getElementById("claude-hotbar").querySelector(".hb-item") === item;
console.log("same DOM node survives a tick during mousedown:", sameNode);
ok(sameNode,"render is skipped while interacting, so the element under the cursor is not torn down");
item.dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
ok(jumped==="s1","the click after the mid-interaction tick still registers (jump fired)");

// --- interacting window clears afterward so normal ticks resume ---
await new Promise(r=>setTimeout(r,450));
intervalCb();
await new Promise(r=>setTimeout(r,20));
ok(w.document.getElementById("claude-hotbar").querySelector(".hb-item")!==item,"after the interacting window elapses, ticks render normally again (new node)");

// --- 3. click feedback: :active CSS present for the clickable classes ---
ok(/\.hb-item:active\{transform:scale/.test(src),".hb-item has an :active press state");
ok(/\.hb-row:active\{background/.test(src),".hb-row has an :active press state");
ok(/\.hb-icon:active\{transform:scale/.test(src),".hb-icon (spy/export) has an :active press state");
ok(/\.hb-toggle:active\{background/.test(src),".hb-toggle (chevron) has an :active press state");

console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"HOVER-DELAY + INTERACTION-GUARD + PRESS-FEEDBACK CHECK PASSED"));
process.exit(fail.length?1:0);
