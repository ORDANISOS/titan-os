// Access code ("license number") gate for the iPhone / Android test builds (migration 20261029140000).
//
// Only inside the native app (Capacitor). On the website this renders its children untouched, so nothing changes
// for browser users. In the app, the first launch asks for the tester's access code and checks it with the
// app-access-check function; an accepted code is remembered on the device. Every later launch opens straight away
// and re-checks the code quietly, so a code an admin has revoked locks the app again. Offline, a previously
// accepted code still opens the app.
import React, { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { SplashScreen } from "@capacitor/splash-screen";

const KEY = "ordanis_app_access_code";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const NAVY = "#0A2540", GOLD = "#C9A961", PAPER = "#F8F6F1";

// The opening sequence (Will, 2026-10-29): the navy launch screen with the white / gold O fades into the stacked
// ORDANIS logo on cream, which then fades into the first real screen (sign-in, or the access code while testing).
// The website's own cube animation is skipped in the app (main.jsx), so the logo is shown once.
function LogoIntro({ onDone }) {
  const [phase, setPhase] = useState("in"); // in -> shown -> out
  useEffect(() => {
    const t1 = setTimeout(() => setPhase("shown"), 60);
    const t2 = setTimeout(() => setPhase("out"), 1900);
    const t3 = setTimeout(onDone, 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: PAPER, display: "flex", alignItems: "center", justifyContent: "center",
      opacity: phase === "out" ? 0 : 1, transition: "opacity 0.5s ease", pointerEvents: phase === "out" ? "none" : "auto" }}>
      <img src="/ordanis-logo.png" alt="ORDANIS" style={{ width: "72%", maxWidth: 340, opacity: phase === "in" ? 0 : 1,
        transform: phase === "in" ? "translateY(6px)" : "none", transition: "opacity 0.7s ease 0.25s, transform 0.9s ease 0.25s" }} />
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

  // The ORDANIS launch screen (navy, white / gold O) stays up until the first real screen is ready, then fades.
  useEffect(() => {
    if (!native || state === "loading") return;
    // Two animation frames: the screen underneath has painted, so the O fades straight into it (no bare navy).
    requestAnimationFrame(() => requestAnimationFrame(() => SplashScreen.hide({ fadeOutDuration: 300 }).catch(() => {})));
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

  const intro = native && !introDone && state !== "loading" ? <LogoIntro onDone={() => setIntroDone(true)} /> : null;
  if (state === "open") return <>{children}{intro}</>;
  if (state === "loading") return <div style={{ position: "fixed", inset: 0, background: PAPER }} />;
  return (<>{intro}
    <div style={{ position: "fixed", inset: 0, overflowY: "auto", background: PAPER, display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom))", fontFamily: "'DM Sans','Helvetica Neue',Arial,sans-serif" }}>
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
