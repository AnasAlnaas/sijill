// The backup / export format, and how a backup is merged back in.
//
// A full export is a .zip containing:
//   sijill.json     everything, re-importable (notes, labels, settings, attachment list)
//   notes/…md       one Markdown file per note (Archive/ and Trash/ subfolders)
//   files/…         attachments
//   README.txt
//
// Restoring never deletes anything on the phone. For each note in the backup:
//   - not on the phone            → added
//   - on the phone, backup newer   → the phone's copy is saved to version history, then replaced
//   - on the phone, same or newer  → left alone

import { noteToMarkdown } from './model.js';

export const FORMAT = 'sijill-backup';
export const VERSION = 1;

export function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function extFor(att) {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(att.name || '');
  if (fromName) return fromName[1].toLowerCase();
  const fromType = (att.type || '').split('/')[1];
  return fromType ? fromType.replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '').slice(0, 5) : 'bin';
}

export function filePath(att) {
  return `files/${att.id}.${extFor(att)}`;
}

export function manifest({ notes, labels, settings = {}, files = [], now = Date.now() }) {
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date(now).toISOString(),
    notes,
    labels,
    settings,
    files,
  };
}

/** One Markdown file per note, with unique, readable names. */
export function markdownFiles(notes, { labelName, untitled = 'Untitled', hasFile = () => true }) {
  const used = new Set();
  return notes.map((n) => {
    const folder = n.trashedAt ? 'Trash/' : n.archived ? 'Archive/' : '';
    const first = n.type === 'list' ? n.items?.[0]?.text : (n.body || '').split('\n')[0];
    const name = safeName(n.title) || safeName(first) || untitled;
    let candidate = `${folder}${name}`;
    for (let k = 2; used.has(candidate.toLowerCase()); k++) candidate = `${folder}${name} (${k})`;
    used.add(candidate.toLowerCase());
    const up = folder ? '../../' : '../';
    return {
      name: `notes/${candidate}.md`,
      data: noteToMarkdown(n, { labelName, fileLink: (a) => (hasFile(a) ? up + filePath(a) : a.name) }),
      date: new Date(n.updatedAt),
    };
  });
}

export function readme({ notes, labels, files, when, lang = 'en' }) {
  if (lang === 'ar') {
    return [
      'نسخة احتياطية من سِجِلّ',
      '',
      `${when}: ${notes} ملاحظة، ${labels} تصنيف، ${files} مرفق.`,
      '',
      'sijill.json   كل شيء، بصيغة يستطيع سِجِلّ استعادتها (الإعدادات ← النسخ الاحتياطي ← استعادة).',
      'notes/        ملف Markdown لكل ملاحظة، يُقرأ بأي محرّر نصوص.',
      'files/        المرفقات (صور وملفات).',
    ].join('\n');
  }
  return [
    'Sijill backup',
    '',
    `${when}: ${notes} notes, ${labels} labels, ${files} attachments.`,
    '',
    'sijill.json   Everything, in a form Sijill can restore (Settings → Backups → Restore).',
    'notes/        One Markdown file per note, readable in any text editor.',
    'files/        Attachments (images and files).',
  ].join('\n');
}

export function validate(data) {
  if (!data || data.format !== FORMAT) throw new Error('not-a-backup');
  if (typeof data.version !== 'number' || data.version > VERSION) throw new Error('newer-version');
  if (!Array.isArray(data.notes) || !Array.isArray(data.labels)) throw new Error('not-a-backup');
  return data;
}

/**
 * Decide what restoring a backup does. Pure: returns a plan the store applies.
 * local: { notes: Map(id → note), labels: Map(id → label) }
 */
export function planRestore(data, local) {
  const plan = { addNotes: [], replaceNotes: [], keepNotes: 0, addLabels: [], mapLabels: new Map() };
  const byName = new Map([...local.labels.values()].map((l) => [l.name.trim().toLowerCase(), l]));
  for (const l of data.labels) {
    if (!l?.id || !l.name) continue;
    if (local.labels.has(l.id)) continue;
    const same = byName.get(l.name.trim().toLowerCase());
    if (same) plan.mapLabels.set(l.id, same.id);
    else plan.addLabels.push(l);
  }
  const fixLabels = (ids) => [...new Set((ids || []).map((id) => plan.mapLabels.get(id) || id))];
  for (const n of data.notes) {
    if (!n?.id) continue;
    const note = { ...n, labels: fixLabels(n.labels) };
    const mine = local.notes.get(n.id);
    if (!mine) plan.addNotes.push(note);
    else if ((n.updatedAt || 0) > (mine.updatedAt || 0)) plan.replaceNotes.push(note);
    else plan.keepNotes++;
  }
  return plan;
}
