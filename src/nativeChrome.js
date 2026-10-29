// Native app only: the colors around the app (page background behind the status bar, and the status bar's text).
// Navy with white status-bar text until the person is inside the portal (Will, 2026-10-29); the portal itself has a
// white header, so there it switches to white with dark text. Overlays shown on top of the portal (the Face ID lock,
// the opening logo) ask for navy while they're up. On the website these do nothing.
import { Capacitor } from "@capacitor/core";

const NAVY = "#0A2540";
const state = { portal: false, overlays: 0 };

function apply() {
  if (!Capacitor.isNativePlatform()) return;
  const navy = !state.portal || state.overlays > 0;
  try { document.documentElement.style.background = navy ? NAVY : "#ffffff"; document.body.style.background = navy ? NAVY : "#ffffff"; } catch (_e) { /* no DOM */ }
  import("@capacitor/status-bar")
    .then(({ StatusBar, Style }) => StatusBar.setStyle({ style: navy ? Style.Dark : Style.Light }))
    .catch(() => {});
}

export function setInPortal(on) { state.portal = !!on; apply(); }
export function pushNavyOverlay() { state.overlays++; apply(); return () => { state.overlays = Math.max(0, state.overlays - 1); apply(); }; }
export function initNativeChrome() { apply(); }
