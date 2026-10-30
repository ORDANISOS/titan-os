// Face ID / Touch ID / fingerprint unlock for the iPhone / Android app (Will, 2026-10-29).
//
// Clients sign in with their password once per phone, then Face ID (Will, 2026-10-29: the authenticator is required for
// employees and optional for clients; the client app goes by biometrics). Employees, and clients who chose the
// authenticator, still enter it on that first sign-in, so two-factor accounts keep two-factor. Only after that full
// sign-in does the app offer "Use Face ID to unlock ORDANIS?". The signed-in session (still two-factor) stays saved on the phone as it already does; with Face ID
// on, the app is locked behind Face ID every time it opens, and again when it comes back after a minute away. Face ID
// never replaces the server's check: a new phone, a sign-out, or "Sign in with password" means the full sign-in again.
//
// On the website this renders its children untouched.
import React, { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { NativeBiometric, BiometryType } from "@capgo/capacitor-native-biometric";
import { pushNavyOverlay } from "./nativeChrome.js";
import OrdanisLockup from "./OrdanisLockup.jsx";

const PREF = "ordanis_biometric"; // "on" | "off" (unset: not asked yet)
const RELOCK_AFTER_MS = 60 * 1000;
// Set when the app goes to the background while unlocked. A live update reloads the screens in the background; if
// the person is back within RELOCK_AFTER_MS that reload doesn't lock them (the same rule as coming back without one).
// Only written while unlocked, so a reload can never skip a lock that was showing.
const AWAY_KEY = "ordanis-left-unlocked-at";
const NAVY = "#0A2540", PAPER = "#F8F6F1";

const isSessionKey = (k) => /^sb-.*-auth-token$/.test(k || "");
function hasSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (isSessionKey(k) && JSON.parse(localStorage.getItem(k) || "null")) return true;
    }
  } catch (_e) { /* no storage */ }
  return false;
}
function clearSession() {
  try { Object.keys(localStorage).filter(isSessionKey).forEach((k) => localStorage.removeItem(k)); } catch (_e) { /* none */ }
}
export const biometryLabel = (t) => (t === BiometryType.FACE_ID ? "Face ID" : t === BiometryType.TOUCH_ID ? "Touch ID" : "fingerprint unlock");

// For the Security panel (App.jsx): read and change the setting from anywhere in the app.
const listeners = new Set();
const shared = { available: false, label: "Face ID", enabled: false };
const publish = (patch) => { Object.assign(shared, patch); listeners.forEach((f) => f({ ...shared })); };
export function useBiometricSetting() {
  const [s, setS] = useState({ ...shared });
  useEffect(() => { listeners.add(setS); return () => listeners.delete(setS); }, []);
  const setEnabled = async (on) => {
    if (on) await NativeBiometric.verifyIdentity({ reason: "Turn on unlocking ORDANIS with " + shared.label, title: "ORDANIS", useFallback: true });
    await Preferences.set({ key: PREF, value: on ? "on" : "off" });
    publish({ enabled: on });
  };
  return { ...s, setEnabled };
}

