// Works out the accent colours for every theme, from a hue and a target brightness.
// Accents are chosen by luminance first, so they stand out in grayscale and keep text
// contrast at 7:1 (WCAG AAA). Run: node scripts/palette.js  → prints CSS.

const ACCENTS = {
  blue: 258, // ink blue
  teal: 190, // verdigris
  saffron: 72,
  red: 25, // carmine
};

// Target relative luminance for each use.
const TARGETS = {
  fill: 0.40, // selection, current place, main button: dark ink text on top stays >= 7:1
  inkLight: 0.07, // accent text/links on light paper (>= 7:1)
  inkDark: 0.46, // accent text/links on dark surfaces (>= 7:1)
  markLight: 0.62, // search-match highlight behind ink, light theme
  markDark: 0.55, // search-match highlight behind dark text, dark themes
};

function oklchToSrgb(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb) => rgb.every((v) => v >= -0.0001 && v <= 1.0001);

function toHex(rgb) {
  return '#' + rgb.map((v) => {
    const c = Math.max(0, Math.min(1, v));
    const s = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(s * 255).toString(16).padStart(2, '0');
  }).join('');
}

export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Find the most colourful in-gamut colour at this hue whose luminance is the target.
function pick(hue, target, maxChroma = 0.16) {
  let best = null;
  for (let C = maxChroma; C >= 0; C -= 0.005) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const hex = toHex(oklchToSrgb(mid, C, hue));
      if (luminance(hex) < target) lo = mid;
      else hi = mid;
    }
    const rgb = oklchToSrgb(hi, C, hue);
    if (inGamut(rgb)) {
      best = toHex(rgb);
      break;
    }
  }
  return best;
}

export function accents() {
  const out = {};
  for (const [name, hue] of Object.entries(ACCENTS)) {
    out[name] = {
      fill: pick(hue, TARGETS.fill, 0.12),
      inkLight: pick(hue, TARGETS.inkLight, 0.14),
      inkDark: pick(hue, TARGETS.inkDark, 0.12),
      markLight: pick(hue, TARGETS.markLight, 0.08),
      markDark: pick(hue, TARGETS.markDark, 0.09),
    };
  }
  return out;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('palette.js')) {
  console.log(JSON.stringify(accents(), null, 2));
}
