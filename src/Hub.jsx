// ORDANIS command hub (/hub), Phase 1.
//
// A voice console for ORDANIS administrators. Push-to-talk (or type) -> the words land in an
// editable box -> Send -> the hub-command edge function answers using read-only platform
// tools -> the answer is shown and, if voice replies are on, read aloud.
//
// SECURITY
// - Its own Supabase session (separate storage key), so signing out of the hub does not
//   touch the portal session and vice versa.
// - Admin role and MFA (TOTP, aal2) are required. The page checks both for a clean UI, and
//   the edge function checks both again on every command; the page is not the gate.
// - Voice is never authentication. It only fills the text box you then send.
// - Locks (signs out) after 15 minutes without activity.
// - Browser speech recognition: in Chrome, audio is processed by Google's servers. The page
//   says so next to the microphone. Typing works everywhere.

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const sb = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storageKey: "ordanis-hub-auth", persistSession: true } })
  : null;

const ENVIRONMENT = SUPABASE_URL.includes("tkryueqzvgcigvxgjzsp") ? "DEMO"
  : SUPABASE_URL.includes("xreeruxuwtmjhvvxvjts") ? "PRODUCTION" : "LOCAL";

const IDLE_LOCK_MS = 15 * 60 * 1000;

const C = {
  navy: "#0A2540", deep: "#041220", ink: "#020a14", gold: "#C9A961", goldSoft: "rgba(201,169,97,0.55)",
  goldFaint: "rgba(201,169,97,0.14)", paper: "#F8F6F1", mute: "rgba(248,246,241,0.62)", line: "rgba(201,169,97,0.22)",
  red: "#e5786d", green: "#7fc8a0",
};
const HEAD = "Georgia, 'Times New Roman', serif";
const BODY = "Arial, Helvetica, sans-serif";

const MODULES = [
  { key: "platform", label: "Platform", note: "Read-only lookups", live: true },
  { key: "demo", label: "Demo", note: "Phase 2", live: false },
  { key: "email", label: "Email portal", note: "Phase 2 · drafts only", live: false },
  { key: "backup", label: "Backup server", note: "Phase 3", live: false },
];

const SUGGESTIONS = [
  "How many active households are on each plan?",
  "What obligations are due in the next two weeks?",
  "Are there any pending plan change requests?",
  "Who signed up in the last 30 days?",
];