export default function BiometricLock({ children }) {
  const native = Capacitor.isNativePlatform();
  const [ready, setReady] = useState(!native);
  const [locked, setLocked] = useState(false);
  const [offer, setOffer] = useState(false);
  const [msg, setMsg] = useState("");
  const typeRef = useRef(null);
  const prefRef = useRef(null);
  const hiddenAt = useRef(0);
  const lockedRef = useRef(false);
  lockedRef.current = !ready || locked;
  const label = biometryLabel(typeRef.current);

  const unlock = async () => {
    setMsg("");
    try {
      await NativeBiometric.verifyIdentity({ reason: "Unlock ORDANIS", title: "Unlock ORDANIS", useFallback: true });
      setLocked(false);
    } catch (_e) {
      setMsg(`${biometryLabel(typeRef.current)} didn't confirm it's you. Try again, or sign in with your password.`);
    }
  };

  // On launch: lock if Face ID is on and someone is signed in.
  useEffect(() => {
    if (!native) return;
    (async () => {
      const [{ value }, a] = await Promise.all([
        Preferences.get({ key: PREF }),
        NativeBiometric.isAvailable({ useFallback: true }).catch(() => ({ isAvailable: false })),
      ]);
      typeRef.current = a.biometryType;
      prefRef.current = value || null;
      publish({ available: !!a.isAvailable, label: biometryLabel(a.biometryType), enabled: value === "on" });
      let recentlyUnlocked = false;
      try {
        const t = Number(sessionStorage.getItem(AWAY_KEY) || 0);
        recentlyUnlocked = t > 0 && Date.now() - t < RELOCK_AFTER_MS;
        sessionStorage.removeItem(AWAY_KEY);
      } catch (_e) { /* no storage */ }
      const lock = value === "on" && !!a.isAvailable && hasSession() && !recentlyUnlocked;
      setLocked(lock);
      setReady(true);
      // No automatic scan: the Face ID prompt pauses the app, which cut off the opening and its chime (Will). The
      // lock screen waits for a tap on "Unlock with Face ID".
    })();
  }, [native]);

  // The lock screen is navy, even when it covers the portal.
  useEffect(() => {
    if (!native || (ready && !locked)) return;
    return pushNavyOverlay();
  }, [native, ready, locked]);

  // Coming back after a minute away locks again.
  useEffect(() => {
    if (!native) return;
    const onVis = () => {
      if (document.hidden) {
        hiddenAt.current = Date.now();
        try { if (!lockedRef.current) sessionStorage.setItem(AWAY_KEY, String(hiddenAt.current)); else sessionStorage.removeItem(AWAY_KEY); } catch (_e) { /* none */ }
        return;
      }
      try { sessionStorage.removeItem(AWAY_KEY); } catch (_e) { /* none */ }
      if (shared.enabled && hasSession() && hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_AFTER_MS) {
        setLocked(true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [native]);

  // The portal announces a completed sign-in (password + authenticator when used); offer Face ID once.
  useEffect(() => {
    if (!native) return;
    const onSignedIn = () => { if (prefRef.current === null && shared.available) setOffer(true); };
    window.addEventListener("ordanis:signed-in", onSignedIn);
    return () => window.removeEventListener("ordanis:signed-in", onSignedIn);
  }, [native]);

  const answerOffer = async (yes) => {
    setOffer(false);
    try {
      if (yes) await NativeBiometric.verifyIdentity({ reason: "Use " + label + " to unlock ORDANIS", title: "ORDANIS", useFallback: true });
      prefRef.current = yes ? "on" : "off";
      await Preferences.set({ key: PREF, value: prefRef.current });
      publish({ enabled: yes });
    } catch (_e) {
      prefRef.current = null; // not confirmed: ask again next sign-in
    }
  };

  const signInWithPassword = () => { clearSession(); window.location.reload(); };

  if (!native) return children;
  const btn = { width: "100%", boxSizing: "border-box", minHeight: 48, border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" };
  return (
    <>
      {children}
      {(!ready || locked) && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: NAVY, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "calc(24px + env(safe-area-inset-top)) 28px calc(24px + env(safe-area-inset-bottom))", fontFamily: "'DM Sans','Helvetica Neue',Arial,sans-serif" }}>
          {ready && <>
            <OrdanisLockup reversed style={{ width: "70%", maxWidth: 300, marginBottom: 36 }} />
            <button onClick={unlock} style={{ ...btn, maxWidth: 340, background: "#fff", color: NAVY }}>Unlock with {label}</button>
            {msg && <div style={{ maxWidth: 340, fontSize: 13, color: "#F3D7D2", textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>{msg}</div>}
            <button onClick={signInWithPassword} style={{ marginTop: 18, background: "none", border: "none", color: "#C9D3DF", fontSize: 13.5, textDecoration: "underline", fontFamily: "inherit", cursor: "pointer" }}>
              Sign in with your password instead
            </button>
          </>}
        </div>
      )}
      {offer && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(9,43,73,0.45)", display: "flex", alignItems: "flex-end", fontFamily: "'DM Sans','Helvetica Neue',Arial,sans-serif" }}>
          <div style={{ width: "100%", boxSizing: "border-box", background: "#fff", borderRadius: "16px 16px 0 0", padding: "26px 22px calc(26px + env(safe-area-inset-bottom))" }}>
            <div style={{ fontFamily: "Georgia,serif", fontSize: 21, color: NAVY, marginBottom: 8 }}>Use {label} to unlock ORDANIS?</div>
            <div style={{ fontSize: 14, color: "#3d4f63", lineHeight: 1.55, marginBottom: 20 }}>
              Next time you open the app, {label} unlocks it, so there's no password to type. On a new phone, or after you
              sign out, you'll sign in with your password once. You can turn this off any time in Security.
            </div>
            <button onClick={() => answerOffer(true)} style={{ ...btn, background: NAVY, color: "#fff" }}>Use {label}</button>
            <button onClick={() => answerOffer(false)} style={{ ...btn, marginTop: 10, background: "#fff", color: NAVY, border: "1.5px solid #d8cdb8" }}>Not now</button>
          </div>
        </div>
      )}
    </>
  );
}
