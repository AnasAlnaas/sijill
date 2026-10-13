import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setFormatPrefs, num, date, fraction } from '../src/core/format.js';

const oct14 = new Date('2026-10-14T08:00').getTime();

test('numerals follow the setting', () => {
  setFormatPrefs({ lang: 'ar', numerals: 'arab', calendar: 'gregory' });
  assert.equal(num(2026), '٢٠٢٦');
  assert.equal(fraction(3, 7), '⁨٣/٧⁩');
  setFormatPrefs({ numerals: 'latn' });
  assert.equal(num(2026), '2026');
});

test('Gregorian, Hijri and both', () => {
  setFormatPrefs({ lang: 'en', numerals: 'latn', calendar: 'gregory' });
  assert.match(date(oct14, { year: 'always' }), /14 Oct 2026/);
  setFormatPrefs({ calendar: 'hijri' });
  assert.match(date(oct14), /3 Jumada I 1448/);
  assert.match(date(oct14), /1448/);
  setFormatPrefs({ lang: 'ar', numerals: 'arab', calendar: 'both' });
  const both = date(oct14, { year: 'always' });
  assert.match(both, /أكتوبر/);
  assert.match(both, /١٤٤٨/);
  assert.match(both, / · /);
});
