// ORDANIS Hub launcher.
//
// This page is a public shell. The app links, Guides and Team & Access come from the
// hub-content server function, which returns them only to a signed-in ORDANIS administrator.
// No MFA here: each app the hub opens asks for its own sign-in and MFA. The server is the gate.

(function () {
  "use strict";

  // Production on the real hub addresses; Demo everywhere else (local testing).
  const PROD_HOSTS = ["hub.ordanisos.com", "ordanis-hub.vercel.app"];
  const ENV = PROD_HOSTS.includes(location.hostname)
    ? {
        url: "https://xreeruxuwtmjhvvxvjts.supabase.co",
        key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZWVydXh1d3Rtamh2dnh2anRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3OTU0NjcsImV4cCI6MjEwNDM3MTQ2N30.dtijICgtiQVrPyliovzcLzAG5iiTNmzXcdq9KkWWMGk",
      }
    : {
        url: "https://tkryueqzvgcigvxgjzsp.supabase.co",
        key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrcnl1ZXF6dmdjaWd2eGdqenNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNTc2MDEsImV4cCI6MjEwMDczMzYwMX0.6TtCgz2cUbgYFj0sK7fuFrk6QA4HMr4ukFJZGdMisnE",
      };

  const sb = window.supabase.createClient(ENV.url, ENV.key, {
    auth: { storageKey: "ordanis-hub-launcher-auth", persistSession: true },
  });

  const ICONS = {
    home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    chart: '<path d="M4 20h16"/><path d="M7 16v-5"/><path d="M12 16V6"/><path d="M17 16v-8"/>',
    server: '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><path d="M8 7h.01M8 17h.01"/>',
    flask: '<path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>',
  };

  const $ = (id) => document.getElementById(id);
  const card = $("card");

  function el(tag, attrs, text) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  }

  function showCard(title, intro, ...children) {
    card.replaceChildren(el("h2", {}, title));
    if (intro) card.appendChild(el("p", {}, intro));
    children.forEach((c) => card.appendChild(c));
    $("gate").hidden = false;
    $("app").hidden = true;
    $("tabs").hidden = true;
    $("user").hidden = true;
  }

  function errorLine() {
    const e = el("div", { class: "err", role: "alert" });
    e.hidden = true;
    return e;
  }
  function setError(node, msg) { node.textContent = msg; node.hidden = !msg; }

  function signOutLink() {
    const b = el("button", { type: "button", class: "link" }, "Sign out");
    b.addEventListener("click", signOut);
    return b;
  }

  // ── Screens ────────────────────────────────────────────────────────────────

  function signInScreen() {
    const form = el("form");
    const emailIn = el("input", { type: "email", autocomplete: "username", required: "" });
    const pwIn = el("input", { type: "password", autocomplete: "current-password", required: "" });
    const err = errorLine();
    const btn = el("button", { type: "submit", class: "btn" }, "Sign in");
    const l1 = el("label", {}, "Email"); l1.appendChild(emailIn);
    const l2 = el("label", {}, "Password"); l2.appendChild(pwIn);
    form.append(l1, l2, err, btn);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      btn.disabled = true; btn.textContent = "Signing in…"; setError(err, "");
      const { error } = await sb.auth.signInWithPassword({ email: emailIn.value.trim(), password: pwIn.value });
      btn.disabled = false; btn.textContent = "Sign in";
      if (error) { setError(err, "That email and password didn't match. Please try again."); return; }
      evaluate();
    });
    showCard("Team sign-in", "Use your ORDANIS Platform account.", form);
    emailIn.focus();
  }

  function deniedScreen(msg) {
    showCard("No access", msg || "The ORDANIS Hub is for the ORDANIS team only. If you should have access, ask Will.", signOutLink());
  }

  // ── The hub itself ─────────────────────────────────────────────────────────

  function renderHub(content) {
    const first = content.firstName || "";
    const hour = new Date().getHours();
    const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    $("greeting").textContent = first ? part + ", " + first : part;
    $("avatar").textContent = (first[0] || "•").toUpperCase();
    $("user-name").textContent = content.fullName || "";

    const stage = $("stage");
    const beams = $("beams");
    stage.querySelectorAll(".node").forEach((n) => n.remove());
    beams.querySelectorAll("line").forEach((n) => n.remove());

    const apps = Array.isArray(content.apps) ? content.apps : [];
    const NS = "http://www.w3.org/2000/svg";
    const R = 34;
    const pts = apps.map((_, i) => {
      const a = (-90 + (360 / apps.length) * i) * Math.PI / 180;
      return { x: 50 + R * Math.cos(a), y: 50 + R * Math.sin(a) };
    });
    const line = (a, b, cls) => {
      const l = document.createElementNS(NS, "line");
      l.setAttribute("x1", a.x); l.setAttribute("y1", a.y);
      l.setAttribute("x2", b.x); l.setAttribute("y2", b.y);
      l.setAttribute("class", cls);
      beams.appendChild(l);
      return l;
    };
    // Beams run as a relay, all on one cycle: a gold dash travels the outer ring from one app to the
    // next; when it enters that app the app glows, and a dash leaves it for the middle; when that dash
    // reaches the middle, the middle glows. Positions are in the 0-100 viewBox.
    const NODE_R = 14;   // half an app's width (28% of the stage)
    const CORE_R = 15;   // half the middle's width (30% of the stage)
    const PERIOD = 4800; // one full cycle; the six relays are spread evenly across it
    const SPEED = 0.009; // viewBox units per millisecond
    const nodeGlows = apps.map(() => []);
    const coreGlows = [];
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Run one dash from a to b, starting with its head at `from` units along the line, beginning at
    // `start` ms into the cycle. Returns when (ms into the cycle) the head reaches `to` units along.
    const beam = (a, b, cls, dash, start, from, to) => {
      const l = line(a, b, cls);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      l.style.strokeDasharray = dash + " " + (len + dash);
      l.style.strokeDashoffset = String(dash - from);
      if (still) return 0;
      const run = (dash - from + len) / SPEED; // until the tail has left the line
      l.animate([
        { strokeDashoffset: dash - from, offset: 0 },
        { strokeDashoffset: -len, offset: Math.min(1, run / PERIOD) },
        { strokeDashoffset: -len, offset: 1 },
      ], { duration: PERIOD, delay: start, iterations: Infinity });
      return start + (to - from) / SPEED;
    };
    const center = { x: 50, y: 50 };
    pts.forEach((p, i) => {
      const n = (i + 1) % pts.length;
      line(p, pts[n], "rail");
      line(center, pts[n], "rail");
      const ringLen = Math.hypot(pts[n].x - p.x, pts[n].y - p.y);
      const reached = beam(p, pts[n], "pulse", 9, (i * PERIOD) / pts.length, NODE_R, ringLen - NODE_R);
      nodeGlows[n].push(reached);
      const spokeLen = Math.hypot(pts[n].x - center.x, pts[n].y - center.y);
      coreGlows.push(beam(pts[n], center, "pulse spoke", 4, reached, NODE_R, spokeLen - CORE_R));
    });
    // Soft glow: up fast, then fade over about a second, once per cycle.
    const glow = (target, at) => {
      if (still) return;
      const g = el("span", { class: "ping", "aria-hidden": "true" });
      target.prepend(g);
      g.animate([
        { opacity: 0, easing: "ease-out" },
        { opacity: 1, offset: 150 / PERIOD, easing: "ease-in-out" },
        { opacity: 0, offset: 1200 / PERIOD },
        { opacity: 0 },
      ], { duration: PERIOD, delay: at, iterations: Infinity });
    };
    const core = stage.querySelector(".core");
    core.querySelectorAll(".ping").forEach((g) => g.remove());
    coreGlows.forEach((at) => glow(core, at));

    apps.forEach((app, i) => {
      const live = /^https:\/\//.test(app.url || "");
      const node = document.createElement(live ? "a" : "div");
      node.className = "node " + (live ? "live" : "soon");
      node.style.left = pts[i].x + "%";
      node.style.top = pts[i].y + "%";
      if (live) {
        node.href = app.url;
        node.target = "_blank";
        node.rel = "noopener noreferrer";
        node.setAttribute("aria-label", "Open " + app.name);
      }
      node.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[app.icon] || "") + "</svg>";
      node.append(el("span", { class: "name" }, app.name), el("span", { class: "badge" }, live ? app.role : "COMING SOON"));
      nodeGlows[i].forEach((at) => glow(node, at));
      stage.appendChild(node);
    });

    // Guides and Team & Access come from our own server function, not from users.
    $("private").innerHTML = (content.guides || "") + (content.team || "");
    selectTab("tools");

    $("gate").hidden = true;
    $("app").hidden = false;
    $("tabs").hidden = false;
    $("user").hidden = false;
  }

  function selectTab(name) {
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    ["tools", "guides", "team"].forEach((t) => {
      const sec = $("tab-" + t);
      if (sec) sec.hidden = t !== name;
    });
  }
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => selectTab(b.dataset.tab)));

  // ── Flow ───────────────────────────────────────────────────────────────────

  async function signOut() {
    await sb.auth.signOut({ scope: "local" });
    $("private").replaceChildren();
    signInScreen();
  }
  $("signout").addEventListener("click", signOut);

  async function evaluate() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { signInScreen(); return; }
    showCard("Opening the hub", "One moment…");
    const { data, error } = await sb.functions.invoke("hub-content", { body: {} });
    if (error) {
      let body = null;
      try { body = await error.context.json(); } catch (_) { /* not JSON */ }
      const status = error.context && error.context.status;
      if (status === 401) { await sb.auth.signOut({ scope: "local" }); signInScreen(); return; }
      if (status === 403) { deniedScreen(body && body.error); return; }
      showCard("Couldn't open the hub", (body && body.error) || "Please check your connection and try again.", signOutLink());
      return;
    }
    renderHub(data || {});
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* the hub works without it */ });
  }

  evaluate();
})();
