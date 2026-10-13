// Import from Google Keep (a Google Takeout export).
// Adapted from Jotter. Works on a list of entries — each { path, text(), blob(type) } —
// so it can be fed from a .zip on the phone, files in a browser, or a test.
//
// Kept from Keep: title, text, checklists with ticks, labels, colour (as a marker shape),
// pinned, archived, trashed, images and other attachments, original created/edited dates,
// and link annotations (added at the end of the note).
//
// Re-importing the same export never duplicates: each imported note remembers
// source.key = "keep:<created time in µs>", and notes whose key already exists are skipped.

import { uid } from './model.js';

export const KEEP_MARKERS = {
  DEFAULT: null,
  RED: 'circle',
  ORANGE: 'triangle',
  YELLOW: 'square',
  GREEN: 'diamond',
  TEAL: 'hexagon',
  BLUE: 'star',
  CERULEAN: 'plus',
  PURPLE: 'ring',
  PINK: 'half',
  BROWN: 'down',
  GRAY: 'bar',
  GREY: 'bar',
};

const base = (p) => String(p).split(/[\\/]/).pop();

export function isKeepNote(o) {
  return Boolean(o) && typeof o === 'object' && ('userEditedTimestampUsec' in o || 'createdTimestampUsec' in o)
    && ('textContent' in o || 'listContent' in o || 'title' in o);
}

export function keepKey(o, path = '') {
  if (o.createdTimestampUsec) return `keep:${o.createdTimestampUsec}`;
  return `keep:file:${base(path)}`;
}

// Takeout sometimes names a file .jpg in the JSON and .jpeg on disk (or the reverse).
export function findAttachment(byName, filePath) {
  if (!filePath) return null;
  const name = base(filePath).toLowerCase();
  if (byName.has(name)) return byName.get(name);
  const stem = name.replace(/\.[^.]+$/, '');
  for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', '3gp', 'm4a', 'mp3', 'amr', 'awb']) {
    if (byName.has(`${stem}.${ext}`)) return byName.get(`${stem}.${ext}`);
  }
  return null;
}

const usec = (v) => Math.round(Number(v) / 1000) || 0;

/** Keep JSON → note fields (without attachments, which need file access). */
export function keepToNote(o, { now = Date.now() } = {}) {
  const created = usec(o.createdTimestampUsec) || usec(o.userEditedTimestampUsec) || now;
  const edited = usec(o.userEditedTimestampUsec) || created;
  const links = (o.annotations || []).filter((a) => a?.url)
    .map((a) => (a.title && a.title !== a.url ? `[${a.title}](${a.url})` : a.url));
  const isList = Array.isArray(o.listContent) && o.listContent.length > 0;
  let body = typeof o.textContent === 'string' ? o.textContent.replace(/\r\n?/g, '\n') : '';
  const items = isList
    ? o.listContent.map((li) => ({ id: uid(), text: String(li.text || '').replace(/\n/g, ' '), done: Boolean(li.isChecked), indent: 0 }))
    : [];
  if (isList) {
    // Keep sometimes has text and a list; keep the text rather than drop it.
    if (body.trim()) items.unshift({ id: uid(), text: body.trim().replace(/\n/g, ' '), done: false, indent: 0 });
    body = '';
  }
  for (const link of links) {
    if (isList) items.push({ id: uid(), text: link, done: false, indent: 0 });
    else if (!body.includes(link) && !body.includes((link.match(/\((.*)\)$/) || [])[1] || '\u0000')) {
      body += `${body ? '\n\n' : ''}${link}`;
    }
  }
  return {
    type: isList ? 'list' : 'note',
    title: String(o.title || ''),
    body,
    items,
    marker: KEEP_MARKERS[String(o.color || 'DEFAULT').toUpperCase()] ?? null,
    pinned: Boolean(o.isPinned) && !o.isArchived && !o.isTrashed,
    archived: Boolean(o.isArchived),
    trashedAt: o.isTrashed ? now : null,
    createdAt: created,
    updatedAt: edited,
    order: edited,
    labelNames: (o.labels || []).map((l) => l?.name).filter(Boolean),
    attachmentRefs: (o.attachments || []).map((a) => ({ filePath: a.filePath, type: a.mimetype || '' })),
  };
}

const breathe = () => new Promise((r) => setTimeout(r));

/**
 * entries: [{ path, text(), blob(type) }]
 * api: {
 *   hasKey(key) → bool,
 *   labelId(name) → id (find or create),
 *   saveFile(blob, name, type) → attachment,
 *   createNote(fields),
 *   onProgress(done, total)
 * }
 */
export async function importKeepEntries(entries, api) {
  const byName = new Map(entries.map((e) => [base(e.path).toLowerCase(), e]));
  const jsons = entries.filter((e) => /\.json$/i.test(e.path));
  const inKeepFolder = jsons.filter((e) => /(^|[\\/])Keep[\\/]/i.test(e.path));
  const candidates = inKeepFolder.length ? inKeepFolder : jsons;
  const result = { imported: 0, duplicates: 0, skipped: 0, attachments: 0, missingFiles: 0 };
  const seen = new Set();

  let i = 0;
  for (const e of candidates) {
    i++;
    if (i % 20 === 0) {
      api.onProgress?.(i, candidates.length);
      await breathe();
    }
    let o;
    try {
      o = JSON.parse(await e.text());
    } catch {
      result.skipped++;
      continue;
    }
    if (!isKeepNote(o)) {
      result.skipped++;
      continue;
    }
    const key = keepKey(o, e.path);
    if (seen.has(key) || api.hasKey(key)) {
      result.duplicates++;
      continue;
    }
    seen.add(key);

    const { labelNames, attachmentRefs, ...fields } = keepToNote(o);
    const labels = [];
    for (const name of labelNames) {
      const id = await api.labelId(name);
      if (id && !labels.includes(id)) labels.push(id);
    }
    const attachments = [];
    for (const ref of attachmentRefs) {
      const entry = findAttachment(byName, ref.filePath);
      if (!entry) {
        result.missingFiles++;
        continue;
      }
      try {
        const type = ref.type || guessType(entry.path);
        const blob = await entry.blob(type);
        attachments.push(await api.saveFile(blob, base(entry.path), type));
        result.attachments++;
      } catch {
        result.missingFiles++;
      }
    }
    await api.createNote({ ...fields, labels, attachments, source: { app: 'keep', key } });
    result.imported++;
  }
  api.onProgress?.(candidates.length, candidates.length);
  return result;
}

export function guessType(name) {
  const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1]?.toLowerCase();
  return {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    heic: 'image/heic', pdf: 'application/pdf', '3gp': 'audio/3gpp', m4a: 'audio/mp4', mp3: 'audio/mpeg',
    amr: 'audio/amr', awb: 'audio/amr-wb', txt: 'text/plain', md: 'text/markdown', json: 'application/json',
  }[ext] || 'application/octet-stream';
}
