// Access code ("license number") gate for the iPhone / Android test builds (migration 20261029140000).
//
// Only inside the native app (Capacitor). On the website this renders its children untouched, so nothing changes
// for browser users. In the app, the first launch asks for the tester's access code and checks it with the
// app-access-check function; an accepted code is remembered on the device. Every later launch opens straight away
// and re-checks the code quietly, so a code an admin has revoked locks the app again. Offline, a previously
// accepted code still opens the app.
import React, { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { SplashScreen } from "@capacitor/splash-screen";
import { pushNavyOverlay } from "./nativeChrome.js";

const KEY = "ordanis_app_access_code";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const NAVY = "#0A2540", GOLD = "#C9A961", PAPER = "#F8F6F1";

// The opening sequence (Will, 2026-10-29): the navy launch screen with the white / gold O fades into the stacked
// ORDANIS logo on cream, which then fades into the first real screen (sign-in, or the access code while testing).
// The website's own cube animation is skipped in the app (main.jsx), so the logo is shown once.
// The same startup sound the Email Portal plays at sign-in (public/intro.m4a, setting "ordanis-startup-sound"),
// played once as the app opens. Turned off in Security, or by the phone's silent switch.
export const STARTUP_SOUND_KEY = "ordanis-startup-sound";
export const startupSoundOn = () => { try { return localStorage.getItem(STARTUP_SOUND_KEY) !== "off"; } catch (_e) { return true; } };
function playStartupSound() {
  if (!startupSoundOn()) return;
  try {
    try { if (navigator.audioSession) navigator.audioSession.type = "ambient"; } catch (_e) { /* older iOS */ }
    const a = new window.Audio("/intro.m4a");
    a.play().catch(() => {});
  } catch (_e) { /* no audio */ }
}

// Timed to the chime (milliseconds from when it starts). intro.m4a is silent to 0.9s, swells to its main hit at
// 1.5s, has a second phrase from 2.9s to 4.4s, and fades out by 6.2s. The launch screen is plain navy; the white /
// gold O fades in slowly through the swell (oFade), gives way to the stacked logo on the hit, the logo holds through
// the second phrase, and everything fades into the first screen as the chime fades. Sound off: a shorter version.
// The O fades in evenly across the chime's whole first note (to 2.8s), and the logo arrives with the second phrase
// (2.9s), holds through it, and fades out with the chime (Will).
const WITH_SOUND = { oStart: 0, oFade: 2700, logoIn: 2850, out: 4400, done: 4900 };
const QUIET = { oStart: 0, oFade: 600, logoIn: 750, out: 2200, done: 2700 };

// The ORDANIS O (same ring as the app icon): white left half, gold right half.
function OMark({ style }) {
  return (
    <svg viewBox="174 143 676 737" style={style} aria-hidden="true">
      <defs>
        <clipPath id="ordanis-o-ring"><path fillRule="evenodd" clipRule="evenodd"
          d="M512 143a338 368.5 0 1 0 0.01 0zM512 236a215 276 0 1 1 -0.01 0z" /></clipPath>
      </defs>
      <g clipPath="url(#ordanis-o-ring)">
        <rect x="0" y="0" width="512" height="1024" fill="#FFFFFF" />
        <rect x="512" y="0" width="512" height="1024" fill={GOLD} />
      </g>
    </svg>
  );
}

function LogoIntro({ timing, onDone }) {
  const [phase, setPhase] = useState("o"); // o (O fading in) -> shown (logo) -> out
  const [oVisible, setOVisible] = useState(false);
  useEffect(() => {
    const release = pushNavyOverlay(); // navy behind the status bar while the logo is up, even over the portal
    const t0 = setTimeout(() => setOVisible(true), Math.max(30, timing.oStart));
    const t1 = setTimeout(() => setPhase("shown"), timing.logoIn);
    const t2 = setTimeout(() => setPhase("out"), timing.out);
    const t3 = setTimeout(onDone, timing.done);
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); release(); };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: NAVY, display: "flex", alignItems: "center", justifyContent: "center",
      opacity: phase === "out" ? 0 : 1, transition: "opacity 0.5s ease", pointerEvents: phase === "out" ? "none" : "auto" }}>
      <OMark style={{ position: "absolute", width: "41%", maxWidth: 200, opacity: phase === "o" && oVisible ? 1 : 0,
        transition: phase === "o" ? `opacity ${timing.oFade}ms linear` : "opacity 0.4s ease" }} />
      <img src="/ordanis-logo-reversed.png" alt="ORDANIS" style={{ width: "72%", maxWidth: 340, opacity: phase === "o" ? 0 : 1,
        transform: phase === "o" ? "scale(0.97)" : "none", transition: "opacity 0.6s ease, transform 1.2s ease" }} />
    </div>
  );
}

