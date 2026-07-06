import { JSDOM } from "jsdom";
import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://claude.ai/", runScripts: "outside-only" });
const w = dom.window; const NOW = Date.now();
w.Notification=function(){}; w.Notification.permission="granted"; w.Notification.requestPermission=()=>{};
w.setInterval=()=>1; w.clearInterval=()=>{};
w.URL.createObjectURL=()=>"blob:x"; w.URL.revokeObjectURL=()=>{};
w.HTMLAnchorElement.prototype.click=function(){ w.__dl={href:this.href,name:this.download}; };
w.localStorage.setItem("epitaxy-unread-v1", JSON.stringify({state:{unreadIds:[]},version:0}));

// a store whose state changes every read -> spy should capture each change
let ctr=0;
const sessions=[{sessionId:"s1",title:"Session one",isRunning:true,isArchived:false,lastActivityAt:NOW-3000}];
w["claude.web"]={
  LocalSessions:{ getAll(){return w.Promise.resolve(sessions);}, onOnEvent(){return ()=>{};}, setFocusedSession(){},
    getTranscript(id){ return w.Promise.resolve([{message:{role:"user",content:[{type:"text",text:"do it"}]}},{message:{role:"assistant",content:[{type:"tool_use",name:"bash"},{type:"text",text:"the latest assistant message about proteins"}]}}]); } },
  Ticker:{ tickStore:{ getState(){ return w.Promise.resolve({n: ctr}); } } },
};
let err=null; try{ w.eval(src);}catch(e){err=e;}
await new w.Promise(r=>setTimeout(r,50));
const bar=w.document.getElementById("claude-hotbar");
const fail=[]; const ok=(c,m)=>{ if(!c) fail.push(m); };
ok(!err,"no exception: "+(err&&err.message));

// spy OFF by default: no export button, spy icon not .on
let icons=[...bar.querySelectorAll(".hb-icon")];
ok(icons.length===1,"spy off: only spy icon, no export (got "+icons.length+")");
ok(!icons[0].classList.contains("on"),"spy icon starts off");

// toggle spy ON
icons[0].dispatchEvent(new w.Event("click"));
await new w.Promise(r=>setTimeout(r,30));
ok(JSON.parse(w.localStorage.getItem("hotbar-spy"))===true,"spy state persisted on");

// drive changes so the buffer fills past the cap
for(let i=0;i<1010;i++){ ctr=i+1; w.__claudeHotbar.refresh(); await w.Promise.resolve(); await new w.Promise(r=>setTimeout(r,0)); }
await new w.Promise(r=>setTimeout(r,20));
const spyIcon=[...bar.querySelectorAll(".hb-icon")].find(e=>e.title&&e.title.startsWith("Spy on"));
const n=spyIcon? parseInt(spyIcon.title.match(/(\d+) captured/)[1],10):-1;
console.log("captured count (title):", n);
ok(n>=999 && n<=1000,"ring buffer capped at 1000 (got "+n+")");

// export button now present; clicking triggers a download
icons=[...bar.querySelectorAll(".hb-icon")];
ok(icons.length===2,"export button appears while spying with data (icons="+icons.length+")");
icons[1].dispatchEvent(new w.Event("click"));
console.log("download:", w.__dl);
ok(w.__dl && /^hotbar-spy-\d+\.json$/.test(w.__dl.name),"export triggers JSON download");

// transcript hover: last message swapped into preview
const item=bar.querySelector(".hb-item");
item.dispatchEvent(new w.Event("mouseenter"));
await new w.Promise(r=>setTimeout(r,1050)); // clear the new 1s hover-debounce
const prev=w.document.querySelector(".claudehotbar-pop .hb-prev");
console.log("hover preview:", prev?prev.textContent:"(none)");
ok(prev && /latest assistant message about proteins/.test(prev.textContent),"hover shows last transcript message");

// toggle spy OFF clears buffer
[...bar.querySelectorAll(".hb-icon")][0].dispatchEvent(new w.Event("click"));
await new w.Promise(r=>setTimeout(r,20));
ok(JSON.parse(w.localStorage.getItem("hotbar-spy"))===false,"spy toggles back off");

console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"ALL SPY/HOVER CHECKS PASSED"));
process.exit(fail.length?1:0);
