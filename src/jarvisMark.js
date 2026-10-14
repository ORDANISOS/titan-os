// Jarvis mark: the hub's gold core, at rest, as a standalone SVG.
//
// Same geometry as the animated Core in Hub.jsx (400x400 viewBox): a 72-tick outer ring,
// a dashed ring, a heavy arc ring, a dotted ring, the dark disc and the glowing orb with
// the ORDANIS "O". Used for the logo downloads (SVG and PNG) on the hub.
//
// The assistant's name lives here too so a rename is one line.

export const ASSISTANT_NAME = "Jarvis";

const GOLD = "#C9A961";
const NAVY = "#0A2540";

export function jarvisMarkSvg({ background = true, size = 1024 } = {}) {
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const major = i % 6 === 0;
    return `<line x1="200" y1="8" x2="200" y2="${major ? 24 : 16}" stroke="${GOLD}" stroke-opacity="${major ? 0.9 : 0.4}" stroke-width="${major ? 2 : 1}" transform="rotate(${i * 5} 200 200)"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${background ? "-20 -20 440 440" : "0 0 400 400"}" width="${size}" height="${size}">
<title>${ASSISTANT_NAME} by ORDANIS</title>
<defs>
  <radialGradient id="jvBg" cx="50%" cy="45%" r="70%"><stop offset="0%" stop-color="${NAVY}"/><stop offset="100%" stop-color="#041220"/></radialGradient>
  <radialGradient id="jvOrb" cx="50%" cy="45%" r="55%"><stop offset="0%" stop-color="#fff6dc"/><stop offset="35%" stop-color="${GOLD}"/><stop offset="100%" stop-color="${NAVY}" stop-opacity="0"/></radialGradient>
  <filter id="jvGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
${background ? `<rect x="-20" y="-20" width="440" height="440" fill="url(#jvBg)"/>` : ""}
<g filter="url(#jvGlow)">
  <g transform="rotate(-8 200 200)">${ticks}</g>
  <circle cx="200" cy="200" r="160" fill="none" stroke="${GOLD}" stroke-opacity="0.55" stroke-width="2" stroke-dasharray="120 40 20 40" transform="rotate(-100 200 200)"/>
  <circle cx="200" cy="200" r="132" fill="none" stroke="${GOLD}" stroke-opacity="0.8" stroke-width="5" stroke-dasharray="60 210" stroke-linecap="round" transform="rotate(-150 200 200)"/>
  <circle cx="200" cy="200" r="132" fill="none" stroke="${GOLD}" stroke-opacity="0.25" stroke-width="1"/>
  <circle cx="200" cy="200" r="104" fill="none" stroke="${GOLD}" stroke-opacity="0.6" stroke-width="1.5" stroke-dasharray="4 8"/>
  <circle cx="200" cy="200" r="84" fill="#041220" fill-opacity="0.9" stroke="${GOLD}" stroke-opacity="0.5"/>
  <circle cx="200" cy="200" r="62" fill="url(#jvOrb)" opacity="0.9"/>
</g>
<text x="200" y="207" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="20" fill="${NAVY}">O</text>
</svg>`;
}

// Downloads the mark. kind: "svg" | "png" (PNG is drawn at `size` pixels in the browser).
export async function downloadJarvisMark(kind = "png", size = 1024) {
  const svg = jarvisMarkSvg({ size });
  const name = `${ASSISTANT_NAME.toLowerCase()}-ordanis-mark`;
  const save = (href, filename) => {
    const a = document.createElement("a");
    a.href = href; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  };
  if (kind === "svg") {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    save(url, `${name}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const img = new Image();
  const src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = src; });
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  canvas.getContext("2d").drawImage(img, 0, 0, size, size);
  URL.revokeObjectURL(src);
  save(canvas.toDataURL("image/png"), `${name}-${size}.png`);
}
