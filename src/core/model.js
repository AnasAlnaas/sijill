// The shape of a note, and pure helpers for working with notes and checklists.
//
// note = {
//   id, type: 'note' | 'list',
//   title, body,                       body is Markdown text (type 'note')
//   items: [{ id, text, done, indent }] checklist items (type 'list'); indent is 0 or 1
//   marker: null | one of MARKERS       a shape, so categories survive grayscale
//   pinned, archived, trashedAt,
//   labels: [labelId],
//   reminder: null | { at, repeat, snoozedUntil?, doneAt? },
//   expiresAt: null | ms            'delete after a month': moves to Trash at this time
//   attachments: [{ id, name, type, size }],
//   createdAt, updatedAt, order,
//   source?: { app: 'keep', key }      where an imported note came from (for de-duplication)
// }

import { bodyProgress, parseTask } from './blocks.js';

export const MARKERS = [
  'circle', 'triangle', 'square', 'diamond', 'star', 'hexagon',
  'plus', 'ring', 'half', 'down', 'bar',
];

export function uid() {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_');
}

export function newNote(fields = {}) {
  const now = Date.now();
  return {
    id: uid(),
    type: 'note',
    title: '',
    body: '',
    items: [],
    marker: null,
    pinned: false,
    archived: false,
    trashedAt: null,
    labels: [],
    reminder: null,
    attachments: [],
    createdAt: now,
    updatedAt: now,
    order: now,
    ...fields,
  };
}

export function newLabel(name, fields = {}) {
  const now = Date.now();
  return { id: uid(), name: String(name).trim(), order: now, createdAt: now, updatedAt: now, ...fields };
}

export function isEmptyNote(n) {
  // A journal entry's title is filled in automatically, so it doesn't count as writing.
  return (n.journal || !(n.title && n.title.trim())) && !(n.body && n.body.trim())
    && !(n.items || []).some((i) => i.text.trim()) && !(n.attachments || []).length && !n.reminder;
}

/** "3/7"-style progress for a checklist, or null for a plain note / empty list. */
export function progress(note) {
  if (note.type !== 'list') return bodyProgress(note.body);
  const items = (note.items || []).filter((i) => i.text.trim());
  if (!items.length) return null;
  return { done: items.filter((i) => i.done).length, total: items.length };
}

/** Text → checklist items. Understands "- [x] item", "* item", "1. item" and two-space indents. */
export function textToItems(text) {
  return String(text || '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim()).map((l) => {
    const m = /^(\s*)(?:(?:[-*+•]|\d{1,9}[.)]|[٠-٩]{1,9}[.)-])\s+)?(?:\[([ xX])\]\s*)?(.*)$/.exec(l);
    return { id: uid(), text: m[3].trim(), done: Boolean(m[2] && m[2] !== ' '), indent: m[1].length >= 2 || /^\t/.test(m[1]) ? 1 : 0 };
  });
}

export function itemsToText(items, { tasks = true } = {}) {
  return (items || []).map((i) => {
    const pad = i.indent ? '  ' : '';
    return tasks ? `${pad}- [${i.done ? 'x' : ' '}] ${i.text}` : `${pad}${i.text}`;
  }).join('\n');
}

/** Switch a note between plain note and checklist without losing anything. */
export function convertPatch(note) {
  if (note.type === 'list') {
    const anyDone = (note.items || []).some((i) => i.done);
    const listText = itemsToText(note.items, { tasks: anyDone });
    return { type: 'note', body: [note.body, listText].filter((s) => s && s.trim()).join('\n'), items: [] };
  }
  return { type: 'list', items: [...(note.items || []), ...textToItems(note.body)], body: '' };
}

// --- checklist operations (pure: they return a new items array) ----------------------

/** Children of item idx: the following items with a deeper indent. */
export function childRange(items, idx) {
  let end = idx + 1;
  if (!items[idx] || items[idx].indent) return [idx, end];
  while (end < items.length && items[end].indent) end++;
  return [idx, end];
}

/**
 * Tick or untick an item. Ticking a parent ticks its sub-items; unticking a sub-item
 * unticks its parent (a parent can't be done while one of its parts isn't).
 */
export function setDone(items, id, done) {
  const out = items.map((i) => ({ ...i }));
  const idx = out.findIndex((i) => i.id === id);
  if (idx < 0) return out;
  out[idx].done = done;
  if (!out[idx].indent && done) {
    const [, end] = childRange(out, idx);
    for (let k = idx + 1; k < end; k++) out[k].done = true;
  }
  if (out[idx].indent && !done) {
    for (let k = idx - 1; k >= 0; k--) {
      if (!out[k].indent) {
        out[k].done = false;
        break;
      }
    }
  }
  return out;
}

