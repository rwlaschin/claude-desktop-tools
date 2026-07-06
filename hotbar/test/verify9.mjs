import { JSDOM } from "jsdom"; import fs from "fs";
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
const w=dom.window; const NOW=Date.now();
w.Notification=function(){};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
w.setInterval=()=>1;w.clearInterval=()=>{};
w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:[]},version:0}));
const code=[{sessionId:"code1",title:"Code one",isRunning:true,isArchived:false,lastActivityAt:NOW-3000}];
const cowork=[
  {sessionId:"cwk",title:"A space chat",isRunning:true,isArchived:false,spaceId:"sp1",lastActivityAt:NOW-4000},
  {sessionId:"cht",title:"A plain chat",isRunning:true,isArchived:false,lastActivityAt:NOW-5000},
];
w["claude.web"]={LocalSessions:{getAll(){return w.Promise.resolve(code);},onOnEvent(){return()=>{};},setFocusedSession(){},getTranscript(){return w.Promise.resolve([]);}},
  LocalAgentModeSessions:{getAll(){return w.Promise.resolve(cowork);},setFocusedSession(){},getTranscript(){return w.Promise.resolve([]);}}};
let err=null; try{w.eval(src);}catch(e){err=e;}
await new w.Promise(r=>setTimeout(r,50));
const bar=w.document.getElementById("claude-hotbar");
bar.querySelector(".hb-toggle").dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
await new w.Promise(r=>setTimeout(r,20));
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};
ok(!err,"no exception loading the simplified (no font-loading) hotbar.js: "+(err&&err.message));

const cpOf=(title)=>{
  const item=[...bar.querySelectorAll(".hb-row")].find(e=>e.textContent.includes(title));
  const k=item&&item.querySelector('[data-cds="Icon"]');
  return k&&k.textContent?k.textContent.codePointAt(0).toString(16):null;
};
const map={code:cpOf("Code one"), cowork:cpOf("A space chat"), chat:cpOf("A plain chat")};
console.log(JSON.stringify(map));
ok(map.code==="e048","code row -> native code glyph (always rendered, no loading)");
ok(map.cowork==="e0f1","cowork(space) row -> native cowork glyph");
ok(map.chat==="e039","chat row -> native chat glyph");
ok(!/nativeIcons|FONT_B64|loadIconFont|FontFace/.test(src),"all font-loading machinery removed from source");
ok(!bar.querySelector(".hb-item .hb-kind"),"still no kind marker in collapsed bar");

console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"ALWAYS-NATIVE KIND ICON CHECK PASSED"));
process.exit(fail.length?1:0);
