import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// ORDANIS is the platform; every deployment (including PCM's own) is a white-label
// tenant that supplies its own branding via VITE_BRAND_* env vars.
//
// The <head> has to be branded at BUILD time, not run time: link-preview crawlers
// (iMessage, Slack, LinkedIn, WhatsApp) don't execute JavaScript, so they only
// ever see the static HTML. That's why these values can't come from the database
// the way the in-app branding does — a shared link previews as whatever the build
// baked in.
const ORDANIS_DEFAULTS = {
  name: 'ORDANIS',
  short: 'ORDANIS',
  description: 'ORDANIS — private wealth administration. Client portals, reporting, and an AI assistant for advisory firms and family offices.',
  ogImage: '/ordanis-og.png',
  primary: '#092b49',
  favicon: '/ordanis-favicon.ico',
  favicon16: '/ordanis-favicon-16x16.png',
  favicon32: '/ordanis-favicon-32x32.png',
  appleIcon: '/ordanis-apple-touch-icon.png',
  favicon192: '/ordanis-favicon-192.png',
  favicon512: '/ordanis-favicon-512.png',
}

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const pick = (key, fallback) => (env[key] && env[key].trim() ? env[key].trim() : fallback)

  // Stamped into the bundle and also published as /version.json, so an already-
  // open tab can notice that a newer build has been deployed and offer to reload
  // instead of silently running yesterday's code. Prefer Vercel's commit SHA so
  // the id is stable across the build's own retries.
  const buildId = (env.VITE_BUILD_ID || process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now())).slice(0, 12)

  const brand = {
    name: pick('VITE_BRAND_NAME', ORDANIS_DEFAULTS.name),
    short: pick('VITE_BRAND_SHORT', ORDANIS_DEFAULTS.short),
    description: pick('VITE_BRAND_DESCRIPTION', ORDANIS_DEFAULTS.description),
    ogImage: pick('VITE_BRAND_OG_IMAGE', ORDANIS_DEFAULTS.ogImage),
    primary: pick('VITE_BRAND_PRIMARY', ORDANIS_DEFAULTS.primary),
    siteUrl: pick('VITE_BRAND_SITE_URL', ''),
    favicon: pick('VITE_BRAND_FAVICON', ORDANIS_DEFAULTS.favicon),
    favicon16: pick('VITE_BRAND_FAVICON_16', ORDANIS_DEFAULTS.favicon16),
    favicon32: pick('VITE_BRAND_FAVICON_32', ORDANIS_DEFAULTS.favicon32),
    appleIcon: pick('VITE_BRAND_APPLE_ICON', ORDANIS_DEFAULTS.appleIcon),
    favicon192: pick('VITE_BRAND_FAVICON_192', ORDANIS_DEFAULTS.favicon192),
    favicon512: pick('VITE_BRAND_FAVICON_512', ORDANIS_DEFAULTS.favicon512),
  }

  // Crawlers need an absolute og:image URL; a leading-slash path won't resolve
  // for them, so prefix it with the site URL when one is configured.
  const absoluteOg = /^https?:\/\//i.test(brand.ogImage)
    ? brand.ogImage
    : brand.siteUrl
      ? `${brand.siteUrl.replace(/\/$/, '')}${brand.ogImage}`
      : brand.ogImage

  return {
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    plugins: [
      react(),
      {
        // Publishes the build id as a tiny always-fresh file the running app polls.
        name: 'emit-version',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: JSON.stringify({ build: buildId, builtAt: new Date().toISOString() }),
          })
        },
      },
      {
        name: 'brand-html',
        // MUST run before Vite's own build-html pass. That pass calls decodeURI()
        // on every href/src it finds, so an unresolved token left inside an icon
        // href fails the whole build ("URI malformed"). Running 'pre' means the
        // attributes already hold real paths by the time Vite parses them.
        // Tokens also deliberately avoid % delimiters, which decodeURI would
        // read as percent-escapes.
        transformIndexHtml: {
          order: 'pre',
          handler(html) {
            const tokens = {
              __BRAND_NAME__: esc(brand.name),
              __BRAND_SHORT__: esc(brand.short),
              __BRAND_DESCRIPTION__: esc(brand.description),
              __BRAND_OG_IMAGE__: esc(absoluteOg),
              __BRAND_PRIMARY__: esc(brand.primary),
              __BRAND_FAVICON__: esc(brand.favicon),
              __BRAND_FAVICON_16__: esc(brand.favicon16),
              __BRAND_FAVICON_32__: esc(brand.favicon32),
              __BRAND_APPLE_ICON__: esc(brand.appleIcon),
              __BRAND_FAVICON_192__: esc(brand.favicon192),
              __BRAND_FAVICON_512__: esc(brand.favicon512),
            }
            const out = Object.entries(tokens).reduce(
              (acc, [token, value]) => acc.split(token).join(value),
              html,
            )
            // Fail loudly here rather than letting a typo'd token reach the
            // browser as literal text in a <title> or link preview.
            const missed = out.match(/__BRAND_[A-Z0-9_]*__/g)
            if (missed) throw new Error(`brand-html: unresolved tokens ${[...new Set(missed)].join(', ')}`)
            return out
          },
        },
      },
    ],
  }
})
