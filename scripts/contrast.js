// Checks every theme × accent for contrast. Body text must reach 7:1 (WCAG AAA);
// large text and control borders have their own (lower) WCAG targets.
// Run: npm run contrast

import fs from 'node:fs';
import { contrast } from './palette.js';

const css = fs.readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

function block(selector) {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`missing ${selector}`);
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}

const base = block(':root {');
const themes = {
  light: base,
  dark: { ...base, ...block(":root[data-theme='dark'] {") },
  black: { ...base, ...block(":root[data-theme='black'] {") },
};
const accents = {
  none: {},
  blue: block(":root[data-accent='blue']"),
  teal: block(":root[data-accent='teal']"),
  saffron: block(":root[data-accent='saffron']"),
  red: block(":root[data-accent='red']"),
};
const darkAccents = {
  blue: block(":root:is([data-theme='dark'], [data-theme='black'])[data-accent='blue']"),
  teal: block(":root:is([data-theme='dark'], [data-theme='black'])[data-accent='teal']"),
  saffron: block(":root:is([data-theme='dark'], [data-theme='black'])[data-accent='saffron']"),
  red: block(":root:is([data-theme='dark'], [data-theme='black'])[data-accent='red']"),
};

const ON_ACCENT = '#121212';
let failures = 0;
const rows = [];

function check(theme, accent, label, fg, bg, min) {
  const r = contrast(fg, bg);
  const ok = r >= min;
  if (!ok) failures++;
  rows.push(`${ok ? 'ok  ' : 'FAIL'} ${theme.padEnd(6)} ${accent.padEnd(8)} ${label.padEnd(34)} ${r.toFixed(2).padStart(6)} (min ${min})`);
}

for (const [tn, t] of Object.entries(themes)) {
  for (const [an, a0] of Object.entries(accents)) {
    const a = { ...a0, ...(tn !== 'light' ? darkAccents[an] : {}) };
    const accentOn = an !== 'none';
    // Body and secondary text on every surface.
    for (const surf of ['bg', 'surface', 'raised']) {
      check(tn, an, `ink on ${surf}`, t.ink, t[surf], 7);
      check(tn, an, `ink-2 on ${surf}`, t['ink-2'], t[surf], 7);
    }
    // Main button, selection and search matches.
    const primary = accentOn ? a['a-fill'] : t.ink;
    const onPrimary = accentOn ? ON_ACCENT : t['on-ink'];
    check(tn, an, 'main button text', onPrimary, primary, 7);
    const sel = accentOn ? a['a-fill'] : t.sel;
    check(tn, an, 'text on selection', accentOn ? ON_ACCENT : t.ink, sel, 7);
    const mark = accentOn ? a['a-mark'] : t.mark;
    const onMark = accentOn ? ON_ACCENT : (t['on-mark'] || t.ink);
    check(tn, an, 'text on search match', onMark, mark, 7);
    // Links (always underlined too).
    const link = accentOn ? a['a-ink'] : t.ink;
    check(tn, an, 'link on surface', link, t.surface, 7);
    check(tn, an, 'link on bg', link, t.bg, 7);
    // Toast: inverted.
    check(tn, an, 'toast text', t['on-ink'], t.ink, 7);
    // Card edges must be easy to see in grayscale (WCAG 1.4.11 asks 3:1).
    check(tn, an, 'card edge on background', t['card-line'], t.bg, 3);
    // Borders of inputs and checkboxes (WCAG 1.4.11 asks 3:1).
    check(tn, an, 'control border on surface', t['line-strong'], t.surface, 3);
    check(tn, an, 'control border on raised', t['line-strong'], t.raised, 3);
  }
}

if (!process.argv.includes('--quiet')) console.log(rows.join('\n'));
console.log(failures ? `\n${failures} contrast failure(s)` : '\nAll contrast checks pass.');
process.exit(failures ? 1 : 0);
