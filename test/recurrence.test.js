import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextOccurrence, latestOccurrence, nextAlert, isOverdue } from '../src/core/recurrence.js';

const t = (s) => new Date(s).getTime();

test('one-off reminders', () => {
  const r = { at: t('2026-10-15T08:00'), repeat: 'none' };
  assert.equal(nextOccurrence(r, t('2026-10-14T00:00')), r.at);
  assert.equal(nextOccurrence(r, t('2026-10-16T00:00')), null);
  assert.equal(latestOccurrence(r, t('2026-10-16T00:00')), r.at);
  assert.equal(isOverdue(r, t('2026-10-16T00:00')), true);
  assert.equal(isOverdue({ ...r, doneAt: 1 }, t('2026-10-16T00:00')), false);
  assert.equal(nextAlert({ ...r, doneAt: 1 }, t('2026-10-14T00:00')), null);
});

test('daily and weekly', () => {
  const d = { at: t('2026-10-01T09:30'), repeat: 'daily' };
  assert.equal(nextOccurrence(d, t('2026-10-14T10:00')), t('2026-10-15T09:30'));
  assert.equal(nextOccurrence(d, t('2026-10-14T09:00')), t('2026-10-14T09:30'));
  const w = { at: t('2026-10-02T18:00'), repeat: 'weekly' }; // a Friday
  assert.equal(nextOccurrence(w, t('2026-10-14T12:00')), t('2026-10-16T18:00'));
});

test('monthly on the 31st stays on the 31st when it can', () => {
  const m = { at: t('2026-01-31T08:00'), repeat: 'monthly' };
  assert.equal(nextOccurrence(m, t('2026-02-01T00:00')), t('2026-02-28T08:00'));
  assert.equal(nextOccurrence(m, t('2026-03-01T00:00')), t('2026-03-31T08:00'));
  assert.equal(nextOccurrence(m, t('2026-04-01T00:00')), t('2026-04-30T08:00'));
});

test('yearly on 29 February', () => {
  const y = { at: t('2028-02-29T08:00'), repeat: 'yearly' };
  assert.equal(nextOccurrence(y, t('2028-03-01T00:00')), t('2029-02-28T08:00'));
  assert.equal(nextOccurrence(y, t('2031-03-01T00:00')), t('2032-02-29T08:00'));
});

test('snooze overrides the next alert while in the future', () => {
  const r = { at: t('2026-10-14T08:00'), repeat: 'daily', snoozedUntil: t('2026-10-14T08:30') };
  assert.equal(nextAlert(r, t('2026-10-14T08:05')), t('2026-10-14T08:30'));
  assert.equal(nextAlert(r, t('2026-10-14T09:00')), t('2026-10-15T08:00'));
});
