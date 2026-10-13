// Storage adapters. All share one small interface:
//
//   open()
//   loadAll()                → { notes, labels, settings }
//   commit(changes)          one atomic write:
//                              { notes: { put: [note], del: [id] }, labels: { put, del },
//                                settings: { key: value }, versions: { add: [{ noteId, savedAt, data }], del: [id] } }
//   listVersions(noteId)     → [{ id, savedAt, data }] newest first
//
// On the phone: SQLite, through the app's own native plugin (WAL journal, full fsync).
// In a desktop browser preview: IndexedDB. In tests: memory.

import { Capacitor, registerPlugin } from '@capacitor/core';

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS labels (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS versions (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT NOT NULL, saved_at INTEGER NOT NULL, data TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS versions_note ON versions (note_id, saved_at)',
];

function statements(changes) {
  const out = [];
  for (const n of changes.notes?.put || []) {
    out.push({ sql: 'INSERT OR REPLACE INTO notes (id, data, updated_at) VALUES (?, ?, ?)', values: [n.id, JSON.stringify(n), n.updatedAt || 0] });
  }
  for (const id of changes.notes?.del || []) {
    out.push({ sql: 'DELETE FROM notes WHERE id = ?', values: [id] });
    out.push({ sql: 'DELETE FROM versions WHERE note_id = ?', values: [id] });
  }
  for (const l of changes.labels?.put || []) {
    out.push({ sql: 'INSERT OR REPLACE INTO labels (id, data) VALUES (?, ?)', values: [l.id, JSON.stringify(l)] });
  }
  for (const id of changes.labels?.del || []) out.push({ sql: 'DELETE FROM labels WHERE id = ?', values: [id] });
  for (const [k, v] of Object.entries(changes.settings || {})) {
    out.push({ sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', values: [k, JSON.stringify(v)] });
  }
  for (const v of changes.versions?.add || []) {
    out.push({ sql: 'INSERT INTO versions (note_id, saved_at, data) VALUES (?, ?, ?)', values: [v.noteId, v.savedAt, JSON.stringify(v.data)] });
  }
  for (const id of changes.versions?.del || []) out.push({ sql: 'DELETE FROM versions WHERE id = ?', values: [id] });
  return out;
}

function parseRows(rows, col = 'data') {
  const out = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r[col]));
    } catch {
      // A damaged row must never stop the app from opening; skip it.
    }
  }
  return out;
}

// --- SQLite (Android) -----------------------------------------------------------------

const NativeDb = registerPlugin('SijillDb');

export class SqliteDb {
  async open() {
    await NativeDb.open({ name: 'sijill.db' });
    await NativeDb.execute({ statements: SCHEMA.map((sql) => ({ sql, values: [] })) });
  }

  async loadAll() {
    const [notes, labels, settings] = await Promise.all([
      NativeDb.query({ sql: 'SELECT data FROM notes', values: [] }),
      NativeDb.query({ sql: 'SELECT data FROM labels', values: [] }),
      NativeDb.query({ sql: 'SELECT key, value FROM settings', values: [] }),
    ]);
    const s = {};
    for (const r of settings.rows) {
      try {
        s[r.key] = JSON.parse(r.value);
      } catch { /* ignore */ }
    }
    return { notes: parseRows(notes.rows), labels: parseRows(labels.rows), settings: s };
  }

  async commit(changes) {
    const st = statements(changes);
    if (st.length) await NativeDb.execute({ statements: st });
  }

  async listVersions(noteId) {
    const r = await NativeDb.query({ sql: 'SELECT id, saved_at, data FROM versions WHERE note_id = ? ORDER BY saved_at DESC', values: [noteId] });
    return r.rows.map((row) => {
      try {
        return { id: row.id, savedAt: row.saved_at, data: JSON.parse(row.data) };
      } catch {
        return null;
      }
    }).filter(Boolean);
  }
}

// --- IndexedDB (browser preview) ----------------------------------------------------------

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class IdbDb {
  async open() {
    const r = indexedDB.open('sijill', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('notes', { keyPath: 'id' });
      db.createObjectStore('labels', { keyPath: 'id' });
      db.createObjectStore('settings');
      const v = db.createObjectStore('versions', { keyPath: 'id', autoIncrement: true });
      v.createIndex('note', 'noteId');
      db.createObjectStore('files');
    };
    this.db = await req(r);
  }

  async loadAll() {
    const tx = this.db.transaction(['notes', 'labels', 'settings'], 'readonly');
    const [notes, labels, keys, values] = await Promise.all([
      req(tx.objectStore('notes').getAll()),
      req(tx.objectStore('labels').getAll()),
      req(tx.objectStore('settings').getAllKeys()),
      req(tx.objectStore('settings').getAll()),
    ]);
    return { notes, labels, settings: Object.fromEntries(keys.map((k, i) => [k, values[i]])) };
  }

  commit(changes) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['notes', 'labels', 'settings', 'versions'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      const notes = tx.objectStore('notes');
      const versions = tx.objectStore('versions');
      for (const n of changes.notes?.put || []) notes.put(structuredClone(n));
      for (const id of changes.notes?.del || []) {
        notes.delete(id);
        versions.index('note').openCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
          const c = e.target.result;
          if (c) {
            c.delete();
            c.continue();
          }
        };
      }
      for (const l of changes.labels?.put || []) tx.objectStore('labels').put(structuredClone(l));
      for (const id of changes.labels?.del || []) tx.objectStore('labels').delete(id);
      for (const [k, v] of Object.entries(changes.settings || {})) tx.objectStore('settings').put(structuredClone(v), k);
      for (const v of changes.versions?.add || []) versions.add(structuredClone(v));
      for (const id of changes.versions?.del || []) versions.delete(id);
    });
  }

  async listVersions(noteId) {
    const tx = this.db.transaction('versions', 'readonly');
    const rows = await req(tx.objectStore('versions').index('note').getAll(IDBKeyRange.only(noteId)));
    return rows.sort((a, b) => b.savedAt - a.savedAt);
  }
}

export function createDb() {
  return Capacitor.isNativePlatform() ? new SqliteDb() : new IdbDb();
}
