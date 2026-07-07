import { JSDOM } from "jsdom"; import fs from "fs";
// Use Case 1 (docs/plans/hotbar-state-model-fix/plan.md): a session ages
// through fresh -> aging based on timing.waiting[id], is exempt from aging
// while pinned, defaults age to 0 when timing.waiting[id] is missing, and
// falls past TOP_N once newer attention items exist (still visible in the
// expanded panel's group() output).
const src = fs.readFileSync(new URL("../hotbar.js", import.meta.url), "utf8");
function boot(sessions, extraLS){
  const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://claude.ai/",runScripts:"outside-only"});
  const w=dom.window; w.Notification=function(){};w.Notification.permission="granted";w.Notification.requestPermission=()=>{};
  w.setInterval=()=>1;w.clearInterval=()=>{};
  w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:sessions.map(s=>s.sessionId)},version:0}));
  if (extraLS) Object.keys(extraLS).forEach(k=>w.localStorage.setItem(k, JSON.stringify(extraLS[k])));
  w["claude.web"]={LocalSessions:{getAll(){return w.Promise.resolve(sessions);},onOnEvent(){return()=>{};},setFocusedSession(){},getTranscript(){return w.Promise.resolve([]);}}};
  w.eval(src); return w;
}
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m);};
const NOW=Date.now();

// 1. under FRESH_MS since unread ping -> "fresh"
{
  const w=boot(
    [{sessionId:"f1",title:"Fresh one",isRunning:false,isArchived:false,lastActivityAt:NOW-5000}],
    {"hotbar-timing":{running:{},waiting:{f1:NOW-60000}}}   // 1 minute old, well under FRESH_MS (10m)
  );
  await new w.Promise(r=>setTimeout(r,40));
  const item=[...w.document.querySelectorAll(".hb-item")].find(i=>/Fresh one/.test(i.textContent));
  console.log("fresh item class:", item&&item.className);
  ok(item && item.className.includes("fresh") && item.querySelector(".m.fresh"),"session under FRESH_MS renders 'fresh' (blue circle)");
}

// 2. at/past FRESH_MS -> "aging"
{
  const w=boot(
    [{sessionId:"a1",title:"Aging one",isRunning:false,isArchived:false,lastActivityAt:NOW-700000}],
    {"hotbar-timing":{running:{},waiting:{a1:NOW-700000}}}   // 11.67 min old, past FRESH_MS (10m)
  );
  await new w.Promise(r=>setTimeout(r,40));
  const item=[...w.document.querySelectorAll(".hb-item")].find(i=>/Aging one/.test(i.textContent));
  console.log("aging item class:", item&&item.className);
  ok(item && item.className.includes("aging") && item.querySelector(".m.aging"),"session at/past FRESH_MS renders 'aging' (coral diamond)");
  ok(/done/.test(item.querySelector(".hb-sub").textContent),"aging label text is still 'done' (only marker color/shape changed)");
}

// 3. Exception: missing timing.waiting[id] defaults age to 0 -> "fresh"
{
  const w=boot([{sessionId:"n1",title:"Never observed",isRunning:false,isArchived:false,lastActivityAt:NOW-5000}]);
  await new w.Promise(r=>setTimeout(r,40));
  const item=[...w.document.querySelectorAll(".hb-item")].find(i=>/Never observed/.test(i.textContent));
  console.log("never-observed item class:", item&&item.className);
  ok(item && item.className.includes("fresh"),"missing timing.waiting[id] defaults age to 0 -> resolves to 'fresh'");
}

