import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, serializeBlocks, bodyProgress, splitForChecklist } from '../src/core/blocks.js';
import { progress, noteToPlainText } from '../src/core/model.js';

const shape = (blocks) => blocks.map((b) => (b.kind === 'text' ? ['text', b.text] : ['tasks', b.items.map((i) => [i.text, i.done, i.indent])]));

test('text and checklists split into blocks', () => {
  const body = 'مقدمة\nسطر ثانٍ\n- [ ] حليب\n- [x] bread\n  - [ ] sub\nخاتمة';
  assert.deepEqual(shape(parseBlocks(body)), [
    ['text', 'مقدمة\nسطر ثانٍ'],
    ['tasks', [['حليب', false, 0], ['bread', true, 0], ['sub', false, 1]]],
    ['text', 'خاتمة'],
  ]);
});

test('round-trips exactly, including blank lines and lists at either end', () => {
  for (const body of [
    '',
    'just text',
    '- [ ] first\ntext after',
    'text before\n- [ ] last',
    'a\n\n- [ ] x\n\n- [x] y\n\nb',
    '- [ ] \n- [ ] empty items too',
    'line\n\n\nwith gaps',
  ]) {
    assert.equal(serializeBlocks(parseBlocks(body)), body, JSON.stringify(body));
  }
});

test('the empty writing space after a list is not saved until used', () => {
  const blocks = parseBlocks('intro\n- [ ] a');
  blocks.push({ kind: 'text', text: '', virtual: true });
  assert.equal(serializeBlocks(blocks), 'intro\n- [ ] a');
  blocks[2].text = 'then more';
  assert.equal(serializeBlocks(blocks), 'intro\n- [ ] a\nthen more');
});

test('emptied checklists disappear without touching the text', () => {
  const blocks = parseBlocks('above\n- [ ] gone\nbelow');
  blocks[1].items = [];
  assert.equal(serializeBlocks(blocks), 'above\nbelow');
});

test('a new checklist goes on an empty line, above a line, or below it', () => {
  assert.deepEqual(splitForChecklist('one\n\ntwo', 4), { before: 'one', after: 'two', at: 'replace' });
  assert.deepEqual(splitForChecklist('one\ntwo', 4), { before: 'one', after: 'two', at: 'above' });
  assert.deepEqual(splitForChecklist('one\ntwo', 2), { before: 'one', after: 'two', at: 'below' });
  assert.deepEqual(splitForChecklist('one', 3), { before: 'one', after: '', at: 'below' });
  assert.deepEqual(splitForChecklist('', 0), { before: '', after: '', at: 'replace' });
});

test('progress counts checklists inside notes too', () => {
  assert.deepEqual(bodyProgress('x\n- [x] a\n- [ ] b\n- [ ] '), { done: 1, total: 2 });
  assert.equal(bodyProgress('no tasks'), null);
  assert.deepEqual(progress({ type: 'note', body: '- [x] a\ntext' }), { done: 1, total: 1 });
});

test('shared text shows boxes instead of Markdown', () => {
  assert.equal(noteToPlainText({ type: 'note', title: 'T', body: 'hi\n- [x] done\n  - [ ] sub' }), 'T\n\nhi\n☑ done\n    ☐ sub');
});
