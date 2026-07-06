import { JSDOM } from "jsdom"; import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
function boot(seedPos){
  const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
  const w=dom.window; w.Notification=function(){};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
  w.setInterval=()=>1;w.clearInterval=()=>{};
  w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:[]},version:0}));
  if(seedPos) w.localStorage.setItem("hotbar-pos",JSON.stringify(seedPos));
  w["claude.web"]={LocalSessions:{getAll(){return w.Promise.resolve([{sessionId:"a",title:"T",isRunning:true,isArchived:false,lastActivityAt:Date.now()-3000}]);},onOnEvent(){return()=>{};},setFocusedSession(){},getTranscript(){return w.Promise.resolve([]);}}};
  w.eval(src);
  return w;
}
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};

// A: restore saved position on load
let w=boot({left:300,top:150});
await new w.Promise(r=>setTimeout(r,40));
let root=w.document.getElementById("claude-hotbar");
console.log("restore -> left:",root.style.left,"top:",root.style.top,"right:",root.style.right);
ok(root.style.left==="300px"&&root.style.top==="150px"&&root.style.right==="auto","restores saved position on load");
ok(!!root.querySelector(".hb-grip svg"),"drag handle (grip) renders");

// B: drag updates + persists position
w=boot(null);
await new w.Promise(r=>setTimeout(r,40));
root=w.document.getElementById("claude-hotbar");
const grip=root.querySelector(".hb-grip");
grip.dispatchEvent(new w.MouseEvent("mousedown",{clientX:500,clientY:100,bubbles:true}));
w.document.dispatchEvent(new w.MouseEvent("mousemove",{clientX:420,clientY:230}));
w.document.dispatchEvent(new w.MouseEvent("mouseup",{}));
const saved=JSON.parse(w.localStorage.getItem("hotbar-pos")||"null");
console.log("after drag -> style.left:",root.style.left,"| saved:",JSON.stringify(saved));
ok(saved && typeof saved.left==="number" && typeof saved.top==="number","drag persists position to hotbar-pos");
ok(root.style.right==="auto" && root.style.left!=="","drag switches to left/top positioning");

console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"DRAG + POSITION CHECKS PASSED"));
process.exit(fail.length?1:0);
