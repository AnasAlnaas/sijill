// Backups, export, restore and Google Keep import.
//
// Automatic backups, once a day when the app is opened or brought back:
//   - inside the app: notes + labels as JSON (small), last 14 kept,
//   - in a folder you choose (optional): a full .zip with attachments, last 5 kept.
//     That folder survives uninstalling the app.

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { isNative, saveAs, folderWrite, folderList, deleteDocument } from '../native.js';
import { makeZip, readZip } from '../core/zip.js';
import { manifest, markdownFiles, readme, validate, planRestore, filePath } from '../core/backup.js';
import { importKeepEntries } from '../core/keep.js';
import { saveFile, fileBlob, hasFile } from './files.js';
import { date, time } from '../core/format.js';
import { t, getLang } from '../i18n.js';

const DAY = 86400000;
const KEEP_INTERNAL = 14;
const KEEP_FOLDER = 5;

const stampOf = (ms = Date.now()) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function settingsForBackup(s) {
  const { backupFolder, lastBackupAt, lastFolderBackupAt, ...rest } = s;
  return rest;
}

export async function buildZip(store, onProgress = () => {}) {
  const notes = store.allNotes();
  const labels = store.allLabels();
  const seen = new Set();
  const atts = notes.flatMap((n) => n.attachments || []).filter((a) => !seen.has(a.id) && seen.add(a.id));
  const fileEntries = [];
  const files = [];
  let i = 0;
  for (const a of atts) {
    onProgress(++i, atts.length);
    const blob = await fileBlob(a);
    if (!blob) continue;
    files.push({ ...a, path: filePath(a) });
    fileEntries.push({ name: filePath(a), data: blob });
  }
  const present = new Set(files.map((f) => f.id));
  const now = Date.now();
  return makeZip([
    { name: 'README.txt', data: readme({ notes: notes.length, labels: labels.length, files: files.length, when: `${date(now, { year: 'always' })} ${time(now)}`, lang: getLang() }) },
    { name: 'sijill.json', data: JSON.stringify(manifest({ notes, labels, settings: settingsForBackup(store.settings), files, now })) },
    ...markdownFiles(notes, { labelName: store.labelName, untitled: getLang() === 'ar' ? 'بلا عنوان' : 'Untitled', hasFile: (a) => present.has(a.id) }),
    ...fileEntries,
  ]);
}

export async function exportAll(store, onProgress) {
  const zip = await buildZip(store, onProgress);
  return saveAs(zip, `sijill-${stampOf()}.zip`, 'application/zip');
}

// --- automatic backups ------------------------------------------------------------------------------

export async function autoBackup(store, { force = false } = {}) {
  const now = Date.now();
  const done = [];
  if (isNative && (force || now - (store.settings.lastBackupAt || 0) > 20 * 3600000)) {
    await store.flush();
    const data = manifest({ notes: store.allNotes(), labels: store.allLabels(), settings: settingsForBackup(store.settings), now });
    await Filesystem.writeFile({ path: `backups/sijill-${stampOf(now)}.json`, data: JSON.stringify(data), directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
    const list = await listInternalBackups();
    for (const old of list.slice(KEEP_INTERNAL)) {
      await Filesystem.deleteFile({ path: `backups/${old.name}`, directory: Directory.Data }).catch(() => {});
    }
    store.set('lastBackupAt', now);
    done.push('internal');
  }
  const folder = store.settings.backupFolder;
  if (isNative && folder && (force || now - (store.settings.lastFolderBackupAt || 0) > 20 * 3600000)) {
    try {
      const zip = await buildZip(store);
      const name = `sijill-backup-${stampOf(now)}.zip`;
      const existing = await folderList(folder.uri);
      for (const f of existing.filter((x) => x.name === name)) await deleteDocument(f.uri);
      await folderWrite(folder.uri, name, zip, 'application/zip');
      const ours = (await folderList(folder.uri)).filter((f) => /^sijill-backup-\d{4}-\d\d-\d\d\.zip$/.test(f.name))
        .sort((a, b) => b.name.localeCompare(a.name));
      for (const old of ours.slice(KEEP_FOLDER)) await deleteDocument(old.uri);
      store.set('lastFolderBackupAt', now);
      done.push('folder');
    } catch (e) {
      console.warn('folder backup failed', e);
      throw e;
    }
  }
  return done;
}

export async function listInternalBackups() {
  if (!isNative) return [];
  try {
    const r = await Filesystem.readdir({ path: 'backups', directory: Directory.Data });
    return r.files.filter((f) => /^sijill-.*\.json$/.test(f.name)).sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

export async function readInternalBackup(name) {
  const r = await Filesystem.readFile({ path: `backups/${name}`, directory: Directory.Data, encoding: Encoding.UTF8 });
  return JSON.parse(r.data);
}

// --- restore -----------------------------------------------------------------------------------------

/** Merge backup data into the store. getFile(path) → Blob for attachments, if available. */
export async function applyBackup(store, data, getFile = async () => null) {
  validate(data);
  const plan = planRestore(data, { notes: store.notes, labels: store.labels });
  for (const l of plan.addLabels) store.putLabel(l);
  for (const f of data.files || []) {
    if (await hasFile(f)) continue;
    const blob = await getFile(f.path);
    if (blob) await saveFile(blob, f.name, f.type, f.id);
  }
  for (const n of plan.addNotes) {
    store.notes.set(n.id, n);
    store.queueNote(n);
  }
  for (const n of plan.replaceNotes) {
    store.addVersion(store.get(n.id));
    store.notes.set(n.id, n);
    store.queueNote(n);
  }
  store.emit({ notes: [...plan.addNotes, ...plan.replaceNotes].map((n) => n.id), labels: true });
  await store.flush();
  return { added: plan.addNotes.length, replaced: plan.replaceNotes.length, kept: plan.keepNotes };
}

export async function restoreFromFile(store, file) {
  if (/\.json$/i.test(file.name || '')) {
    return applyBackup(store, JSON.parse(await file.text()));
  }
  const entries = await readZip(file);
  const m = entries.find((e) => /(^|\/)sijill\.json$/.test(e.name));
  if (!m) throw new Error('not-a-backup');
  const root = m.name.slice(0, -'sijill.json'.length);
  const byPath = new Map(entries.map((e) => [e.name, e]));
  const data = JSON.parse(await m.text());
  return applyBackup(store, data, async (p) => (byPath.has(root + p) ? byPath.get(root + p).blob() : null));
}

// --- Google Keep -------------------------------------------------------------------------------------

export async function importKeep(store, file, onProgress = () => {}) {
  const entries = (await readZip(file)).map((e) => ({ path: e.name, text: () => e.text(), blob: (type) => e.blob(type) }));
  const result = await importKeepEntries(entries, {
    hasKey: (k) => store.hasSourceKey(k),
    labelId: (name) => store.createLabel(name)?.id,
    saveFile: (blob, name, type) => saveFile(blob, name, type),
    createNote: (fields) => store.createNote(fields, { silent: true }),
    onProgress,
  });
  store.emit({ notes: [], labels: true, imported: true });
  await store.flush();
  return result;
}

export function backupErrorText(e) {
  const m = String(e?.message || e);
  if (m.includes('not-a-backup') || m.includes('not a zip')) return t('notBackup');
  if (m.includes('newer-version')) return t('newerBackup');
  return t('failed', { msg: m });
}

export { DAY };
