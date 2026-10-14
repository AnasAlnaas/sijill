// A note's card in the list: marker, title, a few lines, checklist progress,
// reminder, labels. Search matches are highlighted.

import { h, highlighted, dirOf } from './dom.js';
import { icon, markerIcon } from './icons.js';
import { progress } from '../core/model.js';
import { parseTask } from '../core/blocks.js';
import { matchRanges } from '../core/normalize.js';
import { displayTime, isOverdue, repeatOf } from '../core/recurrence.js';
import { fraction, dateTime, num, date } from '../core/format.js';
import { t, markerName } from '../i18n.js';
import { store } from '../state.js';
import { fileUrl } from '../services/files.js';

const MAX_LINES = 5;
const MAX_ITEMS = 5;

function stripMd(line) {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '☐ ')
    .replace(/^\s*[-*+]\s+/, '• ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .replace(/\[\[(.+?)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1');
}

function text(str, terms) {
  return terms?.length ? highlighted(str, matchRanges(str, terms)) : str;
}

export function reminderChip(note, { button = false, onClick } = {}) {
  const r = note.reminder;
  if (!r) return null;
  const when = displayTime(r);
  const overdue = isOverdue(r);
  const doneOnce = repeatOf(r) === 'none' && r.doneAt;
  const label = `${dateTime(when, { words: { today: t('today'), tomorrow: t('tomorrow'), yesterday: t('yesterday') } })}${repeatOf(r) !== 'none' ? ` · ${t(`repeat${repeatOf(r)[0].toUpperCase()}${repeatOf(r).slice(1)}`)}` : ''}`;
  const kids = [icon(overdue ? 'bellAlert' : 'bell', { size: 16 }), h('span', null, overdue ? `${t('overdue')} · ${label}` : label)];
  const cls = `chip${overdue ? ' overdue' : ''}`;
  const style = doneOnce ? { textDecoration: 'line-through' } : null;
  return button
    ? h('button', { class: cls, style, onclick: onClick, 'aria-label': `${t('reminder')}: ${label}` }, ...kids)
    : h('span', { class: cls, style }, ...kids);
}

export function expiryChip(note, { button = false, onClick } = {}) {
  const label = t('expiresOn', { when: date(note.expiresAt, { year: 'auto' }) });
  const kids = [icon('hourglass', { size: 15 }), h('span', null, label)];
  return button ? h('button', { class: 'chip', onclick: onClick }, ...kids) : h('span', { class: 'chip' }, ...kids);
}

