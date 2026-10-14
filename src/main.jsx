import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import SignupFlow from './SignupFlow.jsx'

// The public self-serve sign-up flow (Plans -> Account -> Stripe Checkout) lives outside the
// authenticated app entirely -- it renders before any Supabase session check, so it never runs
// App.jsx's auth-gated hooks. vercel.json rewrites every path to this same bundle, so the actual
// pathname is read here, client-side, to decide which tree to mount.
// Demo builds set VITE_HIDE_SIGNUP=1 so /signup falls through to the login screen.
const hideSignup = String(import.meta.env.VITE_HIDE_SIGNUP || '') === '1'
const isSignup = !hideSignup && typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '').startsWith('/signup')
// The administrators' command hub. Loaded on demand so the portal bundle doesn't carry it;
// admin role and MFA are enforced by the hub-command edge function, not by this route.
const isHub = typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/hub'
const Hub = React.lazy(() => import('./Hub.jsx'))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isHub
      ? <React.Suspense fallback={<div style={{ minHeight: '100vh', background: '#041220' }} />}><Hub /></React.Suspense>
      : isSignup ? <SignupFlow /> : <App />}
  </React.StrictMode>
)
