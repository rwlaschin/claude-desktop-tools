import { JSDOM } from "jsdom"; import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
const w=dom.window; const NOW=Date.now();
w.Notification=function(){};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
w.setInterval=()=>1;w.clearInterval=()=>{};
w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:[]},version:0}));
const sessions=[]; for(let i=0;i<12;i++) sessions.push({sessionId:"s"+i,title:"Session "+i,isRunning:i<2,isArchived:false,lastActivityAt:NOW-i*100000});
w["claude.web"]={LocalSessions:{getAll(){return w.Promise.resolve(sessions);},onOnEvent(){return()=>{};},setFocusedSession(){},getTranscript(){return w.Promise.resolve([]);}}};
w.eval(src);
await new w.Promise(r=>setTimeout(r,40));
const bar=w.document.getElementById("claude-hotbar");
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};

// expand
bar.querySelector(".hb-toggle").dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
await new w.Promise(r=>setTimeout(r,20));
let input=bar.querySelector(".hb-search input");
ok(!!input,"panel opened with search box");
// BUG1: search must NOT auto-focus (was stealing keystrokes)
ok(w.document.activeElement!==input,"search does NOT auto-focus (no input theft)");

// BUG2 fixed: typing then a poll tick must not lose focus/text
input.focus();
input.value="prot"; input.dispatchEvent(new w.Event("input"));
w.__claudeHotbar.refresh();                 // simulate a 3s poll while typing
await new w.Promise(r=>setTimeout(r,20));
const inputAfter=bar.querySelector(".hb-search input");
ok(w.document.activeElement===inputAfter,"focus retained during poll while typing");
ok(inputAfter.value==="prot","typed text retained during poll");

// scroll-preservation mechanism present (jsdom has no layout to move scrollTop)
ok(/scroll\.scrollTop = panelScroll/.test(src),"scroll position restored across re-renders");

// BUG3: click outside closes the panel
w.document.body.dispatchEvent(new w.MouseEvent("mousedown",{bubbles:true}));
await new w.Promise(r=>setTimeout(r,20));
ok(!bar.querySelector(".hb-panel"),"click-off closes the panel");

console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"PANEL BUG-FIX CHECKS PASSED"));
process.exit(fail.length?1:0);