// "ok" | "refused" | "offline"
async function checkCode(code) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/app-access-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
      body: JSON.stringify({ code }),
    });
    if (r.ok) return "ok";
    return r.status === 403 ? "refused" : "offline";
  } catch (_e) {
    return "offline";
  }
}

export default function AppAccessGate({ children }) {
  const native = Capacitor.isNativePlatform();
  const [state, setState] = useState(native ? "loading" : "open"); // loading | ask | open
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [introDone, setIntroDone] = useState(!native);
  const [timing] = useState(() => (startupSoundOn() ? WITH_SOUND : QUIET));
  const started = useRef(false);
  const [introGo, setIntroGo] = useState(false);

  // Once the first screen is ready: start the chime and the intro (LogoIntro) on the same clock.
  useEffect(() => {
    if (!native || state === "loading" || started.current) return;
    started.current = true;
    // Lift the plain-navy launch screen first (a navy cover is underneath), then start the chime and the O together,
    // so the fade happens where it can be seen rather than behind the launch screen.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const go = () => setTimeout(() => { playStartupSound(); setIntroGo(true); }, 300);
      SplashScreen.hide({ fadeOutDuration: 200 }).then(go, go);
    }));
  }, [native, state]);

  useEffect(() => {
    if (!native) return;
    let live = true;
    (async () => {
      const { value } = await Preferences.get({ key: KEY });
      if (!live) return;
      if (!value) { setState("ask"); return; }
      setState("open");
      if ((await checkCode(value)) === "refused") {
        await Preferences.remove({ key: KEY });
        if (live) { setErr("This access code is no longer active. Enter a new one to continue."); setState("ask"); }
      }
    })();
    return () => { live = false; };
  }, [native]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr("");
    const result = await checkCode(code);
    if (result === "ok") {
      await Preferences.set({ key: KEY, value: code.trim() });
      setState("open");
    } else {
      setErr(result === "refused" ? "That access code wasn't recognized. Check it and try again." : "We couldn't reach ORDANIS. Check your connection and try again.");
    }
    setBusy(false);
  };

  const intro = !native || introDone || state === "loading" ? null
    : introGo ? <LogoIntro timing={timing} onDone={() => setIntroDone(true)} />
    : <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: NAVY }} />;
  if (state === "open") return <>{children}{intro}</>;
  if (state === "loading") return <div style={{ position: "fixed", inset: 0, background: NAVY }} />;
  return (<>{intro}
    <div style={{ position: "fixed", inset: 0, overflowY: "auto", background: NAVY, display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom))", fontFamily: "'DM Sans','Helvetica Neue',Arial,sans-serif" }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 380, background: "#fff", borderRadius: 14, boxShadow: "0 8px 30px rgba(10,37,64,0.10)", overflow: "hidden" }}>
        <div style={{ height: 4, background: GOLD }} />
        <div style={{ padding: "28px 26px 26px" }}>
          <img src="/ordanis-logo.png" alt="ORDANIS" style={{ display: "block", width: 190, margin: "0 auto 18px" }} />
          <div style={{ fontFamily: "Georgia,serif", fontSize: 21, color: NAVY, textAlign: "center", marginBottom: 6 }}>Enter your access code</div>
          <div style={{ fontSize: 13.5, color: "#5a6e84", textAlign: "center", lineHeight: 1.5, marginBottom: 20 }}>
            The ORDANIS app is in private testing. Enter the access code you were given.
          </div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5a6e84", marginBottom: 6 }}>Access code</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ORD-XXXX-XXXX-XXXX" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off"
            style={{ width: "100%", boxSizing: "border-box", fontSize: 17, letterSpacing: "0.06em", padding: "13px 14px", border: "1.5px solid #d8cdb8", borderRadius: 10, color: NAVY, fontFamily: "inherit", outline: "none" }} />
          {err && <div style={{ fontSize: 12.5, color: "#8b1a1a", background: "#fff5f5", border: "1px solid #f3c2c2", borderRadius: 8, padding: "8px 10px", marginTop: 10 }}>{err}</div>}
          <button type="submit" disabled={busy || code.trim().length < 12}
            style={{ width: "100%", marginTop: 16, minHeight: 48, border: "none", borderRadius: 10, background: NAVY, color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", opacity: busy || code.trim().length < 12 ? 0.55 : 1 }}>
            {busy ? "Checking…" : "Continue"}
          </button>
          <div style={{ fontSize: 12, color: "#8fa0b2", textAlign: "center", marginTop: 16 }}>Need a code? Email info@ordanisos.com</div>
        </div>
      </form>
    </div>
  </>);
}
