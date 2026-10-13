// Version history policy.
//
// Before the first change of each editing session, the note's previous state is saved
// as a version. That way every earlier state is in history even if the app is killed
// mid-edit, and the current text is always the note itself.
//
// To keep history useful without growing forever, prune() keeps:
//   - every version from the last 2 days,
//   - one per day (the latest of that day) for the last 30 days,
//   - one per month after that,
// and never more than MAX versions per note.

const DAY = 86400000;
export const MAX = 100;

/** The fields that make up a note's content in history (not its pin/archive state). */
export const VERSIONED = ['type', 'title', 'body', 'items', 'attachments'];

export function snapshotOf(note) {
  const s = { savedAt: note.updatedAt };
  for (const k of VERSIONED) s[k] = structuredClone(note[k]);
  return s;
}

export function sameContent(a, b) {
  return VERSIONED.every((k) => JSON.stringify(a?.[k] ?? null) === JSON.stringify(b?.[k] ?? null));
}

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

/**
 * versions: [{ id, savedAt }] for one note. Returns the ids to delete.
 */
export function prune(versions, now = Date.now()) {
  const sorted = [...versions].sort((a, b) => b.savedAt - a.savedAt);
  const keep = new Set();
  const seenDay = new Set();
  const seenMonth = new Set();
  for (const v of sorted) {
    const age = now - v.savedAt;
    if (age < 2 * DAY) keep.add(v.id);
    else if (age < 30 * DAY) {
      const k = dayKey(v.savedAt);
      if (!seenDay.has(k)) {
        seenDay.add(k);
        keep.add(v.id);
      }
    } else {
      const k = monthKey(v.savedAt);
      if (!seenMonth.has(k)) {
        seenMonth.add(k);
        keep.add(v.id);
      }
    }
  }
  const kept = sorted.filter((v) => keep.has(v.id)).slice(0, MAX);
  const keptIds = new Set(kept.map((v) => v.id));
  return sorted.filter((v) => !keptIds.has(v.id)).map((v) => v.id);
}
