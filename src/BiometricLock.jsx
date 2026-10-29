// Face ID / Touch ID / fingerprint unlock for the iPhone / Android app (Will, 2026-10-29).
//
// How it keeps two-factor protection intact: the first sign-in on a phone is the normal one (password, plus the
// authenticator code when the account uses one). Only after that full sign-in does the app offer "Use Face ID to
// unlock ORDANIS?". The signed-in session (still two-factor) stays saved on the phone as it already does; with Face ID
// on, the app is locked behind Face ID every time it opens, and again when it comes back after a minute away. Face ID
// never replaces the server's check: a new phone, a sign-out, or "Sign in with password" means the full sign-in again.
//
// On the website this renders its children untouched.
import React, { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { NativeBiometric, BiometryType } from "@capgo/capacitor-native-biometric";

const PREF = "ordanis_biometric"; // "on" | "off" (unset: not asked yet)
const RELOCK_AFTER_MS = 60 * 1000;
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
      const lock = value === "on" && !!a.isAvailable && hasSession();
      setLocked(lock);
      setReady(true);
      if (lock) unlock();
    })();
  }, [native]);

  // Coming back after a minute away locks again.
  useEffect(() => {
    if (!native) return;
    const onVis = () => {
      if (document.hidden) { hiddenAt.current = Date.now(); return; }
      if (shared.enabled && hasSession() && hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_AFTER_MS) {
        setLocked(true); unlock();
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
  const btn = { width: "100%", minHeight: 48, border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" };
  return (
    <>
      {children}
      {(!ready || locked) && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: PAPER, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "calc(24px + env(safe-area-inset-top)) 28px calc(24px + env(safe-area-inset-bottom))", fontFamily: "'DM Sans','Helvetica Neue',Arial,sans-serif" }}>
          {ready && <>
            <img src="/ordanis-logo.png" alt="ORDANIS" style={{ width: "70%", maxWidth: 300, marginBottom: 36 }} />
            <button onClick={unlock} style={{ ...btn, maxWidth: 340, background: NAVY, color: "#fff" }}>Unlock with {label}</button>
            {msg && <div style={{ maxWidth: 340, fontSize: 13, color: "#8b1a1a", textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>{msg}</div>}
            <button onClick={signInWithPassword} style={{ marginTop: 18, background: "none", border: "none", color: "#5a6e84", fontSize: 13.5, textDecoration: "underline", fontFamily: "inherit", cursor: "pointer" }}>
              Sign in with your password instead
            </button>
          </>}
        </div>
      )}
      {offer && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(9,43,73,0.45)", display: "flex", alignItems: "flex-end", fontFamily: "'DM Sans','Helvetica Neue',Arial,sans-serif" }}>
          <div style={{ width: "100%", background: "#fff", borderRadius: "16px 16px 0 0", padding: "26px 22px calc(26px + env(safe-area-inset-bottom))" }}>
            <div style={{ fontFamily: "Georgia,serif", fontSize: 21, color: NAVY, marginBottom: 8 }}>Use {label} to unlock ORDANIS?</div>
            <div style={{ fontSize: 14, color: "#3d4f63", lineHeight: 1.55, marginBottom: 20 }}>
              Next time you open the app, {label} unlocks it: no password or authenticator code. On a new phone, or after you
              sign out, you'll sign in the usual way once. You can turn this off any time in Security.
            </div>
            <button onClick={() => answerOffer(true)} style={{ ...btn, background: NAVY, color: "#fff" }}>Use {label}</button>
            <button onClick={() => answerOffer(false)} style={{ ...btn, marginTop: 10, background: "#fff", color: NAVY, border: "1.5px solid #d8cdb8" }}>Not now</button>
          </div>
        </div>
      )}
    </>
  );
}
