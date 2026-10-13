import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, matchRanges, queryTerms } from '../src/core/normalize.js';
import { searchNotes } from '../src/core/search.js';

test('tashkeel and tatweel are ignored', () => {
  assert.equal(fold('مُحَمَّدٌ'), 'محمد');
  assert.equal(fold('جـــمـيـل'), 'جميل');
  assert.equal(fold('الرَّحْمٰنِ'), 'الرحمن');
});

test('alef forms, ta marbuta and alef maqsura are folded', () => {
  assert.equal(fold('أحمد'), 'احمد');
  assert.equal(fold('إسلام'), 'اسلام');
  assert.equal(fold('آمن'), 'امن');
  assert.equal(fold('ٱلله'), 'الله');
  assert.equal(fold('مدرسة'), 'مدرسه');
  assert.equal(fold('مستشفى'), 'مستشفي');
  assert.equal(fold('علي'), fold('على'));
});

test('Persian yeh/kaf and hamza seats fold too', () => {
  assert.equal(fold('کتاب'), 'كتاب');
  assert.equal(fold('ی'), 'ي');
  assert.equal(fold('مسؤول'), 'مسوول');
});

test('digits and Latin', () => {
  assert.equal(fold('٢٠٢٦'), '2026');
  assert.equal(fold('۱۲'), '12');
  assert.equal(fold('Café RÉSUMÉ'), 'cafe resume');
  assert.equal(fold('a   b\n\tc'), 'a b c');
});

test('queryTerms splits and folds', () => {
  assert.deepEqual(queryTerms('  المدرسةُ   Notes '), ['المدرسه', 'notes']);
  assert.deepEqual(queryTerms('   '), []);
});

test('matchRanges map back to the original text, keeping harakat', () => {
  const text = 'ذهبتُ إلى المَدرسةِ اليوم';
  const r = matchRanges(text, queryTerms('مدرسه'));
  assert.equal(r.length, 1);
  assert.equal(text.slice(r[0][0], r[0][1]), 'مَدرسةِ');
  const r2 = matchRanges('Hello WORLD', queryTerms('world'));
  assert.deepEqual(r2, [[6, 11]]);
  const r3 = matchRanges('٣ أقلام', queryTerms('3'));
  assert.deepEqual(r3, [[0, 1]]);
});

const notes = [
  { id: 'a', title: 'قائمة التسوّق', body: '', type: 'list', items: [{ id: '1', text: 'حليب' }, { id: '2', text: 'bread' }], labels: [], updatedAt: 1 },
  { id: 'b', title: 'Meeting', body: 'نناقش خطة المدرسة', type: 'note', items: [], labels: ['l1'], updatedAt: 3 },
  { id: 'c', title: 'المدرسة', body: 'school stuff', type: 'note', items: [], labels: [], updatedAt: 2 },
];
const labelName = (id) => ({ l1: 'عمل' }[id] || '');

test('searches titles, bodies, checklist items and labels', () => {
  assert.deepEqual(searchNotes(notes, 'حليب').map((n) => n.id), ['a']);
  assert.deepEqual(searchNotes(notes, 'BREAD').map((n) => n.id), ['a']);
  assert.deepEqual(searchNotes(notes, 'عمل', labelName).map((n) => n.id), ['b']);
  assert.deepEqual(searchNotes(notes, 'التسوق').map((n) => n.id), ['a']);
});

test('title matches rank first, then most recent', () => {
  assert.deepEqual(searchNotes(notes, 'مدرسه').map((n) => n.id), ['c', 'b']);
});

test('all terms must match', () => {
  assert.deepEqual(searchNotes(notes, 'مدرسة school').map((n) => n.id), ['c']);
  assert.deepEqual(searchNotes(notes, 'مدرسة nothing'), []);
});
