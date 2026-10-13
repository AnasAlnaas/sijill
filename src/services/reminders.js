// Keeps the phone's alarms in step with the notes' reminders, and applies
// Done / Snooze taps that happened in notifications (even while the app was closed).

import { reminders as native } from '../native.js';
import { nextAlert, repeatOf } from '../core/recurrence.js';
import { displayTitle, noteToPlainText } from '../core/model.js';
import { t } from '../i18n.js';

let store;
let timer = null;
let lastSig = '';

export function initReminders(s) {
  store = s;
  store.addEventListener('change', (e) => {
    const d = e.detail || {};
    if (d.notes || d.settings?.includes('lang') || d.settings?.includes('snoozeMinutes')) schedule();
  });
  native.onEvent((ev) => applyEvents([ev]));
  schedule(0);
}

function schedule(delay = 600) {
  clearTimeout(timer);
  timer = setTimeout(sync, delay);
}

export async function sync() {
  if (!store) return;
  const now = Date.now();
  const items = [];
  for (const n of store.allNotes()) {
    if (!n.reminder || n.trashedAt) continue;
    const at = nextAlert(n.reminder, now);
    if (!at) continue;
    // With no title the first line becomes the title, so the text starts after it.
    let body = noteToPlainText({ ...n, title: '' });
    if (!n.title.trim()) body = body.split('\n').slice(1).join('\n').trim();
    body = body.slice(0, 240);
    items.push({ id: n.id, at, start: n.reminder.at, repeat: repeatOf(n.reminder), title: displayTitle(n) || t('appName'), body });
  }
  const strings = { snooze: t('notifSnooze'), done: t('notifDone'), channel: t('reminders'), snoozeMinutes: store.settings.snoozeMinutes };
  const sig = JSON.stringify([items, strings]);
  if (sig === lastSig) return;
  lastSig = sig;
  try {
    await native.sync(items, strings);
  } catch (e) {
    lastSig = '';
    console.warn('reminder sync failed', e);
  }
}

/** events: [{ noteId, action: 'done' | 'snooze', at, until }] */
export function applyEvents(events) {
  for (const ev of events) {
    const n = store.get(ev.noteId);
    if (!n?.reminder) continue;
    if (ev.action === 'done') {
      const patch = repeatOf(n.reminder) === 'none'
        ? { ...n.reminder, doneAt: ev.at || Date.now(), snoozedUntil: null }
        : { ...n.reminder, snoozedUntil: null };
      store.updateNote(n.id, { reminder: patch }, { touch: false });
    } else if (ev.action === 'snooze' && ev.until) {
      store.updateNote(n.id, { reminder: { ...n.reminder, snoozedUntil: ev.until } }, { touch: false });
    }
  }
}

export async function collectEvents() {
  try {
    applyEvents(await native.takeEvents());
  } catch { /* nothing to collect */ }
}

export const permission = {
  status: () => native.status(),
  request: () => native.request(),
};
