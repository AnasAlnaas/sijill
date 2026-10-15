// The monthly journal: one note per month, months counted in the reader's calendar
// (Hijri, using the Umm al-Qura calendar built into the phone, or Gregorian).
// A journal note carries journal: { cal, year, month } so it can be found again.

const fmts = new Map();

/** The calendar journal months follow: Hijri if chosen, otherwise Gregorian ("both" → Gregorian). */
export function journalCalendar(calendarSetting) {
  return calendarSetting === 'hijri' ? 'hijri' : 'gregory';
}

function parts(ms, cal) {
  let f = fmts.get(cal);
  if (!f) {
    f = new Intl.DateTimeFormat(`en-u-ca-${cal === 'hijri' ? 'islamic-umalqura' : 'gregory'}-nu-latn`, { year: 'numeric', month: 'numeric', day: 'numeric' });
    fmts.set(cal, f);
  }
  const out = {};
  for (const p of f.formatToParts(ms)) if (p.type === 'year' || p.type === 'month' || p.type === 'day') out[p.type] = Number(p.value);
  return out;
}

/** The calendar day/month/year of a moment (measured at midday, away from any DST change). */
export function calendarDate(ms, cal) {
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  return parts(d.getTime(), cal);
}

export function monthKey(ms, cal) {
  const { year, month } = calendarDate(ms, cal);
  return { cal, year, month };
}

export function isMonth(note, key) {
  const j = note.journal;
  return Boolean(j) && j.cal === key.cal && j.year === key.year && j.month === key.month;
}

/** Order: newest month first. */
export function compareMonths(a, b) {
  return (b.journal.year - a.journal.year) || (b.journal.month - a.journal.month);
}

/**
 * The next `count` times a monthly reminder fires: day `day` (1–28) of each month in `cal`,
 * at "HH:MM", strictly after `from`.
 */
export function monthlyOccurrences({ day, time }, cal, from = Date.now(), count = 12) {
  const [hh, mm] = String(time || '20:00').split(':').map(Number);
  const out = [];
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 31 * (count + 2) && out.length < count; i++) {
    if (calendarDate(d.getTime(), cal).day === day) {
      const at = new Date(d);
      at.setHours(hh, mm || 0, 0, 0);
      if (at.getTime() > from) out.push(at.getTime());
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}
