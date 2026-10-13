// Sheets opened from a note: marker shape, labels, reminder, version history.

import { h, fill } from './dom.js';
import { icon, markerIcon } from './icons.js';
import { openSheet, toast } from './overlays.js';
import { MARKERS, noteToPlainText } from '../core/model.js';
import { REPEATS, repeatOf, displayTime } from '../core/recurrence.js';
import { dateTime, date, time } from '../core/format.js';
import { t, markerName } from '../i18n.js';
import { store } from '../state.js';
import { permission } from '../services/reminders.js';

// --- marker -------------------------------------------------------------------------------------

export function markerSheet(current, onPick) {
  openSheet((sheet, close) => {
    sheet.append(h('h2', null, t('marker')), h('p', { class: 'help' }, t('markerHelp')));
    const grid = h('div', { class: 'marker-grid', role: 'radiogroup', 'aria-label': t('marker') });
    for (const m of [null, ...MARKERS]) {
      grid.append(h('button', {
        class: 'marker-opt',
        role: 'radio',
        'aria-checked': String((current || null) === m),
        'aria-pressed': String((current || null) === m),
        onclick: () => {
          onPick(m);
          close();
        },
      }, markerIcon(m, { size: 24 }), h('span', null, markerName(m))));
    }
    sheet.append(grid);
  }, { label: t('marker') });
}

// --- labels -------------------------------------------------------------------------------------

export function labelsSheet(selectedIds, onChange) {
  const selected = new Set(selectedIds);
  openSheet((sheet, close) => {
    const input = h('input', { class: 'input', placeholder: t('labelName'), dir: 'auto', enterkeyhint: 'done', 'aria-label': t('labelName') });
    const list = h('div', { class: 'sheet-list', role: 'group' });
    const render = () => {
      const q = input.value.trim();
      const ql = q.toLowerCase();
      const labels = store.allLabels().filter((l) => !ql || l.name.toLowerCase().includes(ql));
      fill(list, labels.map((l) => h('button', {
        class: 'sheet-item',
        role: 'checkbox',
        'aria-checked': String(selected.has(l.id)),
        onclick: () => {
          if (selected.has(l.id)) selected.delete(l.id);
          else selected.add(l.id);
          onChange([...selected]);
          render();
        },
      }, h('span', { class: 'checkbox-ico' }, icon(selected.has(l.id) ? 'boxChecked' : 'boxEmpty')), h('span', { class: 'grow', dir: 'auto' }, l.name))));
      if (q && !store.findLabel(q)) {
        list.append(h('button', {
          class: 'sheet-item',
          onclick: () => {
            const l = store.createLabel(q);
            if (l) {
              selected.add(l.id);
              onChange([...selected]);
            }
            input.value = '';
            render();
          },
        }, icon('plus'), h('span', { class: 'grow', dir: 'auto' }, t('createLabel', { name: q }))));
      }
      if (!list.childNodes.length) list.append(h('p', { class: 'help' }, t('noLabels')));
    };
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = input.value.trim();
        if (!q) return close();
        const l = store.findLabel(q) || store.createLabel(q);
        if (l) {
          selected.add(l.id);
          onChange([...selected]);
        }
        input.value = '';
        render();
      }
    });
    render();
    sheet.append(h('h2', null, t('labelsTitle')), h('div', { class: 'field' }, input), list,
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary', onclick: close }, t('done'))));
  }, { label: t('labelsTitle') });
}

// --- reminder -----------------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const toDateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function quickTimes(now = new Date()) {
  const out = [];
  const later = new Date(now);
  if (now.getHours() < 17) later.setHours(18, 0, 0, 0);
  else if (now.getHours() < 20) later.setHours(21, 0, 0, 0);
  else later.setTime(0);
  if (later.getTime()) out.push(['laterToday', later]);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  out.push(['tomorrowMorning', tomorrow]);
  const week = new Date(now);
  week.setDate(now.getDate() + 7);
  week.setHours(8, 0, 0, 0);
  out.push(['nextWeek', week]);
  return out;
}