const SpeechRec = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ── Shared styles ───────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
@keyframes hubSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
@keyframes hubSpinRev { from { transform: rotate(360deg) } to { transform: rotate(0deg) } }
@keyframes hubPulse { 0%,100% { transform: scale(1); opacity: .9 } 50% { transform: scale(1.08); opacity: 1 } }
@keyframes hubBreath { 0%,100% { opacity: .55 } 50% { opacity: .85 } }
@keyframes hubScan { from { transform: translateY(-100%) } to { transform: translateY(100vh) } }
@keyframes hubBlink { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
.hub-ring { transform-origin: 50% 50%; transform-box: fill-box; }
.hub-btn:focus-visible, .hub-input:focus-visible { outline: 2px solid ${C.gold}; outline-offset: 2px; }
.hub-input::placeholder { color: rgba(248,246,241,0.35); }
@media (prefers-reduced-motion: reduce) { .hub-ring, .hub-orb, .hub-scan { animation: none !important; } }
@media (max-width: 900px) {
  .hub-grid { grid-template-columns: 1fr !important; }
  .hub-side { order: 3; }
}
`;

const panel = {
  background: "linear-gradient(180deg, rgba(10,37,64,0.55), rgba(4,18,32,0.55))",
  border: `1px solid ${C.line}`, borderRadius: 14, padding: 16,
  boxShadow: "inset 0 0 24px rgba(201,169,97,0.04)",
};
const hudLabel = { fontFamily: BODY, fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: C.goldSoft };

function Shell({ children }) {
  return (
    <div style={{
      minHeight: "100vh", background: `radial-gradient(ellipse at 50% 35%, ${C.navy} 0%, ${C.deep} 55%, ${C.ink} 100%)`,
      color: C.paper, fontFamily: BODY, position: "relative", overflowX: "hidden",
    }}>
      <style>{GLOBAL_CSS}</style>
      {/* faint HUD grid */}
      <div aria-hidden style={{
        position: "fixed", inset: 0, pointerEvents: "none", opacity: 0.5,
        backgroundImage: `linear-gradient(${C.goldFaint} 1px, transparent 1px), linear-gradient(90deg, ${C.goldFaint} 1px, transparent 1px)`,
        backgroundSize: "56px 56px", maskImage: "radial-gradient(ellipse at center, black 20%, transparent 75%)",
        WebkitMaskImage: "radial-gradient(ellipse at center, black 20%, transparent 75%)",
      }} />
      <div aria-hidden className="hub-scan" style={{
        position: "fixed", left: 0, right: 0, top: 0, height: 120, pointerEvents: "none",
        background: "linear-gradient(180deg, transparent, rgba(201,169,97,0.05), transparent)",
        animation: "hubScan 9s linear infinite",
      }} />
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
}

function Wordmark({ size = 22 }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
      <span style={{ fontFamily: HEAD, fontSize: size, letterSpacing: "0.32em", color: C.gold }}>ORDANIS</span>
      <span style={{ ...hudLabel, color: C.mute }}>Command</span>
    </div>
  );
}

function GoldButton({ children, onClick, disabled, kind = "solid", type = "button", style, ...rest }) {
  const solid = kind === "solid";
  return (
    <button type={type} className="hub-btn" onClick={onClick} disabled={disabled} {...rest} style={{
      fontFamily: BODY, fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", padding: "10px 18px",
      borderRadius: 999, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
      background: solid ? C.gold : "transparent", color: solid ? C.navy : C.gold,
      border: `1px solid ${C.gold}`, ...style,
    }}>{children}</button>
  );
}

const inputStyle = {
  width: "100%", boxSizing: "border-box", background: "rgba(2,10,20,0.6)", color: C.paper,
  border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", fontFamily: BODY, fontSize: 15,
};

// ── The core: concentric gold rings that react to state ────────────────────────────

function Core({ state, level }) {
  // state: idle | listening | thinking | speaking | error
  const speed = state === "thinking" ? 0.25 : state === "listening" ? 0.6 : state === "speaking" ? 0.8 : 1;
  const glow = state === "idle" ? 0.35 : state === "error" ? 0.3 : 0.75;
  const orbScale = state === "listening" ? 1 + Math.min(level, 1) * 0.25 : 1;
  const ringColor = state === "error" ? C.red : C.gold;
  const label = { idle: "Standing by", listening: "Listening", thinking: "Working", speaking: "Speaking", error: "Attention" }[state];
  return (
    <div style={{ position: "relative", width: "min(62vw, 340px)", aspectRatio: "1 / 1", margin: "0 auto" }}>
      <svg viewBox="0 0 400 400" width="100%" height="100%" role="img" aria-label={`ORDANIS core: ${label}`}
        style={{ filter: `drop-shadow(0 0 ${18 * glow}px rgba(201,169,97,${glow}))` }}>
        <defs>
          <radialGradient id="hubOrb" cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor="#fff6dc" />
            <stop offset="35%" stopColor={ringColor} />
            <stop offset="100%" stopColor="rgba(10,37,64,0)" />
          </radialGradient>
        </defs>
        {/* outer tick ring */}
        <g className="hub-ring" style={{ animation: `hubSpin ${60 * speed}s linear infinite` }}>
          {Array.from({ length: 72 }).map((_, i) => (
            <line key={i} x1="200" y1="8" x2="200" y2={i % 6 === 0 ? 24 : 16} stroke={ringColor}
              strokeOpacity={i % 6 === 0 ? 0.9 : 0.4} strokeWidth={i % 6 === 0 ? 2 : 1} transform={`rotate(${i * 5} 200 200)`} />
          ))}
        </g>
        <g className="hub-ring" style={{ animation: `hubSpinRev ${28 * speed}s linear infinite` }}>
          <circle cx="200" cy="200" r="160" fill="none" stroke={ringColor} strokeOpacity="0.55" strokeWidth="2"
            strokeDasharray="120 40 20 40" />
        </g>
        <g className="hub-ring" style={{ animation: `hubSpin ${16 * speed}s linear infinite` }}>
          <circle cx="200" cy="200" r="132" fill="none" stroke={ringColor} strokeOpacity="0.8" strokeWidth="5"
            strokeDasharray="60 210" strokeLinecap="round" />
          <circle cx="200" cy="200" r="132" fill="none" stroke={ringColor} strokeOpacity="0.25" strokeWidth="1" />
        </g>
        <g className="hub-ring" style={{ animation: `hubSpinRev ${10 * speed}s linear infinite` }}>
          <circle cx="200" cy="200" r="104" fill="none" stroke={ringColor} strokeOpacity="0.6" strokeWidth="1.5"
            strokeDasharray="4 8" />
        </g>
        <circle cx="200" cy="200" r="84" fill="rgba(4,18,32,0.85)" stroke={ringColor} strokeOpacity="0.5" />
        <g className="hub-orb" style={{
          transformOrigin: "200px 200px", transform: `scale(${orbScale})`, transition: "transform 80ms linear",
          animation: state === "speaking" ? "hubPulse 0.9s ease-in-out infinite"
            : state === "idle" ? "hubBreath 4s ease-in-out infinite" : "none",
        }}>
          <circle cx="200" cy="200" r="62" fill="url(#hubOrb)" opacity="0.9" />
        </g>
        <text x="200" y="206" textAnchor="middle" fontFamily={HEAD} fontSize="18" letterSpacing="5" fill={C.navy}>O</text>
      </svg>
      <div style={{ ...hudLabel, textAlign: "center", marginTop: 6, color: state === "error" ? C.red : C.gold }}>
        {state === "listening" && <span style={{ animation: "hubBlink 1s infinite" }}>● </span>}{label}
      </div>
    </div>
  );
}

// ── Gate screens: sign in, verify MFA, enroll MFA ─────────────────────────────────

function GateCard({ title, children }) {
  return (
    <Shell>
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
        <div style={{ ...panel, width: "100%", maxWidth: 420, padding: 28 }}>
          <Wordmark />
          <h1 style={{ fontFamily: HEAD, fontWeight: 400, fontSize: 22, margin: "22px 0 6px", color: C.paper }}>{title}</h1>
          {children}
          <div style={{ ...hudLabel, marginTop: 22, color: C.mute }}>Environment · {ENVIRONMENT}</div>
        </div>
      </div>
    </Shell>
  );
}

function SignIn({ onDone }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) { setErr("That email and password didn't match. Please try again."); return; }
    onDone();
  };
  return (
    <GateCard title="Administrator sign-in">
      <p style={{ color: C.mute, fontSize: 14, lineHeight: 1.5, marginTop: 0 }}>
        The command hub is for ORDANIS administrators. You'll confirm with your authenticator app next.
      </p>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label style={hudLabel}>Email
          <input className="hub-input" style={{ ...inputStyle, marginTop: 6 }} type="email" autoComplete="username"
            value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label style={hudLabel}>Password
          <input className="hub-input" style={{ ...inputStyle, marginTop: 6 }} type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {err && <div role="alert" style={{ color: C.red, fontSize: 13 }}>{err}</div>}
        <GoldButton type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</GoldButton>
      </form>
    </GateCard>
  );
}

function CodeForm({ onSubmit, busy, err, cta }) {
  const [code, setCode] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(code.replace(/\s/g, "")); }} style={{ display: "grid", gap: 12 }}>
      <label style={hudLabel}>6-digit code
        <input className="hub-input" style={{ ...inputStyle, marginTop: 6, fontSize: 22, letterSpacing: "0.4em", textAlign: "center" }}
          inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ""))} autoFocus required />
      </label>
      {err && <div role="alert" style={{ color: C.red, fontSize: 13 }}>{err}</div>}
      <GoldButton type="submit" disabled={busy || code.replace(/\s/g, "").length < 6}>{busy ? "Checking…" : cta}</GoldButton>
    </form>
  );
}

function MfaVerify({ factorId, onDone, onSignOut }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (code) => {
    setBusy(true); setErr("");
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (error) { setErr("That code didn't work. Codes change every 30 seconds, so try the newest one."); return; }
    onDone();
  };
  return (
    <GateCard title="Confirm it's you">
      <p style={{ color: C.mute, fontSize: 14, lineHeight: 1.5, marginTop: 0 }}>Enter the code from your authenticator app.</p>
      <CodeForm onSubmit={submit} busy={busy} err={err} cta="Verify" />
      <button className="hub-btn" onClick={onSignOut} style={{ marginTop: 14, background: "none", border: 0, color: C.mute, cursor: "pointer", fontSize: 13, textDecoration: "underline" }}>Sign out</button>
    </GateCard>
  );
}

function MfaEnroll({ onDone, onSignOut }) {
  const [factor, setFactor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      // Clear any half-finished (unverified) hub factor from an earlier attempt first.
      const { data: list } = await sb.auth.mfa.listFactors();
      for (const f of list?.all ?? []) {
        if (f.factor_type === "totp" && f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `ORDANIS hub ${new Date().toISOString().slice(0, 10)}` });
      if (error) { setErr("Couldn't start authenticator setup. MFA may need to be switched on for this project."); return; }
      setFactor(data);
    })();
  }, []);
  const submit = async (code) => {
    setBusy(true); setErr("");
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    setBusy(false);
    if (error) { setErr("That code didn't work. Try the newest code from the app."); return; }
    onDone();
  };
  return (
    <GateCard title="Set up your authenticator">
      <p style={{ color: C.mute, fontSize: 14, lineHeight: 1.5, marginTop: 0 }}>
        The hub needs a second step at sign-in. Scan this with an authenticator app (1Password, Google Authenticator, Authy), then enter the code it shows.
      </p>
      {factor ? (
        <>
          <div style={{ background: C.paper, borderRadius: 12, padding: 12, width: 196, margin: "8px auto 10px" }}>
            <img src={factor.totp.qr_code} alt="Authenticator QR code" width={172} height={172} style={{ display: "block" }} />
          </div>
          <details style={{ color: C.mute, fontSize: 12, marginBottom: 12 }}>
            <summary style={{ cursor: "pointer" }}>Can't scan? Enter the key by hand</summary>
            <code style={{ display: "block", wordBreak: "break-all", marginTop: 6, color: C.gold }}>{factor.totp.secret}</code>
          </details>
          <CodeForm onSubmit={submit} busy={busy} err={err} cta="Turn on and continue" />
        </>
      ) : (
        <div style={{ color: err ? C.red : C.mute, fontSize: 14 }}>{err || "Preparing…"}</div>
      )}
      <button className="hub-btn" onClick={onSignOut} style={{ marginTop: 14, background: "none", border: 0, color: C.mute, cursor: "pointer", fontSize: 13, textDecoration: "underline" }}>Sign out</button>
    </GateCard>
  );
}

// ── The console ────────────────────────────────────────────────────────────────

function Console({ user, onSignOut }) {
  const [text, setText] = useState("");
  const [inputMode, setInputMode] = useState("typed");
  const [coreState, setCoreState] = useState("idle");
  const [level, setLevel] = useState(0);
  const [answer, setAnswer] = useState("Good to see you. Hold the microphone, or the space bar, and ask me about the platform.");
  const [log, setLog] = useState([]); // {at, command, answer, tools, requestId, error}
  const [voiceOn, setVoiceOn] = useState(() => store.get("hub.voiceReplies", true));
  const [busy, setBusy] = useState(false);
  const [micErr, setMicErr] = useState("");
  const recRef = useRef(null);
  const holdingRef = useRef(false);
  const finalRef = useRef("");
  const audioRef = useRef(null);
  const textRef = useRef(null);
  const historyRef = useRef([]);

  useEffect(() => { store.set("hub.voiceReplies", voiceOn); if (!voiceOn && canSpeak) window.speechSynthesis.cancel(); }, [voiceOn]);

  // Mic level for the core while listening (local only; the audio never leaves this tab).
  const startLevel = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser(); an.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      let raf = 0;
      const tick = () => { an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += Math.abs(v - 128); setLevel(s / buf.length / 24); raf = requestAnimationFrame(tick); };
      tick();
      audioRef.current = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close(); setLevel(0); };
    } catch { /* level meter is decoration; speech recognition reports real mic errors */ }
  };
  const stopLevel = () => { if (audioRef.current) { audioRef.current(); audioRef.current = null; } };

  const startListening = useCallback(() => {
    if (!SpeechRec || holdingRef.current || busy) return;
    if (canSpeak) window.speechSynthesis.cancel();
    holdingRef.current = true;
    setMicErr("");
    finalRef.current = "";
    const rec = new SpeechRec();
    rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true;
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript; else interim += r[0].transcript;
      }
      setText((finalRef.current + interim).trimStart());
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") setMicErr("Microphone access is blocked. Allow it in the browser, or type instead.");
      else if (ev.error !== "no-speech" && ev.error !== "aborted") setMicErr("I couldn't hear that clearly. Try again or type it.");
    };
    rec.onend = () => { setCoreState((s) => (s === "listening" ? "idle" : s)); stopLevel(); };
    recRef.current = rec;
    try { rec.start(); setCoreState("listening"); setInputMode("voice"); startLevel(); } catch { holdingRef.current = false; }
  }, [busy]);

  const stopListening = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    setTimeout(() => textRef.current?.focus(), 50);
  }, []);

  // Space bar push-to-talk when focus isn't in a text field.
  useEffect(() => {
    const typing = (el) => el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);
    const down = (e) => { if (e.code === "Space" && !e.repeat && !typing(document.activeElement)) { e.preventDefault(); startListening(); } };
    const up = (e) => { if (e.code === "Space" && holdingRef.current) { e.preventDefault(); stopListening(); } };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [startListening, stopListening]);

  const speak = (s) => {
    if (!voiceOn || !canSpeak || !s) { setCoreState("idle"); return; }
    const u = new window.SpeechSynthesisUtterance(s.replace(/[*#_`]/g, ""));
    const voices = window.speechSynthesis.getVoices();
    u.voice = voices.find((v) => /Daniel|Google UK English Male|Arthur/i.test(v.name))
      || voices.find((v) => v.lang === "en-GB") || voices.find((v) => v.lang?.startsWith("en")) || null;
    u.rate = 1.02; u.pitch = 0.95;
    u.onstart = () => setCoreState("speaking");
    u.onend = u.onerror = () => setCoreState("idle");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };

  const send = async (override) => {
    const command = (override ?? text).trim();
    if (!command || busy) return;
    const mode = override ? "typed" : inputMode;
    setBusy(true); setCoreState("thinking"); setAnswer("");
    let out;
    try {
      const { data, error } = await sb.functions.invoke("hub-command", {
        body: { command, inputMode: mode, module: "platform", history: historyRef.current.slice(-6) },
      });
      if (error) {
        let body = {};
        try { body = await error.context.json(); } catch { /* non-JSON error */ }
        out = { error: body.error || "I couldn't reach the hub just now.", requestId: body.request_id, mfa: body.mfa_required };
      } else out = { answer: data.answer, tools: data.tools || [], requestId: data.request_id };
    } catch {
      out = { error: "I couldn't reach the hub just now." };
    }
    setBusy(false);
    setLog((l) => [{ at: new Date(), command, ...out }, ...l].slice(0, 30));
    if (out.mfa) { onSignOut(); return; }
    if (out.error) { setAnswer(out.error); setCoreState("error"); setTimeout(() => setCoreState("idle"), 2500); return; }
    historyRef.current = [...historyRef.current, { role: "user", content: command }, { role: "assistant", content: out.answer }].slice(-6);
    setAnswer(out.answer);
    setText(""); setInputMode("typed");
    speak(out.answer);
  };

  return (
    <Shell>
      <header style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: `1px solid ${C.line}` }}>
        <Wordmark />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span style={{ ...hudLabel, padding: "5px 10px", borderRadius: 999, border: `1px solid ${ENVIRONMENT === "PRODUCTION" ? C.red : C.gold}`, color: ENVIRONMENT === "PRODUCTION" ? C.red : C.gold }}>{ENVIRONMENT}</span>
          <span style={{ ...hudLabel, color: C.green }}>● MFA verified</span>
          <span style={{ fontSize: 12, color: C.mute }}>{user.email}</span>
          <GoldButton kind="ghost" onClick={onSignOut} style={{ padding: "6px 14px", fontSize: 11 }}>Lock</GoldButton>
        </div>
      </header>

      <main className="hub-grid" style={{ display: "grid", gridTemplateColumns: "240px minmax(0,1fr) 300px", gap: 20, padding: "20px 24px 32px", maxWidth: 1400, margin: "0 auto" }}>
        <aside className="hub-side" style={{ ...panel, alignSelf: "start" }}>
          <div style={hudLabel}>Modules</div>
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 8 }}>
            {MODULES.map((m) => (
              <li key={m.key} style={{
                padding: "10px 12px", borderRadius: 10, border: `1px solid ${m.live ? C.gold : C.line}`,
                background: m.live ? "rgba(201,169,97,0.08)" : "transparent", opacity: m.live ? 1 : 0.55,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: HEAD, fontSize: 15 }}>{m.label}</span>
                  <span style={{ fontSize: 10, color: m.live ? C.green : C.mute }}>{m.live ? "● ONLINE" : "LOCKED"}</span>
                </div>
                <div style={{ fontSize: 11, color: C.mute, marginTop: 3 }}>{m.note}</div>
              </li>
            ))}
          </ul>
          <div style={{ ...hudLabel, marginTop: 20 }}>Try asking</div>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="hub-btn" disabled={busy} onClick={() => send(s)} style={{
                textAlign: "left", background: "none", border: `1px dashed ${C.line}`, borderRadius: 8, color: C.paper,
                fontSize: 12, padding: "8px 10px", cursor: "pointer", fontFamily: BODY, lineHeight: 1.35,
              }}>{s}</button>
            ))}
          </div>
        </aside>

        <section style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, minWidth: 0 }}>
          <Core state={coreState} level={level} />
          <div aria-live="polite" style={{ ...panel, width: "100%", maxWidth: 680, minHeight: 84, boxSizing: "border-box" }}>
            <div style={hudLabel}>Response</div>
            <p style={{ fontFamily: HEAD, fontSize: 18, lineHeight: 1.55, margin: "8px 0 0", whiteSpace: "pre-wrap" }}>
              {busy ? <span style={{ color: C.mute }}>Looking that up…</span> : answer}
            </p>
          </div>

          <div style={{ ...panel, width: "100%", maxWidth: 680, boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={hudLabel}>Command {inputMode === "voice" && text ? "· heard — edit if needed" : ""}</span>
              <label style={{ fontSize: 12, color: C.mute, display: "flex", gap: 6, alignItems: "center", cursor: canSpeak ? "pointer" : "default" }}>
                <input type="checkbox" checked={voiceOn && canSpeak} disabled={!canSpeak} onChange={(e) => setVoiceOn(e.target.checked)} />
                Read replies aloud
              </label>
            </div>
            <textarea ref={textRef} className="hub-input" rows={2} value={text} placeholder="Ask about households, obligations, tasks, plan changes…"
              onChange={(e) => { setText(e.target.value); if (!e.target.value) setInputMode("typed"); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              style={{ ...inputStyle, marginTop: 10, resize: "vertical", minHeight: 56 }} maxLength={1000} />
            <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
              {SpeechRec ? (
                <button className="hub-btn" aria-label="Hold to talk" disabled={busy}
                  onPointerDown={(e) => { e.preventDefault(); startListening(); }}
                  onPointerUp={stopListening} onPointerLeave={stopListening} onPointerCancel={stopListening}
                  onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); startListening(); } }}
                  onKeyUp={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); stopListening(); } }}
                  style={{
                    width: 64, height: 64, borderRadius: "50%", cursor: "pointer", touchAction: "none",
                    border: `2px solid ${C.gold}`, color: coreState === "listening" ? C.navy : C.gold,
                    background: coreState === "listening" ? C.gold : "rgba(201,169,97,0.08)",
                    boxShadow: coreState === "listening" ? `0 0 24px ${C.gold}` : "none", transition: "all 120ms",
                  }}>
                  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </svg>
                </button>
              ) : null}
              <div style={{ flex: 1, minWidth: 160, fontSize: 12, color: C.mute, lineHeight: 1.45 }}>
                {SpeechRec
                  ? <>Hold to talk (or hold the space bar), release, check the words, then send. In Chrome, speech is processed by Google.</>
                  : <>Voice isn't available in this browser. Type your command instead.</>}
                {micErr && <div role="alert" style={{ color: C.red, marginTop: 4 }}>{micErr}</div>}
              </div>
              <GoldButton onClick={() => send()} disabled={busy || !text.trim()}>{busy ? "Working…" : "Send"}</GoldButton>
            </div>
          </div>
        </section>

        <aside className="hub-side" style={{ ...panel, alignSelf: "start", maxHeight: "calc(100vh - 140px)", overflowY: "auto" }}>
          <div style={hudLabel}>Activity · this session</div>
          <div style={{ fontSize: 11, color: C.mute, marginTop: 6 }}>Every command is recorded in the audit log.</div>
          {log.length === 0 && <div style={{ fontSize: 13, color: C.mute, marginTop: 14 }}>Nothing yet.</div>}
          <ol style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 10 }}>
            {log.map((r, i) => (
              <li key={i} style={{ borderLeft: `2px solid ${r.error ? C.red : C.gold}`, paddingLeft: 10 }}>
                <div style={{ fontSize: 10, color: C.mute }}>{r.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</div>
                <div style={{ fontSize: 13, marginTop: 2 }}>{r.command}</div>
                {r.tools?.length > 0 && (
                  <div style={{ fontSize: 10, color: C.goldSoft, marginTop: 4, letterSpacing: "0.06em" }}>
                    {r.tools.map((t) => `${t.name}${t.ok ? ` · ${t.rows}` : " · failed"}`).join("  /  ")}
                  </div>
                )}
                {r.error && <div style={{ fontSize: 12, color: C.red, marginTop: 4 }}>{r.error}</div>}
                {r.requestId && <div style={{ fontSize: 9, color: "rgba(248,246,241,0.35)", marginTop: 3 }}>ref {r.requestId.slice(0, 8)}</div>}
              </li>
            ))}
          </ol>
        </aside>
      </main>
    </Shell>
  );
}

