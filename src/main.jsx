import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import SignupFlow, { SignupWelcome } from './SignupFlow.jsx'
import AppAccessGate from './AppAccessGate.jsx'
import BiometricLock from './BiometricLock.jsx'
import { Capacitor } from '@capacitor/core'

// Inside the iPhone / Android app: full-screen styling (index.html, html.native-app) instead of a browser page.
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native-app')
  // Native apps don't zoom: no pinch zoom, and no iOS auto-zoom when tapping into a small text field (which could
  // leave the whole portal enlarged and pushed off the right edge).
  try { document.querySelector('meta[name=viewport]').setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover') } catch (_e) {}
  // Navy around the app until the portal, with white status-bar text (nativeChrome.js).
  import('./nativeChrome.js').then(({ initNativeChrome }) => initNativeChrome())
  // The app opens with its own logo sequence (AppAccessGate), so the website's cube intro is skipped.
  try { sessionStorage.setItem('pcmIntroSeen', '1') } catch (_e) {}
  // No grey "previous / next / done" bar above the keyboard: native apps don't have one.
  // Never leave the launch screen up if something goes wrong before the first screen draws.
  setTimeout(() => import('@capacitor/splash-screen').then(({ SplashScreen }) => SplashScreen.hide()).catch(() => {}), 6000)
  import('@capacitor/keyboard').then(({ Keyboard }) => Keyboard.setAccessoryBarVisible({ isVisible: false })).catch(() => {})
}

// The public self-serve sign-up flow (Plans -> Account -> Stripe Checkout) lives outside the
// authenticated app entirely -- it renders before any Supabase session check, so it never runs
// App.jsx's auth-gated hooks. vercel.json rewrites every path to this same bundle, so the actual
// pathname is read here, client-side, to decide which tree to mount.
// Demo builds set VITE_HIDE_SIGNUP=1 so /signup falls through to the login screen.
const hideSignup = String(import.meta.env.VITE_HIDE_SIGNUP || '') === '1'
const path = typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') : ''
const isSignup = !hideSignup && path.startsWith('/signup')
// Where Stripe returns a new client after paying: congratulations and a link to sign in.
const isWelcome = path === '/welcome'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Native app only: asks for a tester's access code first. On the website it renders its child untouched. */}
    <AppAccessGate>
      {/* Native app only: Face ID / fingerprint lock on the saved sign-in. */}
      <BiometricLock>
        {isWelcome ? <SignupWelcome /> : isSignup ? <SignupFlow /> : <App />}
      </BiometricLock>
    </AppAccessGate>
  </React.StrictMode>
)