// 4. Alternate flow: pinned session stays visible regardless of age. Here
// the pinned session is itself unread+aging, so it's naturally captured by
// the "aging" bucket (which sorts oldest-first) ahead of a single competing
// fresh item, and remains in the collapsed bar within TOP_N without relying
// on the separate pinned-idle bucket.
{
  const w=boot(
    [
      {sessionId:"p1",title:"Pinned aging one",isRunning:false,isArchived:false,lastActivityAt:NOW-2000000},
      {sessionId:"n2",title:"Newer fresh one",isRunning:false,isArchived:false,lastActivityAt:NOW-1000},
    ],
    {"hotbar-timing":{running:{},waiting:{p1:NOW-2000000,n2:NOW-1000}},"hotbar-pins":["p1"]}
  );
  await new w.Promise(r=>setTimeout(r,40));
  const bar=w.document.getElementById("claude-hotbar");
  const titles=[...bar.querySelectorAll(".hb-item .hb-tt")].map(t=>t.textContent);
  console.log("bar with pinned+1 fresh:", titles);
  ok(titles.some(t=>/Pinned aging one/.test(t)),"pinned session stays visible in the bar despite being aging");
  const pinnedItem=[...bar.querySelectorAll(".hb-item")].find(i=>/Pinned aging one/.test(i.textContent));
  ok(pinnedItem && pinnedItem.querySelector(".hb-pin"),"pinned aging session's row still shows the pin icon");
}

// 4b. Alternate flow, idle-pinned case: once the pin's OWN session clears
// unread (dismissed or read elsewhere), it still stays visible via the
// separate pinned-idle bucket regardless of how long it's been idle.
{
  const w=boot(
    [
      {sessionId:"p2",title:"Pinned idle one",isRunning:false,isArchived:false,lastActivityAt:NOW-9000000},
      {sessionId:"r1",title:"Running filler 1",isRunning:true,isArchived:false,lastActivityAt:NOW-1000},
      {sessionId:"r2",title:"Running filler 2",isRunning:true,isArchived:false,lastActivityAt:NOW-1000},
    ],
    {"hotbar-pins":["p2"]}
  );
  w.localStorage.setItem("epitaxy-unread-v1",JSON.stringify({state:{unreadIds:[]},version:0}));
  w.__claudeHotbar.refresh();
  await new w.Promise(r=>setTimeout(r,40));
  const bar=w.document.getElementById("claude-hotbar");
  const titles=[...bar.querySelectorAll(".hb-item .hb-tt")].map(t=>t.textContent);
  console.log("bar with pinned-idle + 2 running:", titles);
  ok(titles.some(t=>/Pinned idle one/.test(t)) && titles.length===3,"a pinned, non-unread, non-running (idle) session stays visible via the pinned-idle bucket regardless of age");
}

// 5. an aging session falls past TOP_N once a newer fresh/aging/running item
// exists, but remains present in the expanded panel's group() output
{
  const sessions=[
    {sessionId:"old1",title:"Old aging",isRunning:false,isArchived:false,lastActivityAt:NOW-2000000},
    {sessionId:"new1",title:"New fresh A",isRunning:false,isArchived:false,lastActivityAt:NOW-1000},
    {sessionId:"new2",title:"New fresh B",isRunning:false,isArchived:false,lastActivityAt:NOW-1000},
    {sessionId:"new3",title:"New fresh C",isRunning:false,isArchived:false,lastActivityAt:NOW-1000},
  ];
  const w=boot(sessions, {"hotbar-timing":{running:{},waiting:{old1:NOW-2000000,new1:NOW-1000,new2:NOW-1000,new3:NOW-1000}}});
  await new w.Promise(r=>setTimeout(r,40));
  const bar=w.document.getElementById("claude-hotbar");
  const barTitles=[...bar.querySelectorAll(".hb-item .hb-tt")].map(t=>t.textContent);
  console.log("bar (TOP_N=3) with 1 aging + 3 fresh:", barTitles);
  ok(!barTitles.some(t=>/Old aging/.test(t)),"the older aging item falls past TOP_N once 3 newer fresh items fill the bar");
  ok(barTitles.length===3,"bar stays capped at TOP_N");
  // still present in the expanded panel's Aging group
  bar.querySelector(".hb-toggle").dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
  await new w.Promise(r=>setTimeout(r,20));
  const agingRows=[...bar.querySelectorAll(".hb-row")].map(r=>r.textContent);
  console.log("panel rows:", agingRows);
  ok(agingRows.some(t=>/Old aging/.test(t)),"the evicted aging item remains visible in the expanded panel's group() output");
}

console.log("\n"+(fail.length?"FAIL:\n - "+fail.join("\n - "):"FRESH/AGING TRANSITION + EVICTION CHECKS PASSED"));
process.exit(fail.length?1:0);