// ── Root: decide which screen to show ─────────────────────────────────────────────

export default function Hub() {
  const [phase, setPhase] = useState("loading"); // loading | signin | denied | enroll | verify | ready | unconfigured
  const [user, setUser] = useState(null);
  const [factorId, setFactorId] = useState(null);

  const evaluate = useCallback(async () => {
    if (!sb) { setPhase("unconfigured"); return; }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { setPhase("signin"); return; }
    const u = session.user;
    setUser(u);
    const { data: prof } = await sb.from("user_profiles").select("role,active").eq("id", u.id).maybeSingle();
    if (prof?.role !== "admin" || prof?.active === false) { setPhase("denied"); return; }
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal2") { setPhase("ready"); return; }
    const { data: factors } = await sb.auth.mfa.listFactors();
    const totp = (factors?.totp ?? []).find((f) => f.status === "verified");
    if (totp) { setFactorId(totp.id); setPhase("verify"); } else setPhase("enroll");
  }, []);

  const signOut = useCallback(async () => {
    if (canSpeak) window.speechSynthesis.cancel();
    if (sb) await sb.auth.signOut({ scope: "local" });
    setUser(null); setPhase("signin");
  }, []);

  useEffect(() => { evaluate(); }, [evaluate]);

  // Idle lock.
  useEffect(() => {
    if (phase !== "ready") return;
    let timer = setTimeout(signOut, IDLE_LOCK_MS);
    const bump = () => { clearTimeout(timer); timer = setTimeout(signOut, IDLE_LOCK_MS); };
    const evs = ["pointerdown", "keydown", "wheel", "touchstart"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => { clearTimeout(timer); evs.forEach((e) => window.removeEventListener(e, bump)); };
  }, [phase, signOut]);

  useEffect(() => { document.title = "ORDANIS Command"; }, []);

  // Local design preview of the console (dev server only; stripped from production builds).
  // It has no session, so any command it sends is refused by hub-command.
  if (import.meta.env.DEV && window.location.search.includes("preview=console")) {
    return <Console user={{ email: "preview@localhost" }} onSignOut={() => window.location.assign("/hub")} />;
  }
  if (phase === "loading") return <Shell><div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><Core state="thinking" level={0} /></div></Shell>;
  if (phase === "unconfigured") return <GateCard title="Not configured"><p style={{ color: C.mute }}>This build has no Supabase connection set.</p></GateCard>;
  if (phase === "signin") return <SignIn onDone={evaluate} />;
  if (phase === "denied") return (
    <GateCard title="Administrators only">
      <p style={{ color: C.mute, fontSize: 14, lineHeight: 1.5 }}>This account can't use the command hub. Your portal is still at the main address.</p>
      <GoldButton kind="ghost" onClick={signOut}>Sign out</GoldButton>
    </GateCard>
  );
  if (phase === "enroll") return <MfaEnroll onDone={evaluate} onSignOut={signOut} />;
  if (phase === "verify") return <MfaVerify factorId={factorId} onDone={evaluate} onSignOut={signOut} />;
  return <Console user={user} onSignOut={signOut} />;
}
