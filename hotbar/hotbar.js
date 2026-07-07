/*
 * Claude Desktop — Sessions Hotbar
 * ---------------------------------
 * A top-right strip that:
 *   1. Shows sessions needing attention — running (live run time), waiting on
 *      you (live wait time), or pinned — with shape+color status.
 *   2. Fires a desktop notification when a session changes status or newly
 *      pings you ("Waiting on you"), de-duplicated.
 *   3. Expands to a grouped, searchable panel of all sessions; click to jump,
 *      pin to keep in the bar, hover for a preview of the latest activity.
 *
 * Data source (verified against the live app):
 *   window["claude.web"].LocalSessions   — getAll(), setFocusedSession(id),
 *                                           onOnEvent(cb), stopTask(id)
 *   localStorage["epitaxy-unread-v1"]     — {state:{unreadIds:[...]}}  (pings)
 *   localStorage["epitaxy-session-result:<id>"] — latest result (hover preview)
 * The app exposes no run-start / wait-start timestamp, so this stamps state
 * transitions itself and persists them to localStorage["hotbar-timing"].
 *
 * Run now: paste into DevTools console. Auto-load: install-persist.sh.
 */
(function () {
  "use strict";
  if (window.__claudeHotbar) { window.__claudeHotbar.destroy(); }

  var NS = window["claude.web"];
  var api = NS && NS.LocalSessions;              // code sessions (epitaxy)
  var coworkApi = NS && NS.LocalAgentModeSessions; // cowork chats
  if (!api || typeof api.getAll !== "function") {
    console.warn("[hotbar] LocalSessions bridge not found on window['claude.web'].");
    return;
  }
  var kindById = {};   // sessionId -> "code" | "cowork", for routing/open

  // ---- config ----------------------------------------------------------
  var POLL_MS = 3000;
  var TOP_N = 3;               // max items in the collapsed bar
  var RECENT_CAP = 500;        // show the full recent list — the panel scrolls

  // ---- persisted state -------------------------------------------------
  function loadJSON(key, dflt) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : dflt; }
    catch (e) { return dflt; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  var pins = {};               // sessionId -> 1
  (loadJSON("hotbar-pins", [])).forEach(function (id) { pins[id] = 1; });
  // timing.running[id] / timing.waiting[id] = ms timestamp state was entered
  var timing = loadJSON("hotbar-timing", { running: {}, waiting: {} });
  if (!timing.running) timing.running = {};
  if (!timing.waiting) timing.waiting = {};
  // dismissed[id] = ms timestamp jump(id) was called while the session was
  // unread — suppresses its fresh/aging/question badge until unread clears
  // and re-fires (see updateTiming). {sessionId: dismissedAtMs}
  var dismissed = loadJSON("hotbar-dismissed", {});

  // ---- volatile state --------------------------------------------------
  var lastStatus = {};         // id -> "running"|"idle", for change detection
  var lastUnread = {};         // id -> 1
  var lastBlocked = {};        // id -> 1, sessions awaiting your permission answer
  var lastErrored = {};        // id -> 1, sessions with a hard error (credits/network/etc)
  var lastQuestion = {};       // id -> 1, sessions whose last message reads as a question
  var lastAging = {};          // id -> 1, sessions that have crossed FRESH_MS into aging
  var expanded = false;
  var query = "";
  var timer = null, unsub = null, hoverEl = null, hoverTimer = null;
  var pos = loadJSON("hotbar-pos", null);   // {left, top} once dragged
  var panelScroll = 0;                       // preserved panel scroll across re-renders
  var onDocDown = null;                      // outside-click-to-close handler
  var interacting = false;                   // true from mousedown through just after the click
  var HOVER_DELAY_MS = 1000;

  // ---- spy mode (hook-discovery scanner) -------------------------------
  var SPY_CAP = 1000;          // circular buffer size
  var spyOn = loadJSON("hotbar-spy", false);
  var spyBuf = [];             // ring buffer of {t, source, key, value}
  var spySnap = {};            // last-seen serialized value per key, for diffing
  var transcriptCache = {};    // sessionId -> last preview text

  // ---- helpers ---------------------------------------------------------
  function sid(s) { return s.sessionId || s.id || s.cliSessionId; }
  function isRunning(s) { return s.isRunning === true && !s.isArchived; }
  function titleOf(s) {
    return s.title ||
      (s.userSelectedFolders && s.userSelectedFolders.length
        ? s.userSelectedFolders[0].split("/").pop() : null) ||
      (s.cwd ? s.cwd.split("/").pop() : null) || "Untitled session";
  }
  function tnum(t) { if (t == null) return null; var n = typeof t === "number" ? t : Date.parse(t); return isFinite(n) ? n : null; }
  // one uniform duration format, used in EVERY row and view
  function fmtDur(ms) {
    if (ms == null) return "";
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h " + (m % 60) + "m";
    var d = Math.floor(h / 24);
    return d + "d " + (h % 24) + "h";
  }
  // session is blocked on a tool-permission prompt — needs your decision (app shows yellow)
  function needsInput(s) { return Array.isArray(s.pendingToolPermissions) && s.pendingToolPermissions.length > 0; }
  // session hit a hard error (session.error/errorCategory, set by the app's own
  // error-categorization — categories confirmed by reading the app's own bundle:
  // api_billing_error, api_rate_limit, extra_usage_required, network_error,
  // auth_error, api_overloaded, prompt_too_long, and others).
  function hasError(s) { return typeof s.errorCategory === "string" && s.errorCategory.length > 0; }
  var CREDIT_ERROR = { api_billing_error: 1, api_rate_limit: 1, extra_usage_required: 1 };
  function isCreditError(s) { return !!CREDIT_ERROR[s.errorCategory]; }
  function isNetworkError(s) { return s.errorCategory === "network_error"; }
  // heuristic: does the last known message read like it's asking the user
  // something? Ends-with-"?" is the primary signal; a small set of common
  // phrase-openers (checked against just the first 60 chars) catches
  // questions that don't end in "?" (e.g. "Should I proceed with..."). Reads
  // from the existing transcriptCache — never triggers a second fetch.
  var QUESTION_OPENER_RE = /^(could you|would you like|should i|which one|do you want|can you|what would you)\b/i;
  function looksLikeQuestion(text) {
    if (!text) return false;
    var t = String(text).trim();
    if (!t) return false;
    if (/\?\s*$/.test(t)) return true;
    return QUESTION_OPENER_RE.test(t.slice(0, 60));
  }
  // FRESH_MS: a session stays "fresh" (blue) for this long after entering
  // unread. AGING_MS is the fresh/aging boundary itself — there is no third
  // threshold, the name just documents which constant plays which role.
  var FRESH_MS = 600000;    // 10 minutes
  var AGING_MS = 900000;    // 15 minutes — reserved boundary constant, see below
  function waitAgeState(id, unread) {
    if (!unread[id]) return null;
    var age = Date.now() - (timing.waiting[id] || Date.now());
    return age < FRESH_MS ? "fresh" : "aging";
  }
  function state(s, unread) {
    var id = sid(s);
    if (hasError(s)) return "error";       // most urgent: session is broken, needs action
    if (unread[id] && !dismissed[id] && looksLikeQuestion(transcriptCache[id])) return "question";
    if (needsInput(s)) return "blocked";   // waiting on YOUR answer
    if (unread[id] && !dismissed[id]) {
      var ageSt = waitAgeState(id, unread);
      if (ageSt) return ageSt;             // "fresh" or "aging"
    }
    if (isRunning(s)) return "running";
    return "idle";
  }
  // duration to show for a row, per its state (consistent everywhere)
  function durationFor(s, st) {
    var id = sid(s), now = Date.now();
    if (st === "running") return now - (timing.running[id] || tnum(s.lastActivityAt) || now);
    if (st === "fresh" || st === "aging" || st === "question") return now - (timing.waiting[id] || tnum(s.lastActivityAt) || now);
    // "error", "blocked" and "idle" all measure from the last activity (when it stopped)
    return tnum(s.lastActivityAt) != null ? now - tnum(s.lastActivityAt) : null;
  }
  function notify(title, body) {
    try {
      if (window.Notification && Notification.permission === "granted") {
        new Notification(title, { body: body, silent: false });
      }
    } catch (e) {}
  }
  // code-session pings (epitaxy)
  function readCodeUnread() {
    var set = {};
    try {
      var ids = JSON.parse(localStorage.getItem("epitaxy-unread-v1")).state.unreadIds;
      if (Array.isArray(ids)) ids.forEach(function (id) { set[id] = 1; });
    } catch (e) {}
    return set;
  }
  // cowork read-state: {sessions:{id:lastReadMs}, explicitUnread:{id:true}}
  // key is account-scoped; find it rather than hardcode the account id.
  function coworkReadState() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("persisted.cowork-read-state.") === 0) {
          var rs = JSON.parse(localStorage.getItem(k));
          return { sessions: rs.sessions || {}, explicitUnread: rs.explicitUnread || {} };
        }
      }
    } catch (e) {}
    return { sessions: {}, explicitUnread: {} };
  }
  // unified unread map across code + cowork, keyed by sessionId
  function computeUnread(sessions) {
    var set = readCodeUnread();
    var rs = coworkReadState();
    sessions.forEach(function (s) {
      if (s._kind !== "cowork") return;
      var id = sid(s);
      if (rs.explicitUnread[id]) { set[id] = 1; return; }
      var readAt = rs.sessions[id];               // only chats you've opened before
      if (readAt && tnum(s.lastActivityAt) > readAt) set[id] = 1;
    });
    return set;
  }
  // immediate fallback text; the real "what it's about" is fetched async below
  function previewText(s) {
    return transcriptCache[sid(s)] || s.initialMessage || "Loading latest activity…";
  }
  // pull the last message from the transcript for a rich hover preview
  function fetchPreview(s, cb) {
    var id = sid(s);
    if (transcriptCache[id]) { cb(transcriptCache[id]); return; }
    var bridge = s._kind === "cowork" ? coworkApi : api;   // read the right transcript
    if (!bridge || typeof bridge.getTranscript !== "function") { cb(previewText(s)); return; }
    Promise.resolve(bridge.getTranscript(id)).then(function (tr) {
      var msgs = Array.isArray(tr) ? tr : (tr && (tr.messages || tr.items)) || [];
      var last = lastMessageText(msgs);
      transcriptCache[id] = last || s.initialMessage || "No recent activity.";
      cb(transcriptCache[id]);
    }).catch(function () { cb(s.initialMessage || "No recent activity."); });
  }
  // transcript entries look like {message:{role, content:[{type:"text",text}, ...]}}
  function lastMessageText(msgs) {
    for (var i = msgs.length - 1; i >= 0; i--) {
      var m = msgs[i];
      var c = m && (m.message ? m.message.content : (m.content != null ? m.content : m.text));
      var txt = "";
      if (typeof c === "string") txt = c;
      else if (Array.isArray(c)) {
        txt = c.filter(function (p) { return p && p.type === "text" && p.text; })
               .map(function (p) { return p.text; }).join(" ");
      }
      if (txt && txt.trim()) return txt.trim();
    }
    return null;
  }

  // ---- spy scan: diff every live store + storage key, ring-buffer changes
  function spyPush(source, key, value) {
    spyBuf.push({ t: Date.now(), source: source, key: key, value: value });
    if (spyBuf.length > SPY_CAP) spyBuf.splice(0, spyBuf.length - SPY_CAP);
  }
  function scan() {
    if (!spyOn) return;
    // 1. every claude.web.*.<store>.getState() that changed
    try {
      Object.keys(NS || {}).forEach(function (ns) {
        var svc = NS[ns]; if (!svc || typeof svc !== "object") return;
        Object.keys(svc).forEach(function (k) {
          var store = svc[k];
          if (store && typeof store.getState === "function") {
            Promise.resolve(store.getState()).then(function (st) {
              var key = ns + "." + k, ser = JSON.stringify(st);
              if (ser !== spySnap[key]) { spySnap[key] = ser; spyPush("store", key, st); }
            }).catch(function () {});
          }
        });
      });
    } catch (e) {}
    // 2. epitaxy-*/ccd-* localStorage keys that changed
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var lk = localStorage.key(i);
        if (!/^(epitaxy|ccd|LSS|persisted)/.test(lk)) continue;
        var v = localStorage.getItem(lk);
        if (v !== spySnap["ls:" + lk]) { spySnap["ls:" + lk] = v; spyPush("localStorage", lk, v.length > 4000 ? v.slice(0, 4000) + "…" : v); }
      }
    } catch (e) {}
  }
  function exportSpy() {
    try {
      var blob = new Blob([JSON.stringify(spyBuf, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "hotbar-spy-" + Date.now() + ".json";
      document.documentElement.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    } catch (e) { console.warn("[hotbar] export failed", e); }
  }
  function toggleSpy(ev) {
    if (ev) ev.stopPropagation();
    spyOn = !spyOn; saveJSON("hotbar-spy", spyOn);
    if (!spyOn) { spyBuf = []; spySnap = {}; }
    tick();
  }

  // ---- timing bookkeeping (stamp transitions, persist) -----------------
  function updateTiming(sessions, unread) {
    var now = Date.now(), runNow = {}, waitNow = {}, dirty = false;
    sessions.forEach(function (s) {
      var id = sid(s);
      if (isRunning(s)) { runNow[id] = 1; if (!timing.running[id]) { timing.running[id] = tnum(s.lastActivityAt) || now; dirty = true; } }
      if (unread[id])   { waitNow[id] = 1; if (!timing.waiting[id]) { timing.waiting[id] = tnum(s.lastActivityAt) || now; dirty = true; } }
    });
    Object.keys(timing.running).forEach(function (id) { if (!runNow[id]) { delete timing.running[id]; dirty = true; } });
    Object.keys(timing.waiting).forEach(function (id) { if (!waitNow[id]) { delete timing.waiting[id]; dirty = true; } });
    if (dirty) saveJSON("hotbar-timing", timing);
    // a dismissed session stops being suppressed once it's no longer unread —
    // dismissal is a one-shot ack of the CURRENT ping, not a permanent mute
    var dismissDirty = false;
    Object.keys(dismissed).forEach(function (id) {
      if (!unread[id]) { delete dismissed[id]; dismissDirty = true; }
    });
    if (dismissDirty) saveJSON("hotbar-dismissed", dismissed);
  }

  function detectChanges(sessions, unread) {
    var seen = {}, byId = {};
    sessions.forEach(function (s) {
      var id = sid(s); if (!id) return;
      seen[id] = 1; byId[id] = s;
      var st = isRunning(s) ? "running" : "idle", prev = lastStatus[id];
      if (prev !== undefined && prev !== st) notify("Session " + st, titleOf(s));
      lastStatus[id] = st;
    });
    Object.keys(unread).forEach(function (id) {
      if (!lastUnread[id] && !needsInput(byId[id] || {})) notify("Waiting on you", byId[id] ? titleOf(byId[id]) : "A session has new activity");
    });
    lastUnread = unread;
    // blocked = needs your approval/answer — most urgent, notify on entry
    var blockedNow = {};
    sessions.forEach(function (s) {
      var id = sid(s); if (!needsInput(s)) return;
      blockedNow[id] = 1;
      if (!lastBlocked[id]) notify("Needs your answer", titleOf(s));
    });
    lastBlocked = blockedNow;
    // error = session is broken (out of credits, network loss, etc) — most urgent, notify on entry
    var erroredNow = {};
    sessions.forEach(function (s) {
      var id = sid(s); if (!hasError(s)) return;
      erroredNow[id] = 1;
      if (!lastErrored[id]) notify(isCreditError(s) ? "Out of credits" : errorLabel(s), titleOf(s));
    });
    lastErrored = erroredNow;
    // question = last message reads like it's asking the user something —
    // notify on entry, same pattern as blocked/errored
    var questionNow = {};
    sessions.forEach(function (s) {
      var id = sid(s);
      if (!unread[id] || dismissed[id] || hasError(s) || needsInput(s)) return;
      if (!looksLikeQuestion(transcriptCache[id])) return;
      questionNow[id] = 1;
      if (!lastQuestion[id]) notify("Question for you", titleOf(s));
    });
    lastQuestion = questionNow;
    // aging = a fresh/waiting session has crossed FRESH_MS without being
    // dismissed — notify once on the fresh->aging transition
    var agingNow = {};
    sessions.forEach(function (s) {
      var id = sid(s);
      if (!unread[id] || dismissed[id] || hasError(s) || needsInput(s) || questionNow[id]) return;
      if (waitAgeState(id, unread) !== "aging") return;
      agingNow[id] = 1;
      if (!lastAging[id]) notify("Still waiting on you", titleOf(s));
    });
    lastAging = agingNow;
    // proactive preview fetch: the moment a session first resolves to fresh,
    // populate transcriptCache[id] unconditionally (not gated on hover) so
    // the question heuristic has data to work with on a later tick
    sessions.forEach(function (s) {
      var id = sid(s);
      if (!unread[id] || dismissed[id] || hasError(s) || needsInput(s)) return;
      if (waitAgeState(id, unread) === "fresh" && !transcriptCache[id]) fetchPreview(s, function () {});
    });
    Object.keys(lastStatus).forEach(function (id) { if (!seen[id]) delete lastStatus[id]; });
  }

  // ---- drag + remembered position -------------------------------------
  function applyPos() {
    if (pos && typeof pos.left === "number") {
      root.style.left = pos.left + "px";
      root.style.top = pos.top + "px";
      root.style.right = "auto";
    }
  }
  function startDrag(e) {
    e.preventDefault(); e.stopPropagation();
    hidePreview();
    var r = root.getBoundingClientRect();
    var offX = e.clientX - r.left, offY = e.clientY - r.top, w = r.width, h = r.height;
    function move(ev) {
      var left = Math.max(0, Math.min(ev.clientX - offX, window.innerWidth - w));
      var top = Math.max(0, Math.min(ev.clientY - offY, window.innerHeight - h));
      root.style.left = left + "px"; root.style.top = top + "px"; root.style.right = "auto";
      pos = { left: left, top: top };
    }
    function up() {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      if (pos) saveJSON("hotbar-pos", pos);
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  // ---- actions ---------------------------------------------------------
  // Code sessions open at /epitaxy/<id> via the TanStack router (no reload).
  // Cowork chats have no known deep-link route, so setFocusedSession alone
  // only updates which chat is focused *inside* the cowork view — if the
  // code tab is currently mounted instead, that call is a silent no-op.
  // Fix: click the app's own tab switcher into the cowork view first (the
  // same thing a user does by hand), then focus the session.
  function switchToCoworkTab() {
    try {
      var nodes = document.querySelectorAll('[role="tab"], button, a');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.closest && el.closest("#claude-hotbar")) continue; // never click our own bar
        var label = (el.getAttribute("aria-label") || el.textContent || "").trim();
        if (/^cowork$/i.test(label)) { el.click(); return true; }
      }
    } catch (e) {}
    return false;
  }
  function jump(id) {
    dismissed[id] = Date.now(); saveJSON("hotbar-dismissed", dismissed);
    var cowork = kindById[id] === "cowork";
    var bridge = cowork ? coworkApi : api;
    if (cowork) {
      switchToCoworkTab();
      try { if (bridge && bridge.setFocusedSession) bridge.setFocusedSession(id); } catch (e) {}
      return;
    }
    try { if (bridge && bridge.setFocusedSession) bridge.setFocusedSession(id); } catch (e) {}
    var path = "/epitaxy/" + id;
    try {
      var r = window.__TSR_ROUTER__;
      if (r && typeof r.navigate === "function") { r.navigate({ to: path }); return; }
    } catch (e) {}
    try { if (location.pathname !== path) location.assign(path); } catch (e) {}
  }
  function togglePin(id, ev) {
    if (ev) ev.stopPropagation();
    if (pins[id]) delete pins[id]; else pins[id] = 1;
    saveJSON("hotbar-pins", Object.keys(pins));
    tick();
  }
  // credits-related errors open the billing page directly instead of jumping
  // to the (unusable) session — URL confirmed from the app's own external links.
  function openUpgrade(ev) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    try { window.open("https://claude.com/buy_credits", "_blank"); } catch (e) {}
  }

  // ---- DOM -------------------------------------------------------------
  var root = document.createElement("div");
  root.id = "claude-hotbar";
  var style = document.createElement("style");
  style.textContent = [
    "#claude-hotbar{position:fixed;top:28px;right:12px;z-index:2147483647;",
    "  font:12px/1.25 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e8e6df;",
    "  background:rgba(28,28,30,.96);border:1px solid rgba(255,255,255,.10);border-radius:12px;",
    "  box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;align-items:stretch;max-width:70vw;",
    "  overflow:visible;-webkit-app-region:no-drag;}",
    "#claude-hotbar .hb-item{position:relative;display:flex;align-items:center;gap:8px;padding:8px 12px;",
    "  cursor:pointer;border-right:1px solid rgba(255,255,255,.07);max-width:230px;",
    "  transition:transform .08s ease,background .08s ease;}",
    "#claude-hotbar .hb-item:active{transform:scale(.97);background:rgba(255,255,255,.12);}",
    "#claude-hotbar .hb-grip{display:flex;align-items:center;padding:8px 3px;cursor:grab;color:#8f8d88;",
    "  opacity:.45;border-radius:12px 0 0 12px;-webkit-app-region:no-drag;}",
    "#claude-hotbar .hb-grip:hover{opacity:.85;background:rgba(255,255,255,.06);}",
    "#claude-hotbar .hb-grip:active{cursor:grabbing;}",
    "#claude-hotbar .hb-item:hover{background:rgba(255,255,255,.06);}",
    "#claude-hotbar .hb-item.fresh{background:rgba(55,138,221,.16);border-left:3px solid #378ADD;}",
    "#claude-hotbar .hb-item.fresh .hb-sub{color:#9dc3ee;}",
    "#claude-hotbar .hb-item.aging{background:rgba(216,90,48,.16);border-left:3px solid #e0673b;}",
    "#claude-hotbar .hb-item.aging .hb-sub{color:#c9a08c;}",
    "#claude-hotbar .hb-item.question{background:rgba(226,75,74,.16);border-left:3px solid #e24b4a;}",
    "#claude-hotbar .hb-item.question .hb-sub{color:#f0a3a2;}",
    "#claude-hotbar .hb-item.blocked{background:rgba(224,162,75,.18);border-left:3px solid #e0a24b;}",
    "#claude-hotbar .hb-item.blocked .hb-sub{color:#d8b483;}",
    "#claude-hotbar .hb-tt{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    "#claude-hotbar .hb-sub{color:#9a9891;font-size:11px;}",
    // shape+color status markers
    "#claude-hotbar .m{width:9px;height:9px;flex:none;display:inline-block;}",
    "#claude-hotbar .m.running{border-radius:50%;background:#5dcaa5;box-shadow:0 0 6px #5dcaa5;}",
    "#claude-hotbar .m.fresh{border-radius:50%;background:#378ADD;box-shadow:0 0 6px #378ADD;}",
    "#claude-hotbar .m.aging{background:#e0673b;transform:rotate(45deg);}",
    "#claude-hotbar .m.idle{border-radius:50%;border:1.5px solid #8f8d88;box-sizing:border-box;}",
    "#claude-hotbar .m.blocked{border-radius:2px;background:#e0a24b;box-shadow:0 0 6px #e0a24b;}",
    "#claude-hotbar .m.question{display:flex;flex:none;color:#e24b4a;width:auto;height:auto;}",
    // error's marker keeps the dark saturated red (#A32D2D) exclusively —
    // never reassigned, so it stays visually distinct from .question's #e24b4a
    "#claude-hotbar .m-alert{display:flex;flex:none;color:#A32D2D;}",
    "#claude-hotbar .hb-item.error{background:rgba(163,45,45,.16);border-left:3px solid #A32D2D;}",
    "#claude-hotbar .hb-item.error .hb-sub{color:#f0a3a2;}",
    "#claude-hotbar .hb-row.error{background:rgba(226,75,74,.10);}",
    "#claude-hotbar .hb-row.error .hb-sub{color:#f0a3a2;}",
    "#claude-hotbar .hb-kind{display:flex;align-items:center;flex:none;opacity:.65;color:#c9c7c0;}",
    "#claude-hotbar .hb-pin{color:#e0a24b;margin-right:4px;display:inline-flex;vertical-align:-2px;}",
    "#claude-hotbar .hb-icon{padding:8px 8px;display:flex;align-items:center;cursor:pointer;font-size:13px;",
    "  opacity:.75;border-left:1px solid rgba(255,255,255,.07);transition:transform .08s ease,background .08s ease;}",
    "#claude-hotbar .hb-icon:hover{opacity:1;background:rgba(255,255,255,.06);}",
    "#claude-hotbar .hb-icon:active{transform:scale(.9);background:rgba(255,255,255,.16);}",
    "#claude-hotbar .hb-icon.on{opacity:1;color:#e0673b;}",
    "#claude-hotbar .hb-toggle{padding:8px 11px;display:flex;align-items:center;gap:5px;cursor:pointer;color:#d9d7d0;",
    "  border-left:1px solid rgba(255,255,255,.07);transition:background .08s ease;}",
    "#claude-hotbar .hb-toggle:hover{background:rgba(255,255,255,.06);border-radius:0 12px 12px 0;}",
    "#claude-hotbar .hb-toggle:active{background:rgba(255,255,255,.16);border-radius:0 12px 12px 0;}",
    "#claude-hotbar .hb-count{background:#e0673b;color:#fff;font-size:10px;font-weight:500;border-radius:9px;",
    "  padding:1px 6px;display:flex;align-items:center;gap:2px;}",
    "#claude-hotbar .hb-count-icon{display:flex;}",
    "#claude-hotbar .hb-chev{display:flex;opacity:.7;transition:transform .15s ease;}",
    "#claude-hotbar .hb-chev.up{transform:rotate(180deg);}",
    "#claude-hotbar .hb-icon svg,#claude-hotbar .hb-toggle svg{display:block;}",
    // hover preview
    // preview card lives at document level, so its styles must NOT be scoped
    // under #claude-hotbar (it isn't a descendant) — use a standalone class
    ".claudehotbar-pop{position:fixed;width:260px;background:rgba(20,20,22,.98);color:#e8e6df;",
    "  font:12px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;",
    "  border:1px solid rgba(255,255,255,.12);border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.45);",
    "  padding:11px 13px;z-index:2147483647;pointer-events:none;}",
    ".claudehotbar-pop h4{margin:0 0 7px;font-size:12px;font-weight:500;display:flex;align-items:center;gap:7px;}",
    ".claudehotbar-pop p{margin:0;font-size:11px;color:#a8a69f;line-height:1.5;}",
    ".claudehotbar-pop .meta{margin-top:7px;font-size:10px;color:#78766f;}",
    ".claudehotbar-pop .m{width:9px;height:9px;flex:none;display:inline-block;}",
    ".claudehotbar-pop .m.running{border-radius:50%;background:#5dcaa5;}",
    ".claudehotbar-pop .m.fresh{border-radius:50%;background:#378ADD;}",
    ".claudehotbar-pop .m.aging{background:#e0673b;transform:rotate(45deg);}",
    ".claudehotbar-pop .m.idle{border-radius:50%;border:1.5px solid #8f8d88;box-sizing:border-box;}",
    ".claudehotbar-pop .m.blocked{border-radius:2px;background:#e0a24b;}",
    ".claudehotbar-pop .m.question{display:flex;flex:none;color:#e24b4a;width:auto;height:auto;}",
    // expanded panel: fixed-height flex column — search header stays put,
    // only the inner .hb-scroll list scrolls (scrollbar spans the list only)
    "#claude-hotbar .hb-panel{position:absolute;top:calc(100% + 6px);right:0;width:300px;",
    "  background:rgba(24,24,26,.98);border:1px solid rgba(255,255,255,.10);border-radius:10px;",
    "  max-height:60vh;display:flex;flex-direction:column;overflow:hidden;}",
    "#claude-hotbar .hb-scroll{overflow-y:auto;overscroll-behavior:contain;min-height:0;}",
    "#claude-hotbar .hb-scroll::-webkit-scrollbar{width:9px;}",
    "#claude-hotbar .hb-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:5px;border:2px solid transparent;background-clip:padding-box;}",
    "#claude-hotbar .hb-scroll::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.28);background-clip:padding-box;}",
    "#claude-hotbar .hb-search{flex:none;display:flex;align-items:center;gap:6px;padding:8px 11px;color:#8f8d88;",
    "  border-bottom:1px solid rgba(255,255,255,.06);background:rgba(24,24,26,.99);}",
    "#claude-hotbar .hb-search input{flex:1;background:none;border:none;outline:none;color:#e8e6df;font:inherit;}",
    "#claude-hotbar .hb-grp{padding:8px 11px 3px;font-size:10px;text-transform:uppercase;letter-spacing:.04em;}",
    "#claude-hotbar .hb-row{display:flex;align-items:center;gap:8px;padding:7px 11px;cursor:pointer;",
    "  transition:background .08s ease;}",
    "#claude-hotbar .hb-row:hover{background:rgba(255,255,255,.06);}",
    "#claude-hotbar .hb-row:active{background:rgba(255,255,255,.14);}",
    "#claude-hotbar .hb-row .hb-sub{margin-left:auto;}",
    "#claude-hotbar .hb-act{opacity:.4;padding:3px 4px;border-radius:6px;display:flex;transition:transform .08s ease;}",
    "#claude-hotbar .hb-act:active{transform:scale(.85);}",
    "#claude-hotbar .hb-act:hover{opacity:1;background:rgba(255,255,255,.12);}",
    "#claude-hotbar .hb-act.pinned{opacity:1;color:#e0a24b;}",
  ].join("");
  document.documentElement.appendChild(style);
  document.documentElement.appendChild(root);
  function esc(t) { return String(t).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }

  // Icons: official Lucide glyphs (MIT), 24x24 grid, currentColor, stroke 2.
  var ICON = {
    spy: '<path d="M14 18a2 2 0 0 0-4 0"/><path d="m19 11-2.11-6.657a2 2 0 0 0-2.752-1.148l-1.276.61A2 2 0 0 1 12 4H8.5a2 2 0 0 0-1.925 1.456L5 11"/><path d="M2 11h20"/><circle cx="17" cy="18" r="3"/><circle cx="7" cy="18" r="3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    grip: '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'
  };
  function ic(name, size) {
    return '<svg width="' + (size || 14) + '" height="' + (size || 14) + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      ICON[name] + "</svg>";
  }

  function marker(st, s) {
    if (st === "error") return '<span class="m-alert">' + ic("alert", 13) + "</span>";
    if (st === "question") return '<span class="m question">' + ic("alert", 13) + "</span>";
    return '<span class="m ' + st + '"></span>';
  }
  // label text is unchanged between fresh/aging ("done") — only marker
  // color/shape differs; question gets its own "question?" label
  var STATE_LABEL = { blocked: "needs you", fresh: "done", aging: "done", question: "question?", running: "running", idle: "idle" };
  // errorCategory -> a human label, per the app's own error taxonomy (read from
  // its bundle). Credits categories replace the row's duration entirely with
  // an "Upgrade credits" action — no point counting how long you've been stuck.
  function errorLabel(s) {
    if (isCreditError(s)) return "Upgrade credits";
    if (isNetworkError(s)) return "Connection lost";
    return String(s.errorCategory || "error").replace(/_/g, " ");
  }
  function subFor(s, st) {
    if (st === "error") {
      var lbl = errorLabel(s);
      return isCreditError(s) ? lbl : lbl + " · " + fmtDur(durationFor(s, st));
    }
    return (STATE_LABEL[st] || st) + " · " + fmtDur(durationFor(s, st));
  }

  // kind = code (LocalSessions) | cowork (agent-mode w/ space) | chat (agent-mode)
  var KIND_CP = { chat: "", cowork: "", code: "" };  // Anthropicons codepoints
  function kindOf(s) { return s._kind === "code" ? "code" : (s.spaceId ? "cowork" : "chat"); }
  function kindLabel(s) { return kindOf(s); }
  function kindGlyph(s) {
    var k = kindOf(s);
    // native CDS Icon markup, byte-for-byte as the app renders it — the font is
    // already loaded on this page for the app's own icon buttons, so no loading
    // step is needed here.
    return '<span data-cds="Icon" aria-hidden="true" class="hb-kind" title="' + k + '" ' +
      'style="font-family: var(--font-anthropicons, Anthropicons-Variable); font-feature-settings: &quot;liga&quot; 0; ' +
      'font-optical-sizing: auto; font-style: normal; font-variation-settings: normal; line-height: 1; width: 1em; height: 1em; ' +
      'display: flex; align-items: center; justify-content: center; flex-shrink: 0; user-select: none; font-size: 14px; ' +
      'font-weight: 533.3;">' + KIND_CP[k] + "</span>";
  }

  function showPreview(s, anchor) {
    hidePreview();
    var st = state(s, lastUnread);
    hoverEl = document.createElement("div");
    hoverEl.className = "claudehotbar-pop";
    hoverEl.innerHTML =
      "<h4>" + marker(st, s) + esc(titleOf(s)) + "</h4>" +
      '<p class="hb-prev">' + esc(previewText(s).slice(0, 240)) + "</p>" +
      '<div class="meta">' + kindLabel(s) +
        (s.cwd ? " · " + esc(s.cwd.replace(/\/outputs$/, "").split("/").slice(-2).join("/")) : "") +
        (s.model ? " · " + esc(s.model) : "") + " · " + subFor(s, st) + "</div>";
    document.documentElement.appendChild(hoverEl);
    var r = anchor.getBoundingClientRect();
    hoverEl.style.top = (r.bottom + 6) + "px";
    hoverEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 268)) + "px";
    // fetch the real last-message preview and swap it in if still hovering
    var mine = hoverEl;
    fetchPreview(s, function (txt) {
      if (hoverEl === mine) {
        var p = mine.querySelector(".hb-prev");
        if (p) p.textContent = txt.slice(0, 240);
      }
    });
  }
  function hidePreview() { if (hoverEl && hoverEl.parentNode) hoverEl.parentNode.removeChild(hoverEl); hoverEl = null; }
  // debounced hover: only show the preview after a sustained hover, so a
  // click-through (or just passing the mouse over a row) never triggers it.
  function scheduleHover(s, el) {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () { showPreview(s, el); }, HOVER_DELAY_MS);
  }
  function cancelHover() { clearTimeout(hoverTimer); hidePreview(); }
  // mousedown..click: pause re-renders so the element under the cursor is
  // never torn down and rebuilt mid-click, which was eating clicks. Also
  // suppresses the hover preview while the user is actively clicking.
  function markInteracting() {
    interacting = true;
    clearTimeout(hoverTimer);
    setTimeout(function () { interacting = false; }, 400);
  }

  function barItem(s) {
    var id = sid(s), st = state(s, lastUnread);
    var el = document.createElement("div");
    el.className = "hb-item" + (st === "error" ? " error" : st === "question" ? " question" : st === "blocked" ? " blocked" : st === "fresh" ? " fresh" : st === "aging" ? " aging" : "");
    el.onmousedown = markInteracting;
    el.onclick = function (e) { isCreditError(s) ? openUpgrade(e) : jump(id); };
    el.onmouseenter = function () { scheduleHover(s, el); };
    el.onmouseleave = cancelHover;
    el.innerHTML = marker(st, s) +
      '<div style="min-width:0"><div class="hb-tt">' +
        (pins[id] ? '<span class="hb-pin">' + ic("pin", 11) + "</span>" : "") + esc(titleOf(s)) + "</div>" +
      '<div class="hb-sub">' + subFor(s, st) + "</div></div>";
    return el;
  }

  function panelRow(s) {
    var id = sid(s), st = state(s, lastUnread);
    var el = document.createElement("div");
    el.className = "hb-row" + (st === "error" ? " error" : "");
    el.onmousedown = markInteracting;
    el.onclick = function (e) { isCreditError(s) ? openUpgrade(e) : jump(id); };
    el.onmouseenter = function () { scheduleHover(s, el); };
    el.onmouseleave = cancelHover;
    var rowSub = st === "error" ? errorLabel(s) : fmtDur(durationFor(s, st));
    el.innerHTML = (st === "error" ? '<span class="m-alert">' + ic("alert", 13) + "</span>" : kindGlyph(s)) +
      '<span class="hb-tt" style="max-width:140px">' + esc(titleOf(s)) + "</span>" +
      '<span class="hb-act' + (pins[id] ? " pinned" : "") + '" title="' + (pins[id] ? "Unpin" : "Pin") + '">' + ic("pin", 13) + "</span>" +
      '<span class="hb-sub">' + esc(rowSub) + "</span>";
    var pinBtn = el.querySelector(".hb-act");
    if (pinBtn) { pinBtn.onmousedown = markInteracting; pinBtn.onclick = function (e) { togglePin(id, e); }; }
    return el;
  }

  function group(title, color, list) {
    if (!list.length) return;
    var box = root.querySelector(".hb-scroll");
    var h = document.createElement("div");
    h.className = "hb-grp"; h.style.color = color;
    h.textContent = title;
    box.appendChild(h);
    list.forEach(function (s) { box.appendChild(panelRow(s)); });
  }

  function render(sessions, unread) {
    var byOldest = function (a, b) { return (durationFor(b, state(b, unread))) - (durationFor(a, state(a, unread))); };
    // priority: error > question > blocked > fresh > aging > running > pinned-idle
    var errored = sessions.filter(function (s) { return hasError(s); });
    var question = sessions.filter(function (s) { return !hasError(s) && !needsInput(s) && unread[sid(s)] && !dismissed[sid(s)] && looksLikeQuestion(transcriptCache[sid(s)]); });
    var blocked = sessions.filter(function (s) { return !hasError(s) && needsInput(s); });
    var fresh = sessions.filter(function (s) { var id = sid(s); return !hasError(s) && !needsInput(s) && !question.some(function (q) { return sid(q) === id; }) && waitAgeState(id, unread) === "fresh" && !dismissed[id]; });
    var aging = sessions.filter(function (s) { var id = sid(s); return !hasError(s) && !needsInput(s) && !question.some(function (q) { return sid(q) === id; }) && waitAgeState(id, unread) === "aging" && !dismissed[id]; });
    var running = sessions.filter(function (s) { return !hasError(s) && !needsInput(s) && !unread[sid(s)] && isRunning(s); });
    var pinned = sessions.filter(function (s) { return pins[sid(s)] && !hasError(s) && !needsInput(s) && !unread[sid(s)] && !isRunning(s); });
    errored.sort(byOldest); question.sort(byOldest); blocked.sort(byOldest); fresh.sort(byOldest); aging.sort(byOldest); running.sort(byOldest);

    // collapsed bar: errored, then question, then blocked, then fresh, then
    // aging, then running, then pinned — capped. question is placed before
    // fresh/aging and is never dropped by the slice differently than
    // blocked/errored — it just naturally survives being earlier in the
    // concat order.
    var bar = errored.concat(question).concat(blocked).concat(fresh).concat(aging).concat(running).concat(pinned).slice(0, TOP_N);
    // if any sessions exist at all, always show at least TOP_N — backfill
    // remaining slots with the most-recently-active sessions not already shown
    if (bar.length < TOP_N && sessions.length) {
      var barIds = {};
      bar.forEach(function (s) { barIds[sid(s)] = 1; });
      var filler = sessions.filter(function (s) { return !barIds[sid(s)]; })
        .sort(function (a, b) { return (tnum(b.lastActivityAt) || 0) - (tnum(a.lastActivityAt) || 0); });
      bar = bar.concat(filler.slice(0, TOP_N - bar.length));
    }
    var oldScroll = root.querySelector(".hb-scroll");
    if (oldScroll) panelScroll = oldScroll.scrollTop;   // keep scroll across re-renders
    root.innerHTML = "";
    var grip = document.createElement("div");
    grip.className = "hb-grip"; grip.title = "Drag to move";
    grip.innerHTML = ic("grip");
    grip.onmousedown = startDrag;
    root.appendChild(grip);
    if (!bar.length) {
      var em = document.createElement("div");
      em.className = "hb-item"; em.style.cursor = "default";
      em.innerHTML = '<span class="m idle"></span><div class="hb-sub" style="color:#9a9891">No active sessions</div>';
      root.appendChild(em);
    } else {
      bar.forEach(function (s) { root.appendChild(barItem(s)); });
    }

    // spy toggle + export (export shows only while spying with data)
    var spy = document.createElement("div");
    spy.className = "hb-icon" + (spyOn ? " on" : "");
    spy.innerHTML = ic("spy");
    spy.title = spyOn ? ("Spy on · " + spyBuf.length + " captured (click to stop)") : "Spy off — discover live data hooks";
    spy.onmousedown = markInteracting;
    spy.onclick = toggleSpy;
    root.appendChild(spy);
    if (spyOn && spyBuf.length) {
      var exp = document.createElement("div");
      exp.className = "hb-icon";
      exp.innerHTML = ic("download");
      exp.title = "Export " + spyBuf.length + " captured events (JSON)";
      exp.onmousedown = markInteracting;
      exp.onclick = function (e) { e.stopPropagation(); exportSpy(); };
      root.appendChild(exp);
    }

    var needsAction = errored.length + question.length + blocked.length + fresh.length + aging.length;
    var attentionCount = needsAction + running.length;
    // Dark saturated red for a broken session — deliberately far from the
    // question/aging coral tones, which read as near-identical at badge size
    // if only hue shifts slightly. An icon inside the badge makes it
    // unmistakable regardless of color perception, not just a color swap.
    var badgeBg = errored.length ? "#A32D2D" : (question.length ? "#e24b4a" : (blocked.length ? "#e0a24b" : (aging.length ? "#e0673b" : (fresh.length ? "#378ADD" : "#5dcaa5"))));
    var badgeFg = errored.length ? "#fff" : (question.length ? "#fff" : (blocked.length ? "#3a2a08" : (aging.length ? "#fff" : (fresh.length ? "#fff" : "#04342c"))));
    var badgeIcon = errored.length ? '<span class="hb-count-icon">' + ic("alert", 10) + "</span>" : "";
    var tg = document.createElement("div");
    tg.className = "hb-toggle";
    tg.innerHTML = (attentionCount ? '<span class="hb-count" style="background:' + badgeBg + ';color:' + badgeFg + '">' + badgeIcon + attentionCount + "</span>" : "") +
      '<span class="hb-chev' + (expanded ? " up" : "") + '">' + ic("chevron") + "</span>";
    tg.title = sessions.length + " sessions";
    tg.onmousedown = markInteracting;
    tg.onclick = function () { expanded = !expanded; render(sessions, unread); };
    root.appendChild(tg);

    if (expanded) {
      var panel = document.createElement("div");
      panel.className = "hb-panel";
      root.appendChild(panel);
      var q = query.toLowerCase();
      var match = function (s) { return !q || titleOf(s).toLowerCase().indexOf(q) >= 0; };
      var search = document.createElement("div");
      search.className = "hb-search";
      search.innerHTML = ic("search", 13) + '<input placeholder="Search sessions" />';
      var input = search.querySelector("input");
      input.value = query;
      input.oninput = function () {
        var caret = input.selectionStart;
        query = input.value;
        render(sessions, unread);            // rebuilds the panel...
        var ni = root.querySelector(".hb-search input");
        if (ni) { ni.focus(); try { ni.setSelectionRange(caret, caret); } catch (e) {} }  // ...so restore focus+caret
      };
      input.onclick = function (e) { e.stopPropagation(); };
      panel.appendChild(search);
      var scroll = document.createElement("div");   // the only scrolling region
      scroll.className = "hb-scroll";
      panel.appendChild(scroll);

      // only idle pinned sessions here — a pinned session with its own status
      // (question/blocked/fresh/aging/running) already appears in that group
      var pinnedAll = pinned.filter(match);
      var recent = sessions.filter(function (s) { return !hasError(s) && !unread[sid(s)] && !isRunning(s) && !pins[sid(s)] && match(s); })
        .sort(function (a, b) { return (tnum(b.lastActivityAt) || 0) - (tnum(a.lastActivityAt) || 0); });
      var recentShown = recent.slice(0, RECENT_CAP);

      group("Needs attention · " + errored.filter(match).length, "#A32D2D", errored.filter(match));
      group("Question · " + question.filter(match).length, "#e24b4a", question.filter(match));
      group("Needs you · " + blocked.filter(match).length, "#e0a24b", blocked.filter(match));
      group("Done · " + fresh.filter(match).length, "#378ADD", fresh.filter(match));
      group("Aging · " + aging.filter(match).length, "#e0673b", aging.filter(match));
      group("Running · " + running.filter(match).length, "#5dcaa5", running.filter(match));
      group("Pinned · " + pinnedAll.length, "#6b9bd1", pinnedAll);
      group("Recent · showing " + recentShown.length + " of " + recent.length, "#8f8d88", recentShown);
      scroll.scrollTop = panelScroll;   // restore scroll position after rebuild
      // NOTE: do not auto-focus the search — it steals keystrokes from the app.
    }
  }

  // ---- loop ------------------------------------------------------------
  function normalize(res) {
    return Array.isArray(res) ? res : (res && (res.sessions || res.items)) || [];
  }
  // merge code sessions + cowork chats, tag each with _kind, index kindById
  // Debug/test injection: contextBridge-exposed objects (window["claude.web"].*)
  // are frequently frozen/non-configurable, so monkey-patching getAll from the
  // console silently fails. This is the supported way to test states like the
  // error/alert row without waiting for a real credits/network failure —
  // see window.__claudeHotbar.injectFake / .clearFake below.
  var fakeSessions = [];
  var fakeExpireTimer = null;
  function fetchSessions() {
    var codeP = Promise.resolve(api.getAll()).then(normalize).catch(function () { return []; });
    var cwP = coworkApi ? Promise.resolve(coworkApi.getAll()).then(normalize).catch(function () { return []; })
                        : Promise.resolve([]);
    return Promise.all([codeP, cwP]).then(function (r) {
      kindById = {};
      var out = [];
      r[0].forEach(function (s) { if (!s.isArchived) { s._kind = "code"; kindById[sid(s)] = "code"; out.push(s); } });
      r[1].forEach(function (s) { if (!s.isArchived) { s._kind = "cowork"; kindById[sid(s)] = "cowork"; out.push(s); } });
      fakeSessions.forEach(function (s) { var k = s._kind || "code"; kindById[sid(s)] = k; out.push(s); });
      return out;
    });
  }
  // true while the user is typing in the panel search — don't yank focus mid-type
  function isTyping() {
    var a = document.activeElement;
    return expanded && a && a.tagName === "INPUT" && root.contains(a);
  }
  function tick() {
    fetchSessions().then(function (sessions) {
      var unread = computeUnread(sessions);
      updateTiming(sessions, unread);
      detectChanges(sessions, unread);   // notifications still fire
      scan();
      // skip re-render while typing (loses keystrokes) or mid-click (eats the
      // click — the element the mouse is over gets torn down and rebuilt)
      if (isTyping() || interacting) return;
      render(sessions, unread);
    });
  }

  function start() {
    applyPos();
    // click anywhere outside the bar closes the expanded panel
    onDocDown = function (e) {
      if (expanded && !root.contains(e.target)) { expanded = false; hidePreview(); tick(); }
    };
    document.addEventListener("mousedown", onDocDown, true);
    if (window.Notification && Notification.permission === "default") Notification.requestPermission();
    try {
      var sub = api.onOnEvent || api.onEvent;
      if (typeof sub === "function") unsub = sub.call(api, function () { tick(); });
    } catch (e) {}
    timer = setInterval(tick, POLL_MS);
    tick();
  }

  window.__claudeHotbar = {
    destroy: function () {
      if (timer) clearInterval(timer);
      try { if (typeof unsub === "function") unsub(); } catch (e) {}
      try { if (onDocDown) document.removeEventListener("mousedown", onDocDown, true); } catch (e) {}
      hidePreview();
      [root, style].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
      delete window.__claudeHotbar;
    },
    refresh: tick,
    // Test the alert/error row without a real credits/network failure.
    // Example:
    //   window.__claudeHotbar.injectFake([{sessionId:"fake1", title:"TEST: out of credits",
    //     isRunning:false, isArchived:false, lastActivityAt:Date.now()-60000,
    //     errorCategory:"api_billing_error", error:"Credit balance is too low"}])
    // Categories: api_billing_error / api_rate_limit / extra_usage_required -> "Upgrade credits"
    //             network_error -> "Connection lost"; anything else -> humanized label.
    // ttlMs auto-clears the fake data (default 5min) so forgetting to call
    // clearFake() doesn't leave a static test row sitting there forever,
    // which looks exactly like the bar has frozen and stopped tracking.
    injectFake: function (list, ttlMs) {
      fakeSessions = Array.isArray(list) ? list : [];
      clearTimeout(fakeExpireTimer);
      var ttl = typeof ttlMs === "number" ? ttlMs : 300000;
      if (ttl > 0) fakeExpireTimer = setTimeout(function () { fakeSessions = []; tick(); }, ttl);
      tick();
    },
    clearFake: function () { clearTimeout(fakeExpireTimer); fakeSessions = []; tick(); },
  };

  start();
  console.log("[hotbar] running. window.__claudeHotbar.destroy() to remove.");
})();
