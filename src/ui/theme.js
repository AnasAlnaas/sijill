// Applies appearance settings: theme, accent, language and direction, text size, fonts,
// numerals and calendar. Also caches them for the next start so nothing flashes.

import { setLang, t } from '../i18n.js';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { setShortcuts, isNative } from '../native.js';
import { setFormatPrefs } from '../core/format.js';

let systemFontScale = 1;
let lastShortcutLang = null;
const media = matchMedia('(prefers-color-scheme: dark)');

export function setSystemFontScale(s) {
  systemFontScale = Number(s) > 0 ? Number(s) : 1;
}

export function resolvedTheme(theme) {
  if (theme === 'system') return media.matches ? 'dark' : 'light';
  return theme;
}

export function applyAppearance(s) {
  const r = document.documentElement;
  const theme = resolvedTheme(s.theme);
  r.dataset.theme = theme;
  r.dataset.accent = s.accent || 'none';
  // Status and navigation bar icons: dark on paper, light on the dark themes.
  if (isNative) SystemBars.setStyle({ style: theme === 'light' ? SystemBarsStyle.Light : SystemBarsStyle.Dark }).catch(() => {});
  r.dataset.read = s.readingFont || 'naskh';
  r.lang = s.lang;
  r.dir = s.lang === 'ar' ? 'rtl' : 'ltr';
  const px = Math.round(16 * systemFontScale * (s.textScale || 1) * 10) / 10;
  r.style.fontSize = `${px}px`;
  setLang(s.lang);
  setFormatPrefs({ lang: s.lang, numerals: s.numerals, calendar: s.calendar });
  if (s.lang !== lastShortcutLang) {
    lastShortcutLang = s.lang;
    setShortcuts([
      { action: 'newNote', label: t('newNote') },
      { action: 'newChecklist', label: t('newChecklist') },
      { action: 'voiceNote', label: t('voiceNote') },
    ]);
  }
  const meta = document.querySelector('meta[name="theme-color"]') || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }));
  meta.content = getComputedStyle(r).getPropertyValue('--bg').trim();
  try {
    localStorage.setItem('sijill.boot', JSON.stringify({ theme: s.theme, accent: s.accent, lang: s.lang, fontPx: px }));
  } catch { /* private mode */ }
}

export function onSystemThemeChange(fn) {
  media.addEventListener('change', fn);
}
