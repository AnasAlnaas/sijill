import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/data/store.js';
import { MemoryDb } from '../src/data/memorydb.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('every change is written to the database', async () => {
  const db = new MemoryDb();
  const s = new Store(db);
  await s.init();
  const n = s.createNote({ title: 'hello' });
  s.updateNote(n.id, { body: 'world' });
  await s.flush();
  assert.equal(db.notes.get(n.id).body, 'world');

  const s2 = new Store(db);
  await s2.init();
  assert.equal(s2.get(n.id).title, 'hello');
});

test('writes are batched and happen without an explicit flush', async () => {
  const db = new MemoryDb();
  const s = new Store(db);
  await s.init();
  const n = s.createNote({});
  for (let i = 0; i < 20; i++) s.updateNote(n.id, { body: 'x'.repeat(i) });
  await wait(400);
  assert.equal(db.notes.get(n.id).body, 'x'.repeat(19));
  assert.ok(db.commits <= 2);
});

test('a failed write is retried and nothing is lost', async () => {
  const db = new MemoryDb();
  const s = new Store(db);
  await s.init();
  const realCommit = db.commit.bind(db);
  let fail = true;
  db.commit = async (c) => {
    if (fail) throw new Error('disk full');
    return realCommit(c);
  };
  const n = s.createNote({ title: 'a' });
  await s.flush();
  assert.ok(s.saveError);
  s.updateNote(n.id, { body: 'b' });
  fail = false;
  await s.flush();
  assert.equal(s.saveError, null);
  assert.equal(db.notes.get(n.id).title, 'a');
  assert.equal(db.notes.get(n.id).body, 'b');
});

test('the previous content is saved once per editing session', async () => {
  const db = new MemoryDb();
  const s = new Store(db);
  await s.init();
  const n = s.createNote({ title: 'v1', body: 'one' });
  await s.flush();
  s.beginSession(n.id);
  s.updateNote(n.id, { pinned: true }, { touch: false }); // not content: no version
  s.updateNote(n.id, { body: 'two' });
  s.updateNote(n.id, { body: 'three' });
  s.endSession(n.id);
  s.beginSession(n.id);
  s.updateNote(n.id, { body: 'four' });
  s.endSession(n.id);
  const versions = await s.versions(n.id);
  assert.deepEqual(versions.map((v) => v.data.body), ['three', 'one']);

  s.restoreVersion(n.id, versions[1]);
  assert.equal(s.get(n.id).body, 'one');
  const after = await s.versions(n.id);
  assert.equal(after[0].data.body, 'four', 'the text before restoring is kept in history');
});

test('empty new notes are discarded when closed', async () => {
  const s = new Store(new MemoryDb());
  await s.init();
  const n = s.createNote({});
  s.beginSession(n.id);
  assert.deepEqual(s.endSession(n.id), { discarded: true });
  assert.equal(s.get(n.id), null);
});

test('labels: create is idempotent by name, delete removes from notes', async () => {
  const s = new Store(new MemoryDb());
  await s.init();
  const a = s.createLabel('عمل');
  assert.equal(s.createLabel(' عمل ').id, a.id);
  const n = s.createNote({ labels: [a.id] });
  s.deleteLabel(a.id);
  assert.deepEqual(s.get(n.id).labels, []);
});

test('old trash is purged after 30 days', async () => {
  const db = new MemoryDb();
  const s = new Store(db);
  await s.init();
  const old = s.createNote({ title: 'x', trashedAt: Date.now() - 31 * 86400000 });
  const recent = s.createNote({ title: 'y', trashedAt: Date.now() - 86400000 });
  s.purgeOldTrash();
  assert.equal(s.get(old.id), null);
  assert.ok(s.get(recent.id));
});

test('"delete after a month" moves the note to Trash when the time comes', async () => {
  const s = new Store(new MemoryDb());
  await s.init();
  const now = Date.now();
  const due = s.createNote({ title: 'temp', expiresAt: now - 1000, pinned: true });
  const later = s.createNote({ title: 'later', expiresAt: now + 86400000 });
  const forever = s.createNote({ title: 'keep' });
  s.purgeOldTrash(now);
  assert.ok(s.get(due.id).trashedAt, 'expired note is in Trash, not gone');
  assert.equal(s.get(due.id).pinned, false);
  assert.equal(s.get(later.id).trashedAt, null);
  assert.equal(s.get(forever.id).trashedAt, null);
  // 31 days later it is cleared out of Trash like any other note.
  s.purgeOldTrash(now + 31 * 86400000);
  assert.equal(s.get(due.id), null);
});

test('an untouched journal entry is discarded like an empty note', async () => {
  const s = new Store(new MemoryDb());
  await s.init();
  const j = s.createNote({ title: 'يوميات جمادى الأولى ١٤٤٨ هـ', journal: { cal: 'hijri', year: 1448, month: 5 } });
  s.beginSession(j.id);
  assert.deepEqual(s.endSession(j.id), { discarded: true });
  const k = s.createNote({ title: 'يوميات', body: 'كتبت شيئًا', journal: { cal: 'hijri', year: 1448, month: 5 } });
  s.beginSession(k.id);
  assert.deepEqual(s.endSession(k.id), { discarded: false });
});
