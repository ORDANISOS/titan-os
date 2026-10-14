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
import { ASSISTANT_NAME, jarvisMarkSvg, downloadJarvisMark } from "./jarvisMark.js";

const MARK_SRC = `data:image/svg+xml;utf8,${encodeURIComponent(jarvisMarkSvg({ size: 96 }))}`;

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
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <img src={MARK_SRC} alt="" width={size + 14} height={size + 14} style={{ borderRadius: 8 }} />
      <span style={{ fontFamily: HEAD, fontSize: size, letterSpacing: "0.32em", color: C.gold }}>{ASSISTANT_NAME.toUpperCase()}</span>
      <span style={{ ...hudLabel, color: C.mute }}>by ORDANIS</span>
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
      <svg viewBox="0 0 400 400" width="100%" height="100%" role="img" aria-label={`${ASSISTANT_NAME}: ${label}`}
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
        {ASSISTANT_NAME} is for ORDANIS administrators. You'll confirm with your authenticator app next.
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
//
// Two ways to talk:
// - Conversation (default where the browser supports speech): tap the core (or press space)
//   and just talk. A short pause sends what you said; the answer is spoken, and the hub
//   listens again for a follow-up. Say "that's all" (or stay quiet for a few seconds) to end.
//   "Never mind" drops what you just said. Tap the core while it's talking to cut in.
// - Push to talk: hold the mic (or the space bar), release, check the words, press Send.
// Conversation mode sends without a review step. That's acceptable while every tool is
// read-only; any future write action gets a spoken read-back and an explicit "yes" first.

