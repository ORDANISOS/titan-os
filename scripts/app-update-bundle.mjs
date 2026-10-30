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
  },
});
if (run.status !== 0) {
  // Never fail the website deploy over the phone bundle: phones just keep the copy they have.
  console.error("app-update: app build failed; website deploy continues without a phone update");
  process.exit(0);
}

const build = JSON.parse(readFileSync("dist-app/version.json", "utf8")).build;
const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files[relative("dist-app", p).split("\\").join("/")] = readFileSync(p);
  }
};
walk("dist-app");
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
