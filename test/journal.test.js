import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journalCalendar, monthKey, calendarDate, monthlyOccurrences, isMonth, compareMonths } from '../src/core/journal.js';

const t = (s) => new Date(s).getTime();

test('months follow the calendar setting ("both" counts in Gregorian)', () => {
  assert.equal(journalCalendar('hijri'), 'hijri');
  assert.equal(journalCalendar('gregory'), 'gregory');
  assert.equal(journalCalendar('both'), 'gregory');
});

test('month of a date in each calendar', () => {
  assert.deepEqual(monthKey(t('2026-10-15T09:00'), 'gregory'), { cal: 'gregory', year: 2026, month: 10 });
  // 15 October 2026 is 4 Jumada I 1448 (Umm al-Qura); Jumada I is month 5.
  assert.deepEqual(monthKey(t('2026-10-15T09:00'), 'hijri'), { cal: 'hijri', year: 1448, month: 5 });
  assert.equal(calendarDate(t('2026-10-15T23:30'), 'hijri').day, 4);
});

test('monthly reminder dates in the Gregorian calendar', () => {
  const r = monthlyOccurrences({ day: 1, time: '20:30' }, 'gregory', t('2026-10-15T10:00'), 3);
  assert.deepEqual(r, [t('2026-11-01T20:30'), t('2026-12-01T20:30'), t('2027-01-01T20:30')]);
  const today = monthlyOccurrences({ day: 15, time: '20:00' }, 'gregory', t('2026-10-15T10:00'), 1);
  assert.deepEqual(today, [t('2026-10-15T20:00')], 'later today still counts');
});

test('monthly reminder dates in the Hijri calendar fall on that Hijri day, a month apart', () => {
  const r = monthlyOccurrences({ day: 1, time: '09:00' }, 'hijri', t('2026-10-15T10:00'), 4);
  assert.equal(r.length, 4);
  let prev = null;
  for (const ms of r) {
    const d = calendarDate(ms, 'hijri');
    assert.equal(d.day, 1);
    if (prev) assert.equal((d.month - prev.month + 12) % 12, 1, 'consecutive Hijri months');
    prev = d;
    assert.equal(new Date(ms).getHours(), 9);
  }
});

test('finding and ordering monthly entries', () => {
  const a = { journal: { cal: 'hijri', year: 1448, month: 5 } };
  const b = { journal: { cal: 'hijri', year: 1448, month: 4 } };
  const c = { journal: { cal: 'hijri', year: 1447, month: 12 } };
  assert.ok(isMonth(a, { cal: 'hijri', year: 1448, month: 5 }));
  assert.ok(!isMonth(a, { cal: 'gregory', year: 1448, month: 5 }));
  assert.deepEqual([c, a, b].sort(compareMonths), [a, b, c]);
});