export function renderCard(note, { terms, selected, showArchived }) {
  const title = (note.title || '').trim();
  const kids = [];

  const img = (note.attachments || []).find((a) => a.type?.startsWith('image/'));
  if (img) {
    const el = h('img', { class: 'card-image', alt: '', loading: 'lazy', decoding: 'async' });
    fileUrl(img).then((u) => {
      if (u) el.src = u;
      else el.remove();
    });
    kids.push(el);
  }

  if (title || note.marker) {
    kids.push(h('div', { class: 'card-head', dir: dirOf(title) },
      note.marker ? markerIcon(note.marker, { size: 14, label: markerName(note.marker) }) : null,
      title ? h('div', { class: 'card-title' }, text(title, terms)) : h('div', { class: 'card-title' })));
  }

  const body = h('div', { class: 'card-body' });
  if (note.type === 'list') {
    const items = (note.items || []).filter((i) => i.text.trim());
    const open = items.filter((i) => !i.done);
    const shown = (open.length ? open : items).slice(0, MAX_ITEMS);
    for (const i of shown) {
      body.append(h('div', { class: `card-item${i.indent ? ' indent' : ''}${i.done ? ' done' : ''}`, dir: dirOf(i.text) },
        icon(i.done ? 'boxChecked' : 'boxEmpty', { size: 18 }),
        h('span', null, text(i.text, terms))));
    }
    const rest = (open.length ? open.length : items.length) - shown.length;
    if (rest > 0) body.append(h('div', { class: 'card-more' }, t('moreItems', { n: rest })));
  } else {
    const lines = (note.body || '').split('\n');
    let count = 0;
    let lastBlank = true;
    for (const raw of lines) {
      if (count >= MAX_LINES) break;
      if (!raw.trim()) {
        lastBlank = true;
        continue;
      }
      const task = parseTask(raw);
      if (task) {
        // A checklist inside the note: shown with real boxes, like a checklist card.
        body.append(h('div', { class: `card-item${task.indent ? ' indent' : ''}${task.done ? ' done' : ''}`, dir: dirOf(task.text) },
          icon(task.done ? 'boxChecked' : 'boxEmpty', { size: 18 }),
          h('span', null, text(task.text, terms))));
        lastBlank = false;
        count++;
        continue;
      }
      const isHeading = /^\s{0,3}#{1,6}\s/.test(raw);
      body.append(h('div', { class: `card-line${isHeading ? ' h' : ''}`, dir: dirOf(raw), style: !lastBlank || count === 0 ? null : { marginBlockStart: '.35em' } }, text(stripMd(raw), terms)));
      lastBlank = false;
      count++;
    }
    // Search matches further down: show the matching line too.
    if (terms?.length && count >= MAX_LINES) {
      const shownText = lines.slice(0, MAX_LINES).join('\n');
      const later = lines.find((l, idx) => idx >= MAX_LINES && matchRanges(l, terms).length && !shownText.includes(l));
      if (later) body.append(h('div', { class: 'card-line', dir: dirOf(later) }, '… ', text(stripMd(later), terms)));
    }
  }
  if (body.childNodes.length) kids.push(body);

  const meta = [];
  const p = progress(note);
  if (p) meta.push(h('span', { class: 'chip strong', 'aria-label': t('progress', { done: p.done, total: p.total }) }, icon('checklist', { size: 16 }), h('span', { class: 'progress' }, fraction(p.done, p.total))));
  const rc = reminderChip(note);
  if (rc) meta.push(rc);
  if (note.expiresAt && !note.trashedAt) meta.push(expiryChip(note));
  if (showArchived && note.archived) meta.push(h('span', { class: 'chip' }, icon('archive', { size: 16 }), h('span', null, t('archive'))));
  for (const id of note.labels || []) {
    const name = store.labelName(id);
    if (name) meta.push(h('span', { class: 'chip', dir: dirOf(name) }, icon('label', { size: 15 }), h('span', null, text(name, terms))));
  }
  const files = (note.attachments || []).length;
  if (files > 1 || (files === 1 && !img)) meta.push(h('span', { class: 'chip' }, icon('image', { size: 15 }), h('span', null, num(files))));
  if (meta.length) kids.push(h('div', { class: 'card-meta' }, meta));

  const card = h('button', {
    class: `card${selected ? ' selected' : ''}`,
    dataset: { id: note.id },
    'aria-pressed': selected ? 'true' : null,
  }, kids);
  if (selected) card.append(h('span', { class: 'sel-badge', 'aria-hidden': 'true' }, icon('check', { size: 18 })));
  return card;
}

/** Long-press detection that doesn't fight scrolling. */
export function onLongPress(container, selector, fn) {
  let timer = null;
  let start = null;
  let fired = false;
  container.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(selector);
    if (!el) return;
    fired = false;
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      fired = true;
      navigator.vibrate?.(15);
      fn(el, e);
    }, 450);
  });
  const cancel = () => clearTimeout(timer);
  container.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
  });
  container.addEventListener('pointerup', cancel);
  container.addEventListener('pointercancel', cancel);
  container.addEventListener('contextmenu', (e) => {
    if (e.target.closest(selector)) e.preventDefault();
  });
  // Swallow the click that follows a long press.
  container.addEventListener('click', (e) => {
    if (fired) {
      fired = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}
