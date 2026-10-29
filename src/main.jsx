import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import SignupFlow, { SignupWelcome } from './SignupFlow.jsx'
import AppAccessGate from './AppAccessGate.jsx'
import { Capacitor } from '@capacitor/core'

// Inside the iPhone / Android app: full-screen styling (index.html, html.native-app) instead of a browser page.
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native-app')
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
      {isWelcome ? <SignupWelcome /> : isSignup ? <SignupFlow /> : <App />}
    </AppAccessGate>
  </React.StrictMode>
)
