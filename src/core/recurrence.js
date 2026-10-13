// When does a (possibly repeating) reminder fire?
// Adapted from Jotter. The same rules are mirrored in the Android alarm code
// (ReminderMath.java) so the app and the phone always agree.
//
// A reminder is { at, repeat, snoozedUntil?, doneAt? }:
//   at            the first occurrence (ms since epoch); later ones are computed from it
//   repeat        'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
//   snoozedUntil  if set and still in the future, the next alert is then instead
//   doneAt        a one-off reminder that was marked done

export const REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

const DAY = 86400000;

function daysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// The k-th occurrence, always computed from the original start so that
// "monthly on the 31st" stays on the 31st whenever the month allows it.
export function occurrence(start, repeat, k) {
  const d = new Date(start);
  const day = d.getDate();
  switch (repeat) {
    case 'daily':
      d.setDate(day + k);
      break;
    case 'weekly':
      d.setDate(day + 7 * k);
      break;
    case 'monthly':
      d.setDate(1);
      d.setMonth(d.getMonth() + k);
      d.setDate(Math.min(day, daysInMonth(d)));
      break;
    case 'yearly':
      d.setDate(1);
      d.setFullYear(d.getFullYear() + k);
      d.setDate(Math.min(day, daysInMonth(d)));
      break;
  }
  return d.getTime();
}

function estimate(start, repeat, now) {
  const s = new Date(start);
  const n = new Date(now);
  switch (repeat) {
    case 'daily': return Math.floor((now - start) / DAY);
    case 'weekly': return Math.floor((now - start) / (7 * DAY));
    case 'monthly': return (n.getFullYear() - s.getFullYear()) * 12 + n.getMonth() - s.getMonth();
    case 'yearly': return n.getFullYear() - s.getFullYear();
    default: return 0;
  }
}

function valid(reminder) {
  return reminder && Number.isFinite(reminder.at);
}

export function repeatOf(reminder) {
  return REPEATS.includes(reminder?.repeat) ? reminder.repeat : 'none';
}

// Index of the latest occurrence at or before `now` (assumes start <= now).
function latestIndex(at, repeat, now) {
  let k = Math.max(0, estimate(at, repeat, now));
  while (k > 0 && occurrence(at, repeat, k) > now) k--;
  while (occurrence(at, repeat, k + 1) <= now) k++;
  return k;
}

/** The most recent scheduled time at or before now, or null if none yet. */
export function latestOccurrence(reminder, now = Date.now()) {
  if (!valid(reminder) || reminder.at > now) return null;
  const repeat = repeatOf(reminder);
  if (repeat === 'none') return reminder.at;
  return occurrence(reminder.at, repeat, latestIndex(reminder.at, repeat, now));
}

/** The next scheduled time strictly after now (ignoring snooze), or null. */
export function nextOccurrence(reminder, now = Date.now()) {
  if (!valid(reminder)) return null;
  if (reminder.at > now) return reminder.at;
  const repeat = repeatOf(reminder);
  if (repeat === 'none') return null;
  return occurrence(reminder.at, repeat, latestIndex(reminder.at, repeat, now) + 1);
}

/** When the phone should next alert for this reminder, or null if never. */
export function nextAlert(reminder, now = Date.now()) {
  if (!valid(reminder)) return null;
  if (reminder.snoozedUntil && reminder.snoozedUntil > now) return reminder.snoozedUntil;
  if (repeatOf(reminder) === 'none' && reminder.doneAt) return null;
  return nextOccurrence(reminder, now);
}

/**
 * Is the reminder overdue (fired and not dealt with)? Only one-off reminders can be:
 * a repeating reminder simply moves on to its next occurrence.
 */
export function isOverdue(reminder, now = Date.now()) {
  if (!valid(reminder) || repeatOf(reminder) !== 'none') return false;
  if (reminder.doneAt) return false;
  if (reminder.snoozedUntil && reminder.snoozedUntil > now) return false;
  return reminder.at <= now;
}

/** The time to show on cards and in the reminder sheet. */
export function displayTime(reminder, now = Date.now()) {
  if (!valid(reminder)) return null;
  if (reminder.snoozedUntil && reminder.snoozedUntil > now) return reminder.snoozedUntil;
  return nextOccurrence(reminder, now) ?? reminder.at;
}
