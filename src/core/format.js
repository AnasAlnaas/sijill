// Numbers and dates in the reader's chosen style.
//   lang:     'ar' | 'en'            interface language
//   numerals: 'arab' | 'latn'        ٠١٢٣ or 0123
//   calendar: 'gregory' | 'hijri' | 'both'
// Hijri dates use the Umm al-Qura calendar built into the phone (ICU), so they work offline.

let prefs = { lang: 'ar', numerals: 'arab', calendar: 'gregory' };
const cache = new Map();

export function setFormatPrefs(p) {
  prefs = { ...prefs, ...p };
  cache.clear();
}

export function getFormatPrefs() {
  return prefs;
}

function locale(calendar) {
  const base = prefs.lang === 'ar' ? 'ar' : 'en-GB';
  return `${base}-u-nu-${prefs.numerals}${calendar === 'hijri' ? '-ca-islamic-umalqura' : '-ca-gregory'}`;
}

function fmt(calendar, opts) {
  const key = calendar + JSON.stringify(opts) + prefs.lang + prefs.numerals;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale(calendar), opts);
    cache.set(key, f);
  }
  return f;
}

/** A number (or "3/7"-like string of digits) in the chosen numerals. */
export function num(n) {
  const s = String(n);
  if (prefs.numerals !== 'arab') return s;
  return s.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
}

/** Checklist progress "3/7" (in Arabic, read right-to-left as ٣/٧ with the same meaning). */
export function fraction(done, total) {
  // An isolate keeps the fraction in reading order inside RTL text.
  return `⁨${num(done)}/${num(total)}⁩`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function time(ms) {
  return fmt('gregory', { hour: 'numeric', minute: '2-digit', hour12: prefs.lang === 'ar' ? true : undefined }).format(ms);
}

/** Calendar date only, e.g. "١٤ أكتوبر ٢٠٢٦" or "14 Oct 2026", in the chosen calendar(s). */
export function date(ms, { year = 'auto', weekday = false } = {}) {
  const d = new Date(ms);
  const showYear = year === 'always' || (year === 'auto' && d.getFullYear() !== new Date().getFullYear());
  const opts = { day: 'numeric', month: prefs.lang === 'ar' ? 'long' : 'short' };
  if (weekday) opts.weekday = 'long';
  const g = fmt('gregory', showYear ? { ...opts, year: 'numeric' } : opts).format(d);
  if (prefs.calendar === 'gregory') return g;
  const hOpts = { day: 'numeric', month: 'long', year: 'numeric' };
  if (weekday && prefs.calendar === 'hijri') hOpts.weekday = 'long';
  const hj = cleanHijri(fmt('hijri', hOpts).format(d));
  return prefs.calendar === 'hijri' ? hj : `${g} · ${hj}`;
}

// ICU appends an era ("هـ" / "AH"); keep it, but drop doubled spaces.
function cleanHijri(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/** Date and time, with "Today"/"Tomorrow"/"Yesterday" when close. */
export function dateTime(ms, { now = Date.now(), words } = {}) {
  const d = new Date(ms);
  const today = new Date(now);
  const t = time(ms);
  const rel = (offset) => {
    const x = new Date(today);
    x.setDate(x.getDate() + offset);
    return sameDay(d, x);
  };
  const sep = prefs.lang === 'ar' ? '،' : ',';
  if (words) {
    if (rel(0)) return `${words.today}${sep} ${t}`;
    if (rel(1)) return `${words.tomorrow}${sep} ${t}`;
    if (rel(-1)) return `${words.yesterday}${sep} ${t}`;
  }
  return `${date(ms)}${sep} ${t}`;
}

/** "Edited …" stamp for the editor footer: time if today, else the date. */
export function stamp(ms, now = Date.now()) {
  return sameDay(new Date(ms), new Date(now)) ? time(ms) : date(ms);
}

/** "جمادى الأولى ١٤٤٨ هـ" / "October 2026": a month in a given calendar (not the date setting). */
export function monthLabel(ms, cal) {
  const base = prefs.lang === 'ar' ? 'ar' : 'en-GB';
  const key = `month|${cal}|${prefs.lang}|${prefs.numerals}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(`${base}-u-nu-${prefs.numerals}-ca-${cal === 'hijri' ? 'islamic-umalqura' : 'gregory'}`, { month: 'long', year: 'numeric' });
    cache.set(key, f);
  }
  return f.format(ms).replace(/\s+/g, ' ').trim();
}

/** A year heading: "٢٠٢٦" or "١٤٤٨ هـ". */
export function yearLabel(year, cal) {
  if (cal !== 'hijri') return num(year);
  return prefs.lang === 'ar' ? `${num(year)} هـ` : `${num(year)} AH`;
}
