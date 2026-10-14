// A deliberately narrow lint config: does every identifier actually resolve?
//
// WHY THIS EXISTS
//
// Vite bundles App.jsx without checking whether an identifier is defined. A refactor
// deleted 78 lines out of buildFamilySnapshot — the document-contents block, family
// members, service providers, the net-worth totals and `const notTracked` — and the
// function went on returning nine names that no longer existed. `npm run build`
// succeeded three times in a row and three commits shipped with the AI snapshot broken.
// The family card called it on mount, threw a ReferenceError, and rendered nothing.
//
// Tests did not catch it either: the rollup logic is mirrored in docs/*.mjs, so the
// suites passed while the real function was in pieces.
//
// So this checks the one thing that was silently wrong. It is not a style config and
// deliberately enables almost nothing else — a noisy lint gets ignored, and an ignored
// lint would not have caught this.
//
// Run: npm run lint:undef
export default [{
  files: ["src/**/*.jsx", "src/**/*.js"],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
    globals: {
      window: "readonly", document: "readonly", console: "readonly", fetch: "readonly",
      navigator: "readonly", localStorage: "readonly", sessionStorage: "readonly",
      setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly",
      clearInterval: "readonly", requestAnimationFrame: "readonly",
      cancelAnimationFrame: "readonly", performance: "readonly",
      Blob: "readonly", URL: "readonly", File: "readonly", FileReader: "readonly",
      Intl: "readonly", crypto: "readonly", TextDecoder: "readonly", TextEncoder: "readonly",
      atob: "readonly", btoa: "readonly", Image: "readonly", alert: "readonly",
      confirm: "readonly", prompt: "readonly", location: "readonly", history: "readonly",
      caches: "readonly", process: "readonly", structuredClone: "readonly",
      URLSearchParams: "readonly",
    },
  },
  // Directives for rules this config does not load (react-hooks/exhaustive-deps) are
  // correct under the project's fuller lint setup and must not be reported here.
  linterOptions: { reportUnusedDisableDirectives: false },
  // ESLint 9 reports a disable comment that names a rule it has never heard of. The react-hooks rule is
  // registered here as an inert stub (never switched on) so those comments resolve without loading the
  // whole plugin.
  plugins: { "react-hooks": { rules: { "exhaustive-deps": { create: () => ({}) } } } },
  rules: {
    "no-undef": "error",
    // A duplicate declaration in one scope is the other half of a botched refactor.
    "no-redeclare": "error",
    "no-dupe-keys": "error",
    "no-dupe-args": "error",
    // An unreachable return usually means a function was cut in the wrong place.
    "no-unreachable": "error",
  },
}];