const ACKS = ["Let me check.", "One moment.", "Looking now.", "Give me a second.", "On it.", "Checking."];
const HELLOS = ["What do you need?", "What can I look up?", "Go ahead, I'm listening.", "I'm here. What's up?"];
// "Jarvis, how many…" / "…thanks, Jarvis": the name is a form of address, not part of the command.
const stripName = (s) => s.replace(new RegExp(`^(hey|ok(ay)?|hi)?[,\\s]*${ASSISTANT_NAME}[,.!?\\s]*|[,\\s]+${ASSISTANT_NAME}[.!?]*$`, "gi"), "").trim();
const BYES = ["Sounds good. I'll be here.", "Okay. Call me back anytime.", "Got it. I'm here when you need me."];
const END_RE = /^(ok(ay)?[,.]?\s+)?(thanks?( you)?[,.!]?\s*)?(that'?s (all|it|everything)|i'?m (done|good|all set)|we'?re (done|good)|goodbye|bye|stop listening|end (the )?conversation)[.!]?$/i;
const THANKS_ONLY_RE = /^(thanks?( you)?|thank you( so much)?|perfect,? thanks?)[.!]?$/i;
const CANCEL_RE = /^(never ?mind|cancel( that)?|scratch that|forget (it|that))[.!]?$/i;
const SILENCE_MS = 1400;     // pause that ends a spoken command in conversation mode
const NO_SPEECH_MS = 8000;   // quiet this long and the conversation closes

const pick = (a) => a[Math.floor(Math.random() * a.length)];
// Sentence split for captions and natural pacing. Only splits where the next sentence starts,
// so "$4,200.50" or "St. Louis" mid-sentence stay whole.
const ABBREV_END = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|Inc|Co|Ltd|No|Mt)\.$/;
const splitSentences = (s) => String(s || "").split(/(?<=[.!?])\s+(?=["'(A-Z0-9])/).reduce((out, part) => {
  const t = part.trim();
  if (!t) return out;
  if (out.length && ABBREV_END.test(out[out.length - 1])) out[out.length - 1] += ` ${t}`; else out.push(t);
  return out;
}, []);

const timeOfDay = () => { const h = new Date().getHours(); return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"; };

// Best-sounding voices first: neural/online/enhanced voices beat the robotic defaults.
function rankVoices(list) {
  const score = (v) => {
    if (!/^en/i.test(v.lang)) return -1;
    let s = 0;
    if (/natural|neural|online|premium|enhanced/i.test(v.name)) s += 50;
    if (/Daniel|Ryan|Arthur|Oliver|Thomas|Sonia|Libby|Serena|Kate|Aria|Jenny|Guy|Samantha|Google UK English|Google US English/i.test(v.name)) s += 20;
    if (/en[-_]GB/i.test(v.lang)) s += 6;
    if (/albert|bad news|bahh|bells|boing|bubbles|cellos|fred|good news|jester|junior|organ|ralph|superstar|trinoids|whisper|wobble|zarvox|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley/i.test(v.name)) s -= 80;
    return s;
  };
  return list.filter((v) => score(v) >= 0).sort((a, b) => score(b) - score(a));
}

function Console({ user, firstName: initialName, onSignOut }) {
  const [text, setText] = useState("");
  const [heard, setHeard] = useState("");
  const [inputMode, setInputMode] = useState("typed");
  const [coreState, setCoreState] = useState("idle");
  const [level, setLevel] = useState(0);
  const [name, setName] = useState(initialName || "");
  const [lines, setLines] = useState(() => [
    `Good ${timeOfDay()}${initialName ? `, ${initialName}` : ""}.`,
    SpeechRec ? "Tap the core, or press the space bar, and talk to me." : "Type a question below and I'll look it up.",
  ]);
  const [spokenIdx, setSpokenIdx] = useState(-1);
  const [log, setLog] = useState([]); // {at, command, answer, tools, requestId, error}
  const [voiceOn, setVoiceOn] = useState(() => store.get("hub.voiceReplies", true));
  const [mode, setMode] = useState(() => (SpeechRec ? store.get("hub.mode", "conversation") : "push"));
  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState(() => store.get("hub.voice", ""));
  const [convoOpen, setConvoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [micErr, setMicErr] = useState("");
  const [hint, setHint] = useState("");

  const recRef = useRef(null);
  const listeningRef = useRef(false);
  const endingRef = useRef(false);
  const finalRef = useRef("");
  const heardRef = useRef("");
  const silenceTimer = useRef(null);
  const noSpeechTimer = useRef(null);
  const audioRef = useRef(null);
  const textRef = useRef(null);
  const historyRef = useRef([]);
  const speakTokenRef = useRef(0);
  const interruptRef = useRef(0);
  const greetedRef = useRef(false);
  const busyRef = useRef(false);
  const coreRef = useRef("idle");
  const convoRef = useRef(false);
  const modeRef = useRef(mode);
  const voiceOnRef = useRef(voiceOn);
  const nameRef = useRef(name);
  const voiceRef = useRef(null);
  const sendRef = useRef(null);
  const onCoreRef = useRef(null);

  const voice = voices.find((v) => v.name === voiceName) || voices[0] || null;
  useEffect(() => { coreRef.current = coreState; }, [coreState]);
  useEffect(() => { modeRef.current = mode; store.set("hub.mode", mode); }, [mode]);
  useEffect(() => { nameRef.current = name; }, [name]);
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  useEffect(() => {
    voiceOnRef.current = voiceOn; store.set("hub.voiceReplies", voiceOn);
    if (!voiceOn && canSpeak) window.speechSynthesis.cancel();
  }, [voiceOn]);
  useEffect(() => { if (voiceName) store.set("hub.voice", voiceName); }, [voiceName]);
  useEffect(() => {
    if (!canSpeak) return undefined;
    const load = () => setVoices(rankVoices(window.speechSynthesis.getVoices()));
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  useEffect(() => () => { // leaving the console: stop talking and listening
    speakTokenRef.current++; if (canSpeak) window.speechSynthesis.cancel();
    endingRef.current = true; try { recRef.current?.abort(); } catch { /* not running */ }
  }, []);

  const setConvo = (open) => { convoRef.current = open; setConvoOpen(open); };
  const clearTimers = () => { clearTimeout(silenceTimer.current); clearTimeout(noSpeechTimer.current); };
  const withName = (s) => (nameRef.current && Math.random() < 0.5 ? s.replace(/^(\S+?)([.,!?])?(\s|$)/, `$1, ${nameRef.current}$2$3`) : s);

  // ── Speaking ──
  const stopSpeaking = () => { speakTokenRef.current++; if (canSpeak) window.speechSynthesis.cancel(); };

  // Speaks sentence by sentence (natural pacing, and avoids Chrome cutting off long utterances).
  // Resolves true when it finishes, false if it was cut off.
  const speakLines = (list, { queue = false, caption = true, core = true } = {}) => new Promise((resolve) => {
    if (!voiceOnRef.current || !canSpeak || !list.length) { resolve(true); return; }
    if (!queue) stopSpeaking();
    const token = speakTokenRef.current;
    list.forEach((line, i) => {
      const u = new window.SpeechSynthesisUtterance(line.replace(/[*#_`]/g, ""));
      if (voiceRef.current) { u.voice = voiceRef.current; u.lang = voiceRef.current.lang; }
      u.rate = 1.0 + (Math.random() * 0.06 - 0.02);
      u.pitch = 1;
      u.onstart = () => {
        if (token !== speakTokenRef.current) return;
        if (core) setCoreState("speaking");
        if (caption) setSpokenIdx(i);
      };
      const done = (ok) => {
        if (!ok || token !== speakTokenRef.current) { resolve(false); return; }
        if (i === list.length - 1) { if (caption) setSpokenIdx(list.length); resolve(true); }
      };
      u.onend = () => done(true);
      u.onerror = (e) => done(!(e.error === "interrupted" || e.error === "canceled"));
      window.speechSynthesis.speak(u);
    });
  });

  // Words on screen with the sentence being spoken highlighted.
  const show = (list) => { setLines(list); setSpokenIdx(voiceOnRef.current && canSpeak ? -1 : list.length); };

  // ── Mic level for the core (local only; the audio never leaves this tab) ──
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
    } catch { /* the level meter is decoration; recognition reports real mic errors */ }
  };
  const stopLevel = () => { if (audioRef.current) { audioRef.current(); audioRef.current = null; } };

  // ── Listening ──
  const startListening = () => {
    if (!SpeechRec || listeningRef.current || busyRef.current) return;
    stopSpeaking();
    setMicErr(""); setHint("");
    const convo = modeRef.current === "conversation";
    listeningRef.current = true; endingRef.current = false;
    finalRef.current = ""; heardRef.current = ""; setHeard("");
    const rec = new SpeechRec();
    rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true;
    clearTimers();
    if (convo) noSpeechTimer.current = setTimeout(() => { if (!heardRef.current.trim()) endListening("timeout"); }, NO_SPEECH_MS);
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript; else interim += r[0].transcript;
      }
      const t = (finalRef.current + interim).trim();
      heardRef.current = t; setHeard(t); setText(t);
      if (convo && t) { clearTimeout(silenceTimer.current); silenceTimer.current = setTimeout(() => endListening("pause"), SILENCE_MS); }
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setMicErr("Microphone access is blocked. Allow it in the browser, or type instead.");
        endingRef.current = true; setConvo(false);
      } else if (ev.error !== "no-speech" && ev.error !== "aborted") setMicErr("I couldn't hear that clearly. Try again or type it.");
    };
    rec.onend = () => {
      // Chrome stops recognition on its own after a while; keep going while we're still listening.
      if (listeningRef.current && convo && !endingRef.current) { try { rec.start(); return; } catch { /* fall through */ } }
      listeningRef.current = false; stopLevel(); clearTimers();
      setCoreState((s) => (s === "listening" ? "idle" : s));
    };
    recRef.current = rec;
    try { rec.start(); setCoreState("listening"); setInputMode("voice"); startLevel(); } catch { listeningRef.current = false; }
  };

  // why: pause | tap | release | timeout
  const endListening = (why) => {
    if (!listeningRef.current) return;
    clearTimers(); endingRef.current = true; listeningRef.current = false;
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    stopLevel(); setCoreState("idle");
    const said = heardRef.current.trim();
    setHeard("");
    if (modeRef.current !== "conversation") { setTimeout(() => textRef.current?.focus(), 50); return; } // push to talk: review, then Send
    if (why === "timeout" || !said) {
      setConvo(false); setText("");
      setHint("I'll be here. Tap the core when you need me.");
      return;
    }
    handleUtterance(said);
  };

  const handleUtterance = async (raw) => {
    const said = stripName(raw) || raw;
    if (CANCEL_RE.test(said)) {
      setText("");
      await speakLines([pick(["Okay.", "Sure, dropping that.", "No problem."])], { caption: false });
      if (convoRef.current) startListening();
      return;
    }
    if (END_RE.test(said) || THANKS_ONLY_RE.test(said)) {
      setText(""); setConvo(false);
      const bye = THANKS_ONLY_RE.test(said) ? withName(pick(["You're welcome.", "Anytime.", "Happy to help."])) : withName(pick(BYES));
      show([bye]);
      await speakLines([bye]);
      setCoreState("idle");
      return;
    }
    sendRef.current(said, "voice");
  };

  // ── Sending ──
  const send = async (override, how) => {
    const command = (override ?? text).trim();
    if (!command || busyRef.current) return;
    if (listeningRef.current) { clearTimers(); endingRef.current = true; listeningRef.current = false; try { recRef.current?.stop(); } catch { /* stopped */ } stopLevel(); }
    window.dispatchEvent(new window.Event("hub-activity")); // talking counts as activity for the idle lock
    const sentMode = how || (override ? "typed" : inputMode);
    const interruptsAtSend = interruptRef.current;
    busyRef.current = true; setBusy(true); setCoreState("thinking"); setHint(""); setHeard("");
    stopSpeaking();
    // A short spoken acknowledgement if the answer takes more than a moment, so there's no dead air.
    const ackTimer = voiceOnRef.current && canSpeak
      ? setTimeout(() => speakLines([pick(ACKS)], { caption: false, core: false }), 700) : null;

    let out;
    try {
      const { data, error } = await sb.functions.invoke("hub-command", {
        body: { command, inputMode: sentMode, module: "platform", history: historyRef.current.slice(-10) },
      });
      if (error) {
        let body = {};
        try { body = await error.context.json(); } catch { /* non-JSON error */ }
        out = { error: body.error || "I couldn't reach the hub just now.", requestId: body.request_id, mfa: body.mfa_required };
      } else out = { answer: data.answer, tools: data.tools || [], requestId: data.request_id, firstName: data.first_name };
    } catch {
      out = { error: "I couldn't reach the hub just now." };
    }
    clearTimeout(ackTimer);
    busyRef.current = false; setBusy(false);
    setLog((l) => [{ at: new Date(), command, ...out }, ...l].slice(0, 30));
    if (out.mfa) { onSignOut(); return; }
    setText(""); setInputMode("typed");

    if (out.error) {
      setConvo(false);
      show([out.error]); setCoreState("error");
      await speakLines([out.error], { queue: true, core: false });
      setTimeout(() => setCoreState((s) => (s === "error" ? "idle" : s)), 1500);
      return;
    }
    if (out.firstName && !nameRef.current) setName(out.firstName);
    historyRef.current = [...historyRef.current, { role: "user", content: command }, { role: "assistant", content: out.answer }].slice(-10);
    const said = splitSentences(out.answer);
    show(said);
    // If they cut in while we were working, show the answer but don't talk over them.
    if (interruptRef.current === interruptsAtSend) {
      const finished = await speakLines(said, { queue: true });
      if (!finished) return;
    }
    setCoreState("idle");
    if (convoRef.current && modeRef.current === "conversation") setTimeout(() => startListening(), 250);
  };
  sendRef.current = send;

  // ── The core is the main control ──
  const onCore = async () => {
    if (!SpeechRec) { textRef.current?.focus(); return; }
    if (coreRef.current === "speaking") { // cut in
      interruptRef.current++; stopSpeaking(); setCoreState("idle");
      if (modeRef.current === "conversation") { setConvo(true); startListening(); }
      return;
    }
    if (listeningRef.current) { endListening("tap"); return; }
    if (busyRef.current) return;
    if (modeRef.current === "conversation") {
      setConvo(true);
      if (!greetedRef.current && voiceOnRef.current && canSpeak) {
        greetedRef.current = true;
        const hi = `Hi${nameRef.current ? ` ${nameRef.current}` : ""}, ${ASSISTANT_NAME} here. ${pick(HELLOS)}`;
        await speakLines([hi], { caption: false });
      }
      startListening();
    } else startListening();
  };
  onCoreRef.current = onCore;

  const endConversation = () => {
    setConvo(false); interruptRef.current++; stopSpeaking();
    if (listeningRef.current) { clearTimers(); endingRef.current = true; listeningRef.current = false; try { recRef.current?.abort(); } catch { /* stopped */ } stopLevel(); }
    setHeard(""); setCoreState("idle"); setHint("Conversation ended. Tap the core to start again.");
  };

  // Space bar: tap to talk in conversation mode, hold to talk in push-to-talk mode.
  useEffect(() => {
    const typing = (el) => el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable);
    const down = (e) => {
      if (e.code !== "Space" || e.repeat || typing(document.activeElement)) return;
      e.preventDefault();
      if (modeRef.current === "conversation") onCoreRef.current();
      else startListening();
    };
    const up = (e) => {
      if (e.code === "Space" && modeRef.current !== "conversation" && listeningRef.current) { e.preventDefault(); endListening("release"); }
    };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  });

  const coreHint = coreState === "listening"
    ? (mode === "conversation" ? "I'm listening. Pause when you're done." : "Listening. Release when you're done.")
    : coreState === "speaking" ? "Tap to cut in."
    : coreState === "thinking" ? "" : hint || (SpeechRec ? (mode === "conversation" ? "Tap the core to talk." : "Hold the mic or space bar to talk.") : "");

  const segBtn = (key, label) => (
    <button key={key} className="hub-btn" onClick={() => { if (key !== mode) { endConversation(); setHint(""); setMode(key); } }}
      aria-pressed={mode === key} disabled={!SpeechRec} style={{
        fontFamily: BODY, fontSize: 11, letterSpacing: "0.08em", padding: "6px 12px", border: 0, cursor: SpeechRec ? "pointer" : "default",
        background: mode === key ? C.gold : "transparent", color: mode === key ? C.navy : C.gold, fontWeight: 700,
      }}>{label}</button>
  );

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
              <button key={s} className="hub-btn" disabled={busy} onClick={() => send(s, "typed")} style={{
                textAlign: "left", background: "none", border: `1px dashed ${C.line}`, borderRadius: 8, color: C.paper,
                fontSize: 12, padding: "8px 10px", cursor: "pointer", fontFamily: BODY, lineHeight: 1.35,
              }}>{s}</button>
            ))}
          </div>
          <div style={{ ...hudLabel, marginTop: 20 }}>Logo</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
            <img src={MARK_SRC} alt={`${ASSISTANT_NAME} logo`} width={52} height={52} style={{ borderRadius: 10, border: `1px solid ${C.line}` }} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <GoldButton kind="ghost" onClick={() => downloadJarvisMark("svg")} style={{ padding: "5px 12px", fontSize: 11 }}>SVG</GoldButton>
              <GoldButton kind="ghost" onClick={() => downloadJarvisMark("png", 1024)} style={{ padding: "5px 12px", fontSize: 11 }}>PNG</GoldButton>
            </div>
          </div>
        </aside>

        <section style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, minWidth: 0 }}>
          <button className="hub-btn" onClick={() => onCore()} aria-label={
            coreState === "speaking" ? "Interrupt" : coreState === "listening" ? "Stop listening" : `Talk to ${ASSISTANT_NAME}`}
            style={{ background: "none", border: 0, padding: 0, cursor: SpeechRec ? "pointer" : "default", borderRadius: "50%", width: "100%" }}>
            <Core state={coreState} level={level} />
          </button>

          <div aria-live="polite" style={{ minHeight: 48, textAlign: "center", maxWidth: 620, padding: "0 8px" }}>
            {coreState === "listening" && heard
              ? <span style={{ fontFamily: HEAD, fontStyle: "italic", fontSize: 20, color: C.gold }}>“{heard}”</span>
              : <span style={{ fontSize: 13, color: C.mute }}>{coreHint}</span>}
            {convoOpen && (
              <div style={{ marginTop: 6 }}>
                <button className="hub-btn" onClick={endConversation} style={{ background: "none", border: 0, color: C.mute, fontSize: 12, textDecoration: "underline", cursor: "pointer" }}>
                  End conversation
                </button>
              </div>
            )}
          </div>

          <div aria-live="polite" style={{ ...panel, width: "100%", maxWidth: 680, minHeight: 84, boxSizing: "border-box" }}>
            <div style={hudLabel}>{ASSISTANT_NAME}</div>
            <p style={{ fontFamily: HEAD, fontSize: 19, lineHeight: 1.6, margin: "8px 0 0" }}>
              {busy ? <span style={{ color: C.mute }}>Looking that up…</span> : lines.map((l, i) => (
                <span key={i} style={{
                  color: spokenIdx === -1 || i <= spokenIdx || spokenIdx >= lines.length ? C.paper : "rgba(248,246,241,0.38)",
                  textShadow: i === spokenIdx && coreState === "speaking" ? "0 0 14px rgba(201,169,97,0.55)" : "none",
                  transition: "color 300ms, text-shadow 300ms",
                }}>{l}{i < lines.length - 1 ? " " : ""}</span>
              ))}
            </p>
          </div>

          <div style={{ ...panel, width: "100%", maxWidth: 680, boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div role="group" aria-label="How to talk" style={{ display: "inline-flex", border: `1px solid ${C.gold}`, borderRadius: 999, overflow: "hidden", opacity: SpeechRec ? 1 : 0.4 }}>
                {segBtn("conversation", "Conversation")}
                {segBtn("push", "Push to talk")}
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                {canSpeak && voices.length > 0 && (
                  <label style={{ fontSize: 12, color: C.mute, display: "flex", gap: 6, alignItems: "center" }}>
                    Voice
                    <select value={voice?.name || ""} onChange={(e) => {
                      setVoiceName(e.target.value);
                      const v = voices.find((x) => x.name === e.target.value);
                      if (v && voiceOnRef.current) { voiceRef.current = v; speakLines([`Hi${nameRef.current ? ` ${nameRef.current}` : ""}, this is ${ASSISTANT_NAME}. This is how I sound.`], { caption: false }); }
                    }} style={{ background: "rgba(2,10,20,0.6)", color: C.paper, border: `1px solid ${C.line}`, borderRadius: 6, padding: "4px 6px", fontSize: 12, maxWidth: 170 }}>
                      {voices.slice(0, 15).map((v) => <option key={v.name} value={v.name}>{v.name.replace(/^Microsoft\s|\s\(.*\)$/g, "")}</option>)}
                    </select>
                  </label>
                )}
                <label style={{ fontSize: 12, color: C.mute, display: "flex", gap: 6, alignItems: "center", cursor: canSpeak ? "pointer" : "default" }}>
                  <input type="checkbox" checked={voiceOn && canSpeak} disabled={!canSpeak} onChange={(e) => setVoiceOn(e.target.checked)} />
                  Speak replies
                </label>
              </div>
            </div>
            <textarea ref={textRef} className="hub-input" rows={2} value={text} placeholder="Or type: households, obligations, tasks, plan changes…"
              onChange={(e) => { setText(e.target.value); if (!e.target.value) setInputMode("typed"); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              style={{ ...inputStyle, marginTop: 12, resize: "vertical", minHeight: 56 }} maxLength={1000} />
            <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
              {SpeechRec && mode === "push" && (
                <button className="hub-btn" aria-label="Hold to talk" disabled={busy}
                  onPointerDown={(e) => { e.preventDefault(); startListening(); }}
                  onPointerUp={() => endListening("release")} onPointerLeave={() => endListening("release")} onPointerCancel={() => endListening("release")}
                  onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); startListening(); } }}
                  onKeyUp={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); endListening("release"); } }}
                  style={{
                    width: 56, height: 56, borderRadius: "50%", cursor: "pointer", touchAction: "none",
                    border: `2px solid ${C.gold}`, color: coreState === "listening" ? C.navy : C.gold,
                    background: coreState === "listening" ? C.gold : "rgba(201,169,97,0.08)",
                    boxShadow: coreState === "listening" ? `0 0 24px ${C.gold}` : "none", transition: "all 120ms",
                  }}>
                  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </svg>
                </button>
              )}
              <div style={{ flex: 1, minWidth: 160, fontSize: 12, color: C.mute, lineHeight: 1.45 }}>
                {!SpeechRec ? <>Voice isn't available in this browser. Type your question instead.</>
                  : mode === "conversation"
                    ? <>Just talk; a short pause sends it. Say “never mind” to drop it, or “that's all” to finish. In Chrome, speech is processed by Google.</>
                    : <>Hold to talk, release, check the words, then send. In Chrome, speech is processed by Google.</>}
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
  const [firstName, setFirstName] = useState("");

  const evaluate = useCallback(async () => {
    if (!sb) { setPhase("unconfigured"); return; }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { setPhase("signin"); return; }
    const u = session.user;
    setUser(u);
    const { data: prof } = await sb.from("user_profiles").select("role,active,full_name").eq("id", u.id).maybeSingle();
    if (prof?.role !== "admin" || prof?.active === false) { setPhase("denied"); return; }
    setFirstName(String(prof?.full_name || "").trim().split(/\s+/)[0] || "");
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
    const evs = ["pointerdown", "keydown", "wheel", "touchstart", "hub-activity"]; // hub-activity: a voice command was sent
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => { clearTimeout(timer); evs.forEach((e) => window.removeEventListener(e, bump)); };
  }, [phase, signOut]);

  useEffect(() => { document.title = `${ASSISTANT_NAME} · ORDANIS`; }, []);

  // Local design preview of the console (dev server only; stripped from production builds).
  // It has no session, so any command it sends is refused by hub-command.
  if (import.meta.env.DEV && window.location.search.includes("preview=console")) {
    return <Console user={{ email: "preview@localhost" }} firstName="Will" onSignOut={() => window.location.assign("/hub")} />;
  }
  if (phase === "loading") return <Shell><div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><Core state="thinking" level={0} /></div></Shell>;
  if (phase === "unconfigured") return <GateCard title="Not configured"><p style={{ color: C.mute }}>This build has no Supabase connection set.</p></GateCard>;
  if (phase === "signin") return <SignIn onDone={evaluate} />;
  if (phase === "denied") return (
    <GateCard title="Administrators only">
      <p style={{ color: C.mute, fontSize: 14, lineHeight: 1.5 }}>This account can't use {ASSISTANT_NAME}. Your portal is still at the main address.</p>
      <GoldButton kind="ghost" onClick={signOut}>Sign out</GoldButton>
    </GateCard>
  );
  if (phase === "enroll") return <MfaEnroll onDone={evaluate} onSignOut={signOut} />;
  if (phase === "verify") return <MfaVerify factorId={factorId} onDone={evaluate} onSignOut={signOut} />;
  return <Console user={user} firstName={firstName} onSignOut={signOut} />;
}