export function reminderSheet(note, onSave) {
  const r = note.reminder;
  const start = r ? new Date(displayTime(r) || r.at) : (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    return d;
  })();
  let repeat = repeatOf(r);

  openSheet((sheet, close) => {
    const notice = h('div');
    permission.status().then((s) => {
      if (s.notifications !== 'granted') {
        fill(notice, h('div', { class: 'notice' }, icon('bellAlert'), h('span', { class: 'grow' }, t('allowNotifications')),
          h('button', {
            class: 'btn',
            onclick: async () => {
              const after = await permission.request();
              if (after.notifications === 'granted') fill(notice);
            },
          }, t('allow'))));
      }
    }).catch(() => {});

    const dateIn = h('input', { class: 'input', type: 'date', dir: 'ltr', value: toDateInput(start), 'aria-label': t('pickDate') });
    const timeIn = h('input', { class: 'input', type: 'time', dir: 'ltr', value: toTimeInput(start), 'aria-label': t('pickTime') });
    const error = h('p', { class: 'help', role: 'alert' });

    const save = (when) => {
      if (when <= Date.now()) {
        error.textContent = t('reminderInPast');
        return;
      }
      onSave({ at: when, repeat });
      close();
    };
    const readInputs = () => {
      const [y, m, d] = dateIn.value.split('-').map(Number);
      const [hh, mm] = timeIn.value.split(':').map(Number);
      if (!y || Number.isNaN(hh)) return null;
      return new Date(y, m - 1, d, hh, mm || 0, 0, 0).getTime();
    };

    const quick = h('div', { class: 'quick' }, quickTimes().map(([key, d]) => h('button', {
      onclick: () => save(d.getTime()),
    }, h('span', null, t(key)), h('span', null, dateTime(d.getTime(), { words: { today: t('today'), tomorrow: t('tomorrow'), yesterday: t('yesterday') } })))));

    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': t('repeat') });
    const renderSeg = () => fill(seg, REPEATS.map((rp) => h('button', {
      role: 'radio',
      'aria-checked': String(repeat === rp),
      onclick: () => {
        repeat = rp;
        renderSeg();
      },
    }, icon('check', { size: 18 }), t(`repeat${rp[0].toUpperCase()}${rp.slice(1)}`))));
    renderSeg();

    sheet.append(
      h('h2', null, t('reminderTitle')),
      notice,
      quick,
      h('div', { class: 'row2', style: { marginBlockStart: '1rem' } },
        h('div', { class: 'field' }, h('label', null, t('pickDate')), dateIn),
        h('div', { class: 'field' }, h('label', null, t('pickTime')), timeIn)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('repeat')), seg),
      error,
      h('div', { class: 'sheet-actions' },
        r ? h('button', { class: 'btn', onclick: () => { onSave(null); close(); } }, icon('close', { size: 20 }), t('removeReminder')) : null,
        h('button', { class: 'btn primary', onclick: () => { const w = readInputs(); if (w) save(w); } }, t('setReminder'))),
    );
  }, { label: t('reminderTitle') });
}

// --- history ------------------------------------------------------------------------------------

function peek(v) {
  const text = noteToPlainText({ type: v.type, title: v.title, body: v.body, items: v.items }).replace(/\s+/g, ' ').trim();
  return text.slice(0, 140) || '—';
}

export function historySheet(noteId, onRestored) {
  openSheet(async (sheet, close) => {
    const body = h('div', null, h('p', { class: 'help' }, t('working')));
    sheet.append(h('h2', null, t('historyTitle')), body);
    const versions = await store.versions(noteId);
    const showList = () => {
      if (!versions.length) {
        fill(body, h('p', { class: 'help' }, t('historyEmpty')));
        return;
      }
      fill(body, versions.map((v) => h('button', { class: 'version', onclick: () => showOne(v) },
        h('span', { class: 'when' }, `${date(v.savedAt, { year: 'auto' })} · ${time(v.savedAt)}`),
        h('span', { class: 'peek', dir: 'auto' }, peek(v.data)))));
    };
    const showOne = (v) => {
      fill(body,
        h('p', { class: 'help' }, `${date(v.savedAt, { year: 'always', weekday: true })} · ${time(v.savedAt)}`),
        h('div', { class: 'version-view', dir: 'auto' }, noteToPlainText(v.data)),
        h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn', onclick: showList }, icon('back', { size: 20 }), t('back')),
          h('button', {
            class: 'btn primary',
            onclick: () => {
              store.restoreVersion(noteId, v);
              close();
              toast(t('toastVersionRestored'));
              onRestored?.();
            },
          }, icon('restore', { size: 20 }), t('restoreVersion'))));
    };
    showList();
  }, { label: t('historyTitle') });
}