/** Indent (1) or outdent (0). The first item can't be indented. */
export function setIndent(items, id, indent) {
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0 || (idx === 0 && indent)) return items;
  return items.map((i, k) => (k === idx ? { ...i, indent: indent ? 1 : 0 } : i));
}

/** Insert pasted multi-line text at a caret inside item `id`. Returns { items, focusId }. */
export function pasteLines(items, id, caretStart, caretEnd, text) {
  const parsed = textToItems(text);
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0 || !parsed.length) return { items, focusId: id };
  const out = [...items];
  const cur = out[idx];
  const head = cur.text.slice(0, caretStart);
  const tail = cur.text.slice(caretEnd);
  out[idx] = { ...cur, text: head + parsed[0].text, done: cur.done || parsed[0].done };
  const rest = parsed.slice(1).map((p) => ({ ...p, indent: p.indent || cur.indent || 0 }));
  if (tail) {
    if (rest.length) rest[rest.length - 1].text += tail;
    else out[idx].text += tail;
  }
  out.splice(idx + 1, 0, ...rest);
  return { items: out, focusId: rest.length ? rest[rest.length - 1].id : id };
}

/**
 * Move item `id` (with its sub-items) so it sits before `beforeId` (or at the end when null).
 * The moved item keeps its indent unless that's impossible (first position).
 */
export function moveItem(items, id, beforeId, indent) {
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return items;
  const [s, e] = childRange(items, idx);
  const block = items.slice(s, e);
  const rest = [...items.slice(0, s), ...items.slice(e)];
  let at = beforeId ? rest.findIndex((i) => i.id === beforeId) : rest.length;
  if (at < 0) at = rest.length;
  const head = { ...block[0] };
  if (indent != null) head.indent = block.length > 1 ? 0 : indent ? 1 : 0;
  if (at === 0) head.indent = 0;
  const moved = [head, ...block.slice(1)];
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}

/** Split the list into the active part and the "checked" part, keeping parents with children. */
export function splitChecked(items) {
  const active = [];
  const done = [];
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (!it.indent) {
      const [, end] = childRange(items, k);
      const group = items.slice(k, end);
      if (it.done) {
        done.push(it);
        // sub-items of a ticked parent go with it
        done.push(...group.slice(1));
      } else {
        active.push(it);
        for (const c of group.slice(1)) (c.done ? done : active).push(c);
      }
      k = end - 1;
    } else {
      (it.done ? done : active).push(it);
    }
  }
  return { active, done };
}

// --- Markdown export -------------------------------------------------------------------

export function noteToMarkdown(note, { labelName = () => '', fileLink } = {}) {
  const labels = (note.labels || []).map(labelName).filter(Boolean);
  const front = [
    '---',
    `title: ${JSON.stringify(note.title || '')}`,
    `created: ${new Date(note.createdAt).toISOString()}`,
    `updated: ${new Date(note.updatedAt).toISOString()}`,
    labels.length ? `labels: [${labels.map((l) => JSON.stringify(l)).join(', ')}]` : null,
    note.marker ? `marker: ${note.marker}` : null,
    note.pinned ? 'pinned: true' : null,
    note.archived ? 'archived: true' : null,
    note.trashedAt ? 'trashed: true' : null,
    note.reminder ? `reminder: ${new Date(note.reminder.at).toISOString()}${note.reminder.repeat && note.reminder.repeat !== 'none' ? ` (${note.reminder.repeat})` : ''}` : null,
    '---',
  ].filter(Boolean).join('\n');
  const body = note.type === 'list' ? itemsToText(note.items) : note.body || '';
  const files = (note.attachments || []).map((a) => {
    const href = fileLink ? fileLink(a) : a.name;
    return a.type?.startsWith('image/') ? `![${a.name}](${encodeURI(href)})` : `[${a.name}](${encodeURI(href)})`;
  });
  return [front, note.title ? `# ${note.title}` : null, body, files.join('\n\n')].filter((s) => s && s.trim()).join('\n\n') + '\n';
}

export function noteToPlainText(note) {
  const body = note.type === 'list'
    ? (note.items || []).map((i) => `${i.indent ? '    ' : ''}${i.done ? '☑' : '☐'} ${i.text}`).join('\n')
    : (note.body || '').split('\n').map((line) => {
      const t = parseTask(line);
      return t ? `${t.indent ? '    ' : ''}${t.done ? '☑' : '☐'} ${t.text}` : line;
    }).join('\n');
  return [note.title, body].filter((s) => s && s.trim()).join('\n\n');
}

/** A short title for notifications, file names, etc. */
export function displayTitle(note) {
  const t = (note.title || '').trim();
  if (t) return t;
  const first = note.type === 'list' ? (note.items || []).find((i) => i.text.trim())?.text : (note.body || '').split('\n').find((l) => l.trim());
  return (first || '').replace(/^[#>*\-\s[\]x]+/, '').trim().slice(0, 80);
}
