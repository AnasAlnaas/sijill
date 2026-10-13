// An in-memory database with the same interface as db.js, for tests.

export class MemoryDb {
  constructor() {
    this.notes = new Map();
    this.labels = new Map();
    this.settings = {};
    this.versions = [];
    this.nextId = 1;
    this.commits = 0;
  }

  async open() {}

  async loadAll() {
    return {
      notes: [...this.notes.values()].map((n) => structuredClone(n)),
      labels: [...this.labels.values()].map((l) => structuredClone(l)),
      settings: structuredClone(this.settings),
    };
  }

  async commit(c) {
    this.commits++;
    for (const n of c.notes?.put || []) this.notes.set(n.id, structuredClone(n));
    for (const id of c.notes?.del || []) {
      this.notes.delete(id);
      this.versions = this.versions.filter((v) => v.noteId !== id);
    }
    for (const l of c.labels?.put || []) this.labels.set(l.id, structuredClone(l));
    for (const id of c.labels?.del || []) this.labels.delete(id);
    Object.assign(this.settings, structuredClone(c.settings || {}));
    for (const v of c.versions?.add || []) this.versions.push({ id: this.nextId++, ...structuredClone(v) });
    const del = new Set(c.versions?.del || []);
    this.versions = this.versions.filter((v) => !del.has(v.id));
  }

  async listVersions(noteId) {
    return this.versions.filter((v) => v.noteId === noteId).sort((a, b) => b.savedAt - a.savedAt).map((v) => structuredClone(v));
  }
}
