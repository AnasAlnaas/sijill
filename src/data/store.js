// The in-memory model of all notes and labels, kept in step with the database.
//
// Never lose a note:
//   - every change is written within SAVE_DELAY ms (and at once when the app goes to
//     the background, see flush()),
//   - writes are queued one after another so they can't overtake each other,
//   - if a write fails it is retried with the next change, nothing is dropped from the queue.
//
// Version history: when a note is first changed in an editing session, its previous
// content is saved as a version (see versions.js).

import { newNote, newLabel, isEmptyNote, uid } from '../core/model.js';
import { snapshotOf, sameContent, prune } from '../core/versions.js';

export const SAVE_DELAY = 250;
const TRASH_DAYS = 30;

export const DEFAULT_SETTINGS = {
  lang: 'ar',
  theme: 'system', // light | dark | black | system
  accent: 'none',
  textScale: 1,
  numerals: 'arab',
  calendar: 'gregory',
  lock: false,
  lockAfter: 60, // seconds in the background before the lock comes back
  secureScreen: true,
  snoozeMinutes: 30,
  checkedCollapsed: false,
  backupFolder: null,
  lastBackupAt: 0,
  lastFolderBackupAt: 0,
  onboarded: false,
};

export class Store extends EventTarget {
  constructor(db) {
    super();
    this.db = db;
    this.notes = new Map();
    this.labels = new Map();
    this.settings = { ...DEFAULT_SETTINGS };
    this.pending = emptyChanges();
    this.timer = null;
    this.writing = Promise.resolve();
    this.sessions = new Map(); // noteId → { base, versioned }
    this.saveError = null;
  }

  async init() {
    await this.db.open();
    const { notes, labels, settings } = await this.db.loadAll();
    for (const n of notes) this.notes.set(n.id, normalizeNote(n));
    for (const l of labels) this.labels.set(l.id, l);
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.purgeOldTrash();
  }

  // --- events ----------------------------------------------------------------------------

  emit(detail) {
    this.dispatchEvent(new CustomEvent('change', { detail }));
  }

  // --- reading ---------------------------------------------------------------------------

  get(id) {
    return this.notes.get(id) || null;
  }

  allNotes() {
    return [...this.notes.values()];
  }

  label(id) {
    return this.labels.get(id) || null;
  }

  labelName = (id) => this.labels.get(id)?.name || '';

  allLabels() {
    return [...this.labels.values()].sort((a, b) => a.name.localeCompare(b.name, this.settings.lang));
  }

  findLabel(name) {
    const key = String(name).trim().toLowerCase();
    return this.allLabels().find((l) => l.name.trim().toLowerCase() === key) || null;
  }

  hasSourceKey(key) {
    for (const n of this.notes.values()) if (n.source?.key === key) return true;
    return false;
  }

  // --- notes -----------------------------------------------------------------------------

  createNote(fields = {}, { silent = false } = {}) {
    const note = normalizeNote(newNote(fields));
    this.notes.set(note.id, note);
    this.queueNote(note);
    if (!silent) this.emit({ notes: [note.id] });
    return note;
  }

  /**
   * Change a note. `touch` (default true) moves updatedAt forward; pin/archive-style
   * changes pass touch:false so they don't reorder "recently edited".
   */
  updateNote(id, patch, { touch = true, silent = false } = {}) {
    const cur = this.notes.get(id);
    if (!cur) return null;
    const session = this.sessions.get(id);
    if (session && !session.versioned) {
      const changesContent = !sameContent(cur, { ...cur, ...patch });
      if (changesContent) {
        session.versioned = true;
        this.addVersion(cur);
      }
    }
    const next = { ...cur, ...patch };
    if (touch) next.updatedAt = Math.max(Date.now(), cur.updatedAt + 1);
    this.notes.set(id, next);
    this.queueNote(next);
    if (!silent) this.emit({ notes: [id] });
    return next;
  }

  updateNotes(ids, patchFn, opts = {}) {
    for (const id of ids) {
      const n = this.notes.get(id);
      if (n) this.updateNote(id, patchFn(n), { ...opts, silent: true });
    }
    this.emit({ notes: ids });
  }

  /** Remove for good (from Trash). */
  deleteForever(ids) {
    for (const id of ids) {
      this.notes.delete(id);
      this.sessions.delete(id);
      this.pending.notes.put.delete(id);
      this.pending.notes.del.add(id);
    }
    this.schedule();
    this.emit({ notes: ids, deleted: true });
  }

  /**
   * Housekeeping, on start and whenever the app comes back:
   *   - notes set to "delete after a month" whose time has come move to Trash
   *     (still recoverable there for 30 days),
   *   - notes in Trash for more than 30 days are deleted.
   */
  purgeOldTrash(now = Date.now()) {
    const expired = this.allNotes().filter((n) => n.expiresAt && n.expiresAt <= now && !n.trashedAt).map((n) => n.id);
    if (expired.length) this.updateNotes(expired, () => ({ trashedAt: now, pinned: false, expiresAt: null }), { touch: false });
    const old = this.allNotes().filter((n) => n.trashedAt && now - n.trashedAt > TRASH_DAYS * 86400000).map((n) => n.id);
    if (old.length) this.deleteForever(old);
  }

  // --- editing sessions and versions --------------------------------------------------------

  /** Call when a note is opened in the editor. */
  beginSession(id) {
    if (!this.notes.has(id)) return;
    this.sessions.set(id, { versioned: false });
  }

  /** Call when the editor closes. Empty new notes are discarded. */
  endSession(id, { discardIfEmpty = true } = {}) {
    this.sessions.delete(id);
    const n = this.notes.get(id);
    if (n && discardIfEmpty && isEmptyNote(n) && !n.trashedAt) {
      this.deleteForever([id]);
      return { discarded: true };
    }
    return { discarded: false };
  }

