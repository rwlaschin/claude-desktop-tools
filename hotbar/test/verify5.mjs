import { JSDOM } from "jsdom"; import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
function boot(unreadIds){
  const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
  const w=dom.window; w.Notification=function(){};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
  w.setInterval=()=>1;w.clearInterval=()=>{};
  w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds},version:0}));
  w["claude.web"]={LocalSessions:{getAll(){return w.Promise.resolve([
    {sessionId:"r1",title:"Running one",isRunning:true,isArchived:false,lastActivityAt:Date.now()-3000},
    {sessionId:"w1",title:"Waiting one",isRunning:false,isArchived:false,lastActivityAt:Date.now()-9000},
  ]);},onOnEvent(){return()=>{};},setFocusedSession(){},getTranscript(){return w.Promise.resolve([]);}}};
  w.eval(src); return w;
}
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};

// only running -> green badge
let w=boot([]); await new w.Promise(r=>setTimeout(r,40));
let badge=w.document.querySelector("#claude-hotbar .hb-count");
console.log("running-only badge bg:", badge&&badge.style.background, "text:", badge&&badge.textContent);
ok(badge && badge.style.background==="rgb(93, 202, 165)" && badge.textContent==="1","running-only badge is green, count 1");

// a waiting session -> coral badge
w=boot(["w1"]); await new w.Promise(r=>setTimeout(r,40));
badge=w.document.querySelector("#claude-hotbar .hb-count");
console.log("with-waiting badge bg:", badge&&badge.style.background, "text:", badge&&badge.textContent);
ok(badge && badge.style.background==="rgb(224, 103, 59)" && badge.textContent==="2","waiting badge is coral, count 2");

console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"BADGE COLOR CHECKS PASSED"));
process.exit(fail.length?1:0);
