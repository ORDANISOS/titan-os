// Live updates for the iPhone / Android app (Will, 2026-10-29: "set up live updates before launch").
//
// The app carries its own copy of the portal's screens. Every website deploy also publishes that copy for phones
// (scripts/app-update-bundle.mjs -> /app-update/latest.json + /app-update/<build>.zip on the same site). Each time the
// app opens it asks its own site whether there is a newer build; if so it downloads it quietly and switches to it the
// next time the app goes to the background, so nobody is interrupted mid-task. Native changes (plugins, icon,
// permissions) still need a store release: a bundle that needs a newer app than the phone has is skipped.
//
// Safety:
// - Only bundles from the app's own site (VITE_WEB_PORTAL_URL) are accepted, and each is checked against the SHA-256
//   checksum in the manifest before it is used. The bundle is the same code the website serves to browsers.
// - notifyAppReady() tells the plugin this bundle started properly. A bundle that never gets that far is rolled back
//   to the last good one automatically on the next launch, and we stop retrying a build that failed twice.
// - Capgo's own servers are never contacted (capacitor.config.json turns off its update, stats and channel URLs).
import { Capacitor } from "@capacitor/core";
/* global __BUILD_ID__ */ // stamped in by vite.config.js

const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";
const ORIGIN = String(import.meta.env.VITE_WEB_PORTAL_URL || "").replace(/\/+$/, "");
const TRIES_KEY = "ordanis-live-update-tries"; // { build, tries }
const MAX_TRIES = 2;

let started = false;

// "1.2" vs "1.10": numeric, part by part.
function cmpVersion(a, b) {
  const pa = String(a).split("."), pb = String(b).split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (parseInt(pa[i], 10) || 0) - (parseInt(pb[i], 10) || 0);
    if (d) return d;
  }
  return 0;
}

function readTries() {
  try { return JSON.parse(localStorage.getItem(TRIES_KEY) || "null") || {}; } catch (_e) { return {}; }
}
function writeTries(v) {
  try { localStorage.setItem(TRIES_KEY, JSON.stringify(v)); } catch (_e) { /* no storage */ }
}

export async function startLiveUpdates() {
  if (started || !Capacitor.isNativePlatform()) return;
  started = true;
  let CapacitorUpdater;
  try { ({ CapacitorUpdater } = await import("@capgo/capacitor-updater")); } catch (_e) { return; }
  // This bundle drew its first screen: keep it.
  try { await CapacitorUpdater.notifyAppReady(); } catch (_e) { /* builtin bundle on an older app */ }
  if (!ORIGIN || BUILD_ID === "dev") return;

  try {
    const r = await fetch(`${ORIGIN}/app-update/latest.json`, { cache: "no-store" });
    if (!r.ok) return;
    const m = await r.json();
    if (!m || typeof m.build !== "string" || m.build === BUILD_ID) { writeTries({}); return; }
    if (typeof m.url !== "string" || !m.url.startsWith(`${ORIGIN}/app-update/`)) return;
    if (!/^[a-f0-9]{64}$/.test(String(m.checksum || ""))) return;
    const { version: native } = await CapacitorUpdater.getBuiltinVersion();
    if (cmpVersion(native, m.minNative || "0") < 0) return; // needs a store update first

    // Already handed this build to the plugin before and we're still not running it: it was rolled back.
    const tries = readTries();
    const count = tries.build === m.build ? tries.tries || 0 : 0;
    if (count >= MAX_TRIES) return;

    const { bundles } = await CapacitorUpdater.list();
    let bundle = bundles.find((b) => b.version === m.build && b.status !== "error");
    if (!bundle) bundle = await CapacitorUpdater.download({ url: m.url, version: m.build, checksum: m.checksum });
    await CapacitorUpdater.next({ id: bundle.id });
    writeTries({ build: m.build, tries: count + 1 });
  } catch (e) {
    console.warn("live update:", e && e.message ? e.message : e);
  }
}
