import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importKeepEntries, keepToNote } from '../src/core/keep.js';
import { makeZip, readZip } from '../src/core/zip.js';
import { planRestore, validate, markdownFiles, manifest } from '../src/core/backup.js';

const keepNote = {
  color: 'RED',
  isTrashed: false,
  isPinned: true,
  isArchived: false,
  textContent: 'نص الملاحظة\nline two',
  title: 'عنوان',
  userEditedTimestampUsec: 1700000000000000,
  createdTimestampUsec: 1690000000000000,
  labels: [{ name: 'عمل' }, { name: 'Ideas' }],
  attachments: [{ filePath: 'photo.jpg', mimetype: 'image/jpeg' }],
  annotations: [{ source: 'WEBLINK', title: 'Example', url: 'https://example.com' }],
};
const keepList = {
  color: 'DEFAULT', isTrashed: true, isPinned: false, isArchived: false, title: 'List',
  userEditedTimestampUsec: 1700000001000000, createdTimestampUsec: 1690000001000000,
  listContent: [{ text: 'milk', isChecked: true }, { text: 'bread', isChecked: false }],
};
const archived = { ...keepList, isTrashed: false, isArchived: true, isPinned: true, createdTimestampUsec: 1690000002000000, title: 'Old' };

async function takeoutZip() {
  return makeZip([
    { name: 'Takeout/Keep/عنوان.json', data: JSON.stringify(keepNote) },
    { name: 'Takeout/Keep/List.json', data: JSON.stringify(keepList) },
    { name: 'Takeout/Keep/Old.json', data: JSON.stringify(archived) },
    { name: 'Takeout/Keep/Labels.txt', data: 'عمل\nIdeas' },
    { name: 'Takeout/Keep/photo.jpeg', data: new Uint8Array([1, 2, 3]) }, // .jpeg on disk, .jpg in JSON
    { name: 'Takeout/archive_browser.html', data: '<html></html>' },
  ]);
}

function fakeApi() {
  const notes = [];
  const labels = new Map();
  return {
    notes,
    labels,
    hasKey: (k) => notes.some((n) => n.source.key === k),
    labelId: (name) => {
      if (!labels.has(name)) labels.set(name, `L${labels.size}`);
      return labels.get(name);
    },
    saveFile: async (blob, name, type) => ({ id: `F${name}`, name, type, size: blob.size }),
    createNote: (n) => notes.push(n),
  };
}

async function entriesOf(blob) {
  const file = Object.assign(blob, { name: 'takeout.zip' });
  return (await readZip(file)).map((e) => ({ path: e.name, text: () => e.text(), blob: (t) => e.blob(t) }));
}

test('Keep note fields are mapped', () => {
  const n = keepToNote(keepNote, { now: 5 });
  assert.equal(n.title, 'عنوان');
  assert.equal(n.marker, 'circle');
  assert.equal(n.pinned, true);
  assert.equal(n.createdAt, 1690000000000);
  assert.equal(n.updatedAt, 1700000000000);
  assert.match(n.body, /\[Example\]\(https:\/\/example\.com\)$/);
  assert.deepEqual(n.labelNames, ['عمل', 'Ideas']);
});

test('importing a Takeout zip keeps everything, and re-importing makes no duplicates', async () => {
  const api = fakeApi();
  const entries = await entriesOf(await takeoutZip());
  const r1 = await importKeepEntries(entries, api);
  assert.equal(r1.imported, 3);
  assert.equal(r1.attachments, 1);
  assert.equal(r1.missingFiles, 0);
  const list = api.notes.find((n) => n.title === 'List');
  assert.equal(list.type, 'list');
  assert.deepEqual(list.items.map((i) => [i.text, i.done]), [['milk', true], ['bread', false]]);
  assert.ok(list.trashedAt);
  const old = api.notes.find((n) => n.title === 'Old');
  assert.equal(old.archived, true);
  assert.equal(old.pinned, false, 'archived notes are not pinned');
  const note = api.notes.find((n) => n.title === 'عنوان');
  assert.deepEqual(note.labels, ['L0', 'L1']);
  assert.equal(note.attachments[0].name, 'photo.jpeg');

  const r2 = await importKeepEntries(await entriesOf(await takeoutZip()), api);
  assert.equal(r2.imported, 0);
  assert.equal(r2.duplicates, 3);
  assert.equal(api.notes.length, 3);
});

test('a backup zip round-trips through the zip reader', async () => {
  const notes = [{ id: 'n1', type: 'note', title: 'مرحبا', body: 'hello', items: [], labels: ['l1'], attachments: [], createdAt: 1, updatedAt: 2 }];
  const labels = [{ id: 'l1', name: 'عمل' }];
  const zip = await makeZip([
    { name: 'sijill.json', data: JSON.stringify(manifest({ notes, labels })) },
    ...markdownFiles(notes, { labelName: (id) => labels.find((l) => l.id === id)?.name }),
  ]);
  const entries = await readZip(Object.assign(zip, { name: 'b.zip' }));
  const data = validate(JSON.parse(await entries.find((e) => e.name === 'sijill.json').text()));
  assert.deepEqual(data.notes, notes);
  const md = await entries.find((e) => e.name === 'notes/مرحبا.md').text();
  assert.match(md, /labels: \["عمل"\]/);
  assert.match(md, /# مرحبا\n\nhello/);
});

test('restore adds missing, replaces older, keeps newer, merges labels by name', () => {
  const local = {
    notes: new Map([['a', { id: 'a', updatedAt: 10 }], ['b', { id: 'b', updatedAt: 10 }]]),
    labels: new Map([['x', { id: 'x', name: 'Work' }]]),
  };
  const data = {
    format: 'sijill-backup', version: 1,
    labels: [{ id: 'y', name: 'work ' }, { id: 'z', name: 'Home' }],
    notes: [
      { id: 'a', updatedAt: 20, labels: ['y'] },
      { id: 'b', updatedAt: 5, labels: [] },
      { id: 'c', updatedAt: 1, labels: ['z', 'y'] },
    ],
  };
  const plan = planRestore(validate(data), local);
  assert.deepEqual(plan.replaceNotes.map((n) => [n.id, n.labels]), [['a', ['x']]]);
  assert.deepEqual(plan.addNotes.map((n) => [n.id, n.labels]), [['c', ['z', 'x']]]);
  assert.equal(plan.keepNotes, 1);
  assert.deepEqual(plan.addLabels.map((l) => l.id), ['z']);
});

test('validate rejects other files', () => {
  assert.throws(() => validate({ format: 'jotter-backup' }), /not-a-backup/);
  assert.throws(() => validate({ format: 'sijill-backup', version: 99, notes: [], labels: [] }), /newer-version/);
});
