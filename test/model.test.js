import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  textToItems, itemsToText, setDone, setIndent, pasteLines, moveItem, splitChecked, progress, convertPatch, displayTitle,
} from '../src/core/model.js';
import { prune, snapshotOf, sameContent } from '../src/core/versions.js';

const it = (id, text, extra = {}) => ({ id, text, done: false, indent: 0, ...extra });

test('textToItems understands bullets, tasks, numbers and indents', () => {
  const items = textToItems('- [x] milk\n* bread\n  - [ ] sub\n1. one\n٢. اثنان\n\n   \nplain');
  assert.deepEqual(items.map((i) => [i.text, i.done, i.indent]), [
    ['milk', true, 0], ['bread', false, 0], ['sub', false, 1], ['one', false, 0], ['اثنان', false, 0], ['plain', false, 0],
  ]);
});

test('itemsToText round-trips', () => {
  const items = [it('a', 'x', { done: true }), it('b', 'y', { indent: 1 })];
  assert.equal(itemsToText(items), '- [x] x\n  - [ ] y');
  assert.deepEqual(textToItems(itemsToText(items)).map((i) => [i.text, i.done, i.indent]), [['x', true, 0], ['y', false, 1]]);
});

test('ticking a parent ticks its children; unticking a child unticks the parent', () => {
  let items = [it('p', 'parent'), it('c1', 'c1', { indent: 1 }), it('c2', 'c2', { indent: 1 }), it('q', 'next')];
  items = setDone(items, 'p', true);
  assert.deepEqual(items.map((i) => i.done), [true, true, true, false]);
  items = setDone(items, 'c2', false);
  assert.deepEqual(items.map((i) => i.done), [false, true, false, false]);
});

test('first item cannot be indented', () => {
  const items = [it('a', 'a'), it('b', 'b')];
  assert.equal(setIndent(items, 'a', 1)[0].indent, 0);
  assert.equal(setIndent(items, 'b', 1)[1].indent, 1);
});

test('pasting several lines creates several items', () => {
  const items = [it('a', 'hello world')];
  const { items: out, focusId } = pasteLines(items, 'a', 6, 11, 'one\ntwo\nthree');
  assert.deepEqual(out.map((i) => i.text), ['hello one', 'two', 'three']);
  assert.equal(focusId, out[2].id);
  const { items: out2 } = pasteLines([it('a', 'abc')], 'a', 1, 1, 'X\nY');
  assert.deepEqual(out2.map((i) => i.text), ['aX', 'Ybc']);
});

test('moving an item carries its sub-items', () => {
  const items = [it('a', 'a'), it('b', 'b'), it('b1', 'b1', { indent: 1 }), it('c', 'c')];
  assert.deepEqual(moveItem(items, 'b', 'a').map((i) => i.id), ['b', 'b1', 'a', 'c']);
  assert.deepEqual(moveItem(items, 'a', null).map((i) => i.id), ['b', 'b1', 'c', 'a']);
  const indented = moveItem(items, 'c', 'b1', 1);
  assert.deepEqual(indented.map((i) => [i.id, i.indent]), [['a', 0], ['b', 0], ['c', 1], ['b1', 1]]);
  assert.equal(moveItem(items, 'b1', 'a', 1)[0].indent, 0, 'nothing can be indented at the top');
});

test('checked items split off, parents keep their children', () => {
  const items = [it('a', 'a', { done: true }), it('a1', 'a1', { indent: 1, done: true }), it('b', 'b'), it('b1', 'b1', { indent: 1, done: true }), it('c', 'c')];
  const { active, done } = splitChecked(items);
  assert.deepEqual(active.map((i) => i.id), ['b', 'c']);
  assert.deepEqual(done.map((i) => i.id), ['a', 'a1', 'b1']);
});

test('progress counts non-empty items', () => {
  assert.deepEqual(progress({ type: 'list', items: [it('a', 'x', { done: true }), it('b', 'y'), it('c', ' ')] }), { done: 1, total: 2 });
  assert.equal(progress({ type: 'note', items: [] }), null);
});

test('converting between note and checklist loses nothing', () => {
  const list = { type: 'list', body: '', items: [it('a', 'one', { done: true }), it('b', 'two')] };
  const asNote = convertPatch(list);
  assert.equal(asNote.body, '- [x] one\n- [ ] two');
  const back = convertPatch({ ...list, ...asNote });
  assert.deepEqual(back.items.map((i) => [i.text, i.done]), [['one', true], ['two', false]]);
});

test('displayTitle falls back to the first line', () => {
  assert.equal(displayTitle({ title: '', type: 'note', body: '\n# Shopping\nmore' }), 'Shopping');
  assert.equal(displayTitle({ title: ' T ', body: 'x' }), 'T');
});

test('version pruning keeps recent, daily, then monthly', () => {
  const now = new Date('2026-10-14T12:00').getTime();
  const H = 3600000;
  const D = 24 * H;
  const v = [
    { id: 1, savedAt: now - 1 * H }, { id: 2, savedAt: now - 2 * H }, // recent: both kept
    { id: 3, savedAt: now - 5 * D }, { id: 4, savedAt: now - 5 * D - H }, // same day: newest kept
    { id: 5, savedAt: now - 60 * D }, { id: 6, savedAt: now - 61 * D }, // same month (Aug): newest kept
  ];
  assert.deepEqual(prune(v, now).sort(), [4, 6]);
});

test('snapshots compare by content only', () => {
  const n = { type: 'note', title: 'a', body: 'b', items: [], attachments: [], pinned: true, updatedAt: 5 };
  assert.ok(sameContent(snapshotOf(n), { ...n, pinned: false }));
  assert.ok(!sameContent(snapshotOf(n), { ...n, body: 'c' }));
});