  addVersion(note) {
    this.pending.versions.add.push({ noteId: note.id, savedAt: note.updatedAt, data: snapshotOf(note) });
    this.schedule();
  }

  async versions(noteId) {
    await this.flush();
    const list = await this.db.listVersions(noteId);
    const dead = prune(list);
    if (dead.length) {
      await this.db.commit({ versions: { del: dead } });
      const deadSet = new Set(dead);
      return dedupe(list.filter((v) => !deadSet.has(v.id)));
    }
    return dedupe(list);
  }

  /** Bring back an old version. The current content is saved to history first. */
  restoreVersion(noteId, version) {
    const cur = this.notes.get(noteId);
    if (!cur) return null;
    this.addVersion(cur);
    const { savedAt, ...content } = version.data;
    const session = this.sessions.get(noteId);
    if (session) session.versioned = true;
    return this.updateNote(noteId, content);
  }

  // --- labels ------------------------------------------------------------------------------

  createLabel(name) {
    const clean = String(name).trim();
    if (!clean) return null;
    const existing = this.findLabel(clean);
    if (existing) return existing;
    const l = newLabel(clean);
    this.labels.set(l.id, l);
    this.pending.labels.put.set(l.id, l);
    this.schedule();
    this.emit({ labels: true });
    return l;
  }

  renameLabel(id, name) {
    const l = this.labels.get(id);
    const clean = String(name).trim();
    if (!l || !clean) return null;
    const next = { ...l, name: clean, updatedAt: Date.now() };
    this.labels.set(id, next);
    this.pending.labels.put.set(id, next);
    this.schedule();
    this.emit({ labels: true });
    return next;
  }

  deleteLabel(id) {
    if (!this.labels.has(id)) return;
    const affected = this.allNotes().filter((n) => n.labels.includes(id));
    for (const n of affected) this.updateNote(n.id, { labels: n.labels.filter((x) => x !== id) }, { touch: false, silent: true });
    this.labels.delete(id);
    this.pending.labels.put.delete(id);
    this.pending.labels.del.add(id);
    this.schedule();
    this.emit({ labels: true, notes: affected.map((n) => n.id) });
  }

  putLabel(l) {
    this.labels.set(l.id, l);
    this.pending.labels.put.set(l.id, l);
    this.schedule();
  }

  // --- settings ----------------------------------------------------------------------------

  set(key, value) {
    this.settings[key] = value;
    this.pending.settings[key] = value;
    this.schedule();
    this.emit({ settings: [key] });
  }

  // --- persistence -------------------------------------------------------------------------

  queueNote(note) {
    this.pending.notes.del.delete(note.id);
    this.pending.notes.put.set(note.id, note);
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY);
  }

  get dirty() {
    const p = this.pending;
    return p.notes.put.size + p.notes.del.size + p.labels.put.size + p.labels.del.size
      + Object.keys(p.settings).length + p.versions.add.length > 0;
  }

  /** Write everything pending now. Safe to call any time; resolves when it's on disk. */
  flush() {
    clearTimeout(this.timer);
    this.writing = this.writing.then(async () => {
      if (!this.dirty) return;
      const batch = this.pending;
      this.pending = emptyChanges();
      try {
        await this.db.commit({
          notes: { put: [...batch.notes.put.values()], del: [...batch.notes.del] },
          labels: { put: [...batch.labels.put.values()], del: [...batch.labels.del] },
          settings: batch.settings,
          versions: { add: batch.versions.add },
        });
        if (this.saveError) {
          this.saveError = null;
          this.emit({ saveError: null });
        }
      } catch (err) {
        // Put the batch back in front of anything newer, and try again soon.
        this.pending = mergeChanges(batch, this.pending);
        this.saveError = err;
        this.emit({ saveError: err });
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), 2000);
      }
    });
    return this.writing;
  }
}

function emptyChanges() {
  return {
    notes: { put: new Map(), del: new Set() },
    labels: { put: new Map(), del: new Set() },
    settings: {},
    versions: { add: [] },
  };
}

function mergeChanges(older, newer) {
  const out = emptyChanges();
  for (const src of [older, newer]) {
    for (const [id, n] of src.notes.put) {
      out.notes.del.delete(id);
      out.notes.put.set(id, n);
    }
    for (const id of src.notes.del) {
      out.notes.put.delete(id);
      out.notes.del.add(id);
    }
    for (const [id, l] of src.labels.put) {
      out.labels.del.delete(id);
      out.labels.put.set(id, l);
    }
    for (const id of src.labels.del) {
      out.labels.put.delete(id);
      out.labels.del.add(id);
    }
    Object.assign(out.settings, src.settings);
    out.versions.add.push(...src.versions.add);
  }
  return out;
}

// Consecutive identical versions (e.g. from restore → restore) are noise.
function dedupe(list) {
  const out = [];
  for (const v of list) {
    const prev = out[out.length - 1];
    if (prev && sameContent(prev.data, v.data)) continue;
    out.push(v);
  }
  return out;
}

/** Fill in missing fields so older or imported records never break the UI. */
export function normalizeNote(n) {
  return {
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
    expiresAt: null,
    attachments: [],
    createdAt: n.updatedAt || Date.now(),
    updatedAt: n.createdAt || Date.now(),
    order: n.updatedAt || Date.now(),
    ...n,
    items: Array.isArray(n.items) ? n.items.map((i) => ({ id: i.id || uid(), text: String(i.text ?? ''), done: Boolean(i.done), indent: i.indent ? 1 : 0 })) : [],
    labels: Array.isArray(n.labels) ? n.labels : [],
    attachments: Array.isArray(n.attachments) ? n.attachments : [],
  };
}

export { newLabel };
