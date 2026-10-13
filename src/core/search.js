// Instant search across titles, text, checklist items and label names.
// Everything is folded with the Arabic-aware rules in normalize.js. The folded text of
// each note is cached and only recomputed when the note changes.

import { fold, queryTerms } from './normalize.js';

const cache = new WeakMap();

function haystack(note, labelName) {
  let entry = cache.get(note);
  const labelKey = (note.labels || []).map(labelName).join('\u0001');
  if (entry && entry.labelKey === labelKey) return entry;
  const items = (note.items || []).map((i) => i.text).join('\n');
  entry = {
    labelKey,
    title: fold(note.title),
    all: fold([note.title, note.body, items, labelKey.replace(/\u0001/g, ' ')].join('\n')),
  };
  cache.set(note, entry);
  return entry;
}

/**
 * Notes matching every term of `query`, best first:
 * matches in the title rank above matches only in the text, then most recently edited.
 * labelName(id) → label name (so searching a label's name finds its notes).
 */
export function searchNotes(notes, query, labelName = () => '') {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const hits = [];
  for (const note of notes) {
    const h = haystack(note, labelName);
    if (!terms.every((t) => h.all.includes(t))) continue;
    const titleHits = terms.filter((t) => h.title.includes(t)).length;
    hits.push({ note, score: titleHits });
  }
  hits.sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt);
  return hits.map((h) => h.note);
}
