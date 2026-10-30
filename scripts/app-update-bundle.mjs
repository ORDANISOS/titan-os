// Publishes the phone app's live update alongside every website deploy (src/liveUpdate.js reads it).
//
// After `vite build` has made the website in dist/, this builds the same code again with the app's settings
// (no sign-up, the tagline, the app's home site) into dist-app/, zips it, and writes:
//   dist/app-update/<build>.zip   the screens for phones
//   dist/app-update/latest.json   { build, url, checksum (sha256), minNative, builtAt }
// So a push to production updates portal.ordanisos.com and, on next launch, the apps pointed at it; a push to demo
// does the same for ordanis-demo.vercel.app and the TestFlight app.
//
// Runs only on Vercel production deploys (or with FORCE_APP_BUNDLE=1). The site is chosen by which Supabase project
// the build talks to, so a bundle can never point phones at the wrong back end.
// minNative (package.json "ordanisApp") is the oldest store version that can run this bundle: raise it, together
// with the app's version in Xcode, whenever a change needs new native code.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync } from "fflate";

const SITES = {
  xreeruxuwtmjhvvxvjts: "https://portal.ordanisos.com", // production
  tkryueqzvgcigvxgjzsp: "https://ordanis-demo.vercel.app", // demo
};
// Demo is the sales-pitch site: its database skin is whichever prospect is being shown (Accurate, today). The demo
// app is the ORDANIS test app, so its bundle ignores that skin. Production keeps database skins, so a firm's households
// see their firm's skin in the app just as on the website.
const DEMO_REF = "tkryueqzvgcigvxgjzsp";

const isProdDeploy = process.env.VERCEL_ENV === "production";
if (!isProdDeploy && process.env.FORCE_APP_BUNDLE !== "1") {
  console.log("app-update: skipped (not a production deploy)");
  process.exit(0);
}

const ref = (String(process.env.VITE_SUPABASE_URL || "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
const origin = SITES[ref];
if (!origin) {
  console.log(`app-update: skipped (no app site for Supabase project ${ref || "unknown"})`);
  process.exit(0);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const minNative = (pkg.ordanisApp && pkg.ordanisApp.minNative) || "1.0";

const run = spawnSync("npx", ["vite", "build", "--mode", "app", "--outDir", "dist-app", "--emptyOutDir"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_HIDE_SIGNUP: "1",
    VITE_BRAND_TAGLINE: "PRIVATE WEALTH ADMINISTRATION",
    VITE_WEB_PORTAL_URL: origin,
    ...(ref === DEMO_REF ? { VITE_BRAND_RUNTIME: "" } : {}),
  },
});
if (run.status !== 0) {
  // Never fail the website deploy over the phone bundle: phones just keep the copy they have.
  console.error("app-update: app build failed; website deploy continues without a phone update");
  process.exit(0);
}

const build = JSON.parse(readFileSync("dist-app/version.json", "utf8")).build;
const files = {};
// Folders get their own entries, written before their files: the app's unzipper (the update plugin) can't create a
// folder from a file path alone ("The file 'resources' couldn't be saved").
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const rel = relative("dist-app", p).split("\\").join("/");
    if (statSync(p).isDirectory()) { files[`${rel}/`] = new Uint8Array(0); walk(p); }
    else files[rel] = readFileSync(p);
  }
};
walk("dist-app");
// The old PCM PDFs (public/Resources and public/resources) are website downloads the app never uses. Two folders that
// differ only in capital letters can't both exist on a phone, and unpacking failed on exactly that, so they stay out.
for (const k of Object.keys(files)) if (/^resources\//i.test(k)) delete files[k];
// Any other pair like that would fail the same way on every phone: publish nothing rather than a broken update.
const seen = new Map();
for (const k of Object.keys(files)) {
  const low = k.toLowerCase();
  if (seen.has(low)) {
    console.error(`app-update: "${seen.get(low)}" and "${k}" differ only in capital letters; phone update skipped`);
    process.exit(0);
  }
  seen.set(low, k);
}
if (!files["index.html"]) {
  console.error("app-update: dist-app has no index.html; skipped");
  process.exit(0);
}
const zip = zipSync(files, { level: 9 });
const checksum = createHash("sha256").update(zip).digest("hex");

mkdirSync("dist/app-update", { recursive: true });
writeFileSync(`dist/app-update/${build}.zip`, zip);
writeFileSync("dist/app-update/latest.json", JSON.stringify({
  build,
  url: `${origin}/app-update/${build}.zip`,
  checksum,
  minNative,
  builtAt: new Date().toISOString(),
}));
rmSync("dist-app", { recursive: true, force: true });
console.log(`app-update: published ${build} for ${origin} (${(zip.length / 1048576).toFixed(1)} MB, sha256 ${checksum.slice(0, 12)}…)`);
