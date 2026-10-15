// The monthly journal: one note per month (in the reader's calendar), listed by year.
// "Write" opens this month's note, creating it the first time.

import { h } from './dom.js';
import { icon } from './icons.js';
import { openSheet, toast } from './overlays.js';
import { renderCard } from './cards.js';
import { openEditor, currentEditor } from './editor.js';
import { exportJournalYear } from './export.js';
import { store } from '../state.js';
import { t } from '../i18n.js';
import { monthLabel, yearLabel, time as fmtTime, num } from '../core/format.js';
import { journalCalendar, monthKey, isMonth, compareMonths } from '../core/journal.js';
import { permission } from '../services/reminders.js';

export const cal = () => journalCalendar(store.settings.calendar);

export function journalNotes() {
  return store.allNotes().filter((n) => n.journal && !n.trashedAt);
}

export function thisMonthEntry() {
  const key = monthKey(Date.now(), cal());
  return journalNotes().find((n) => isMonth(n, key)) || null;
}

/** Open this month's entry (creating it), optionally starting dictation. */
export function openJournalEntry({ dictate = false } = {}) {
  const now = Date.now();
  let n = thisMonthEntry();
  if (!n) {
    const key = monthKey(now, cal());
    n = store.createNote({ type: 'note', title: t('journalEntryTitle', { month: monthLabel(now, key.cal) }), journal: key });
  }
  openEditor(n.id, { focus: dictate ? null : 'body' });
  if (dictate) currentEditor()?.startDictation();
  return n;
}

/** The Journal screen's content (below the page heading). */
export function journalView() {
  const now = Date.now();
  const month = monthLabel(now, cal());
  const existing = thisMonthEntry();
  const parts = [
    h('button', { class: 'btn primary wide journal-write', onclick: () => openJournalEntry() },
      icon(existing ? 'edit' : 'plus', { size: 22 }), existing ? t('continueMonth', { month }) : t('writeMonth', { month })),
    reminderRow(),
  ];
  // Same calendar: by month. Entries from before a calendar change: by when they were written.
  const notes = journalNotes().sort((a, b) => (a.journal.cal === b.journal.cal ? compareMonths(a, b) : b.createdAt - a.createdAt));
  if (!notes.length) {
    parts.push(h('p', { class: 'empty' }, t('emptyJournal')));
    return parts;
  }
  // Group by year (each entry keeps the calendar it was written in).
  const years = new Map();
  for (const n of notes) {
    const k = `${n.journal.cal}:${n.journal.year}`;
    if (!years.has(k)) years.set(k, []);
    years.get(k).push(n);
  }
  for (const [k, list] of years) {
    const [c, y] = k.split(':');
    const label = yearLabel(Number(y), c);
    parts.push(h('div', { class: 'section-h year-h' },
      h('span', { class: 'grow' }, label),
      h('button', { class: 'btn quiet small', onclick: () => exportJournalYear(list, label) }, icon('pdf', { size: 18 }), t('exportYear', { year: label }))));
    parts.push(h('div', { class: 'cards' }, list.map((n) => h('div', { class: 'card-wrap' }, renderCard(n, {})))));
  }
  return parts;
}

// --- monthly reminder ------------------------------------------------------------------------

function reminderText() {
  const r = store.settings.journalReminder;
  if (!r?.on) return t('journalReminderOff');
  const [hh, mm] = r.time.split(':').map(Number);
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return t('journalReminderOn', { day: r.day, time: fmtTime(d.getTime()) });
}

function reminderRow() {
  const on = Boolean(store.settings.journalReminder?.on);
  return h('button', { class: 'set-row-btn', onclick: () => reminderSheet() },
    icon(on ? 'bellAlert' : 'bell'), h('span', { class: 'grow' }, reminderText()), icon('chevronEnd', { size: 20 }));
}

function reminderSheet() {
  const cur = store.settings.journalReminder || { on: false, day: 1, time: '20:00' };
  openSheet((sheet, close) => {
    const daySel = h('select', { class: 'input', 'aria-label': t('dayOfMonth') },
      Array.from({ length: 28 }, (_, i) => h('option', { value: String(i + 1), selected: cur.day === i + 1 }, num(i + 1))));
    const timeIn = h('input', { class: 'input', type: 'time', dir: 'ltr', value: cur.time, 'aria-label': t('pickTime') });
    const calName = cal() === 'hijri' ? t('calHijri') : t('calGregory');
    sheet.append(
      h('h2', null, t('journalReminder')),
      h('p', { class: 'help' }, t('journalReminderHelp', { cal: calName })),
      h('div', { class: 'row2' },
        h('div', { class: 'field' }, h('label', null, t('dayOfMonth')), daySel),
        h('div', { class: 'field' }, h('label', null, t('pickTime')), timeIn)),
      h('div', { class: 'sheet-actions' },
        cur.on ? h('button', { class: 'btn', onclick: () => { store.set('journalReminder', { ...cur, on: false }); close(); } }, t('turnOff')) : null,
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            store.set('journalReminder', { on: true, day: Number(daySel.value), time: timeIn.value || '20:00' });
            close();
            const s = await permission.status().catch(() => null);
            if (s && s.notifications !== 'granted') await permission.request().catch(() => {});
            toast(reminderText());
          },
        }, t('setReminder'))));
  }, { label: t('journalReminder') });
}

