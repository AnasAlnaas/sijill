// Builds the app icon options from glyph outlines (shaped with fontkit from the bundled fonts).
// Usage: node scripts/icons.js <amiri.json> <naskh.json>  → design/icon-*.svg and design/icons.html
import fs from 'node:fs';

const [amiri, naskh] = process.argv.slice(2).map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));

// Fit a word into a box centred in the 108×108 adaptive-icon canvas (safe zone: 66 circle).
function word(g, box, cx = 54, cy = 54) {
  const w = g.bbox.maxX - g.bbox.minX;
  const h = g.bbox.maxY - g.bbox.minY;
  const s = Math.min(box / w, box / h);
  const tx = cx - (g.bbox.minX + w / 2) * s;
  const ty = cy + (g.bbox.minY + h / 2) * s;
  return { transform: `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(5)} ${(-s).toFixed(5)})`, d: g.d };
}

const PAPER = '#F3F2EE';
const INK = '#161513';

export const options = {
  wordmark: (() => {
    const w = word(amiri, 58, 54, 52);
    return { name: 'A — Wordmark (Amiri, classic Naskh)', bg: PAPER, fg: INK, fgSvg: `<path fill="${INK}" transform="${w.transform}" d="${w.d}"/>` };
  })(),
  scroll: {
    name: 'B — Rolled scroll',
    bg: PAPER,
    fg: INK,
    fgSvg: `<g fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M37 34v40M71 34v40"/>
      <rect x="30" y="27" width="48" height="8" rx="4" fill="${PAPER}"/>
      <rect x="30" y="73" width="48" height="8" rx="4" fill="${PAPER}"/>
      <path d="M63 46H46M63 54H42M63 62H51"/>
    </g>`,
  },
  inverse: (() => {
    const w = word(naskh, 60, 54, 55);
    return { name: 'C — Wordmark on black (Noto Naskh, modern)', bg: INK, fg: PAPER, fgSvg: `<path fill="${PAPER}" transform="${w.transform}" d="${w.d}"/>` };
  })(),
};

function iconSvg(o, size, shape = 'squircle') {
  const clip = shape === 'circle' ? '<circle cx="54" cy="54" r="54"/>' : '<path d="M54 0C88 0 108 20 108 54S88 108 54 108 0 88 0 54 20 0 54 0Z"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="${size}" height="${size}" role="img"><defs><clipPath id="c${size}${shape}">${clip}</clipPath></defs><g clip-path="url(#c${size}${shape})"><rect width="108" height="108" fill="${o.bg}"/>${o.fgSvg}</g><path d="${shape === 'circle' ? 'M54 .5a53.5 53.5 0 1 1 0 107 53.5 53.5 0 0 1 0-107Z' : 'M54 .5C87.6.5 107.5 20.4 107.5 54S87.6 107.5 54 107.5.5 87.6.5 54 20.4.5 54 .5Z'}" fill="none" stroke="rgba(0,0,0,.18)"/></svg>`;
}

for (const [key, o] of Object.entries(options)) {
  fs.writeFileSync(`design/icon-${key}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><rect width="108" height="108" fill="${o.bg}"/>${o.fgSvg}</svg>\n`);
}

const card = (o) => `<figure>
  <div class="row">${iconSvg(o, 120)}${iconSvg(o, 64, 'circle')}${iconSvg(o, 44)}</div>
  <div class="row home"><div class="tile">${iconSvg(o, 56)}<span>سِجِلّ</span></div><div class="tile dark">${iconSvg(o, 56, 'circle')}<span>سِجِلّ</span></div></div>
  <figcaption>${o.name}</figcaption>
</figure>`;

fs.writeFileSync('design/icons.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sijill icon options</title>
<style>
:root{--bg:#f3f2ee;--ink:#161513;--ink2:#47453f;--line:#d6d4cc;--card:#fbfaf7}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#1a1a1c;--ink:#e8e5de;--ink2:#bdb9b1;--line:#3b3b40;--card:#222225}}
:root[data-theme=dark]{--bg:#1a1a1c;--ink:#e8e5de;--ink2:#bdb9b1;--line:#3b3b40;--card:#222225}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif;padding:24px 16px}
h1{font-size:20px;margin:0 0 4px} p{color:var(--ink2);margin:0 0 20px;max-width:46rem}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
.row{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.home{margin-top:14px;gap:10px}
.tile{display:grid;justify-items:center;gap:6px;padding:12px 16px;border-radius:12px;background:#d9d6cf;color:#161513;font-size:13px}
.tile.dark{background:#2a2a2e;color:#eee}
figcaption{margin-top:12px;font-weight:600}
.gray{filter:grayscale(1)}
</style></head><body>
<h1>سِجِلّ — app icon options</h1>
<p>Each option is shown at launcher sizes, in a rounded-square and a circle mask (phones differ), and on a light and a dark home screen. All three are pure black and white, so they look the same with your grayscale filter on. On Android 13 the "themed icons" setting will also get a one-colour version of whichever you pick.</p>
<div class="grid">${Object.values(options).map(card).join('\n')}</div>
</body></html>`);
console.log('ok');

// Android: adaptive-icon foreground (also used as the monochrome layer and the splash icon).
const pick = process.env.SIJILL_ICON || 'wordmark';
const chosen = options[pick];
if (chosen && pick !== 'scroll') {
  const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+) ([-\d.]+)\)/.exec(chosen.fgSvg);
  const d = /d="([^"]+)"/.exec(chosen.fgSvg)[1];
  const fill = pick === 'inverse' ? '#FFF3F2EE' : '#FF161513';
  const xml = (color) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/icons.js (${chosen.name}). -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <group android:translateX="${m[1]}" android:translateY="${m[2]}" android:scaleX="${m[3]}" android:scaleY="${m[4]}">
        <path android:fillColor="${color}" android:pathData="${d}"/>
    </group>
</vector>
`;
  const res = 'android/app/src/main/res';
  fs.writeFileSync(`${res}/drawable/ic_sijill_foreground.xml`, xml(fill));
  fs.writeFileSync(`${res}/drawable/ic_sijill_mono.xml`, xml('#FF000000'));
  fs.writeFileSync(`${res}/values/ic_launcher_background.xml`, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${pick === 'inverse' ? '#161513' : '#F3F2EE'}</color>\n</resources>\n`);
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_sijill_foreground"/>
    <monochrome android:drawable="@drawable/ic_sijill_mono"/>
</adaptive-icon>
`;
  fs.writeFileSync(`${res}/mipmap-anydpi-v26/ic_launcher.xml`, adaptive);
  fs.writeFileSync(`${res}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptive);
  console.log(`android icon: ${pick}`);
}
