// Arabic-aware text folding for search.
//
// Both the note text and the query are folded the same way, so a search matches
// however the words were typed:
//   - tashkeel (harakat, shadda, sukun, tanween, dagger alef, Quranic marks) and
//     tatweel (ـ) are ignored
//   - أ إ آ ٱ → ا,  ة → ه,  ى → ي  (also Persian ی → ي and ک → ك, which some keyboards produce)
//   - hamza on a seat folds to the seat (ؤ → و, ئ → ي), a side effect of removing marks
//   - Arabic-Indic and Persian digits → 0-9, so "٣" finds "3"
//   - Latin is lower-cased and accents are dropped (é → e)
//
// foldWithMap() also returns, for every folded character, the index of the original
// character it came from, so matches can be highlighted in the original text.

const DROP = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ̀-ͯ‌-‏‪-‮⁦-⁩]/;

const MAP = {
  'أ': 'ا', // أ
  'إ': 'ا', // إ
  'آ': 'ا', // آ
  'ٱ': 'ا', // ٱ
  'ة': 'ه', // ة → ه
  'ى': 'ي', // ى → ي
  'ی': 'ي', // ی → ي
  'ک': 'ك', // ک → ك
  'ؤ': 'و', // ؤ → و
  'ئ': 'ي', // ئ → ي
};

function foldChar(ch) {
  const code = ch.codePointAt(0);
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  if (code >= 0x06F0 && code <= 0x06F9) return String(code - 0x06F0);
  if (MAP[ch]) return MAP[ch];
  if (DROP.test(ch)) return '';
  if (code < 0x0600 || code > 0x06FF) {
    // Latin and everything else: decompose, drop combining accents, lower-case.
    let out = '';
    for (const c of ch.normalize('NFD')) if (!DROP.test(c)) out += c;
    return out.toLowerCase();
  }
  return ch;
}

/** Fold a string for comparison. */
export function fold(text) {
  let out = '';
  for (const ch of String(text ?? '')) out += foldChar(ch);
  return out.replace(/\s+/g, ' ');
}

/** Fold a string and remember where each folded character came from. */
export function foldWithMap(text) {
  const src = String(text ?? '');
  let out = '';
  const map = [];
  let i = 0;
  let lastSpace = false;
  for (const ch of src) {
    let f = foldChar(ch);
    if (/^\s+$/.test(f)) {
      if (lastSpace) f = '';
      else f = ' ';
    }
    for (const c of f) {
      out += c;
      map.push(i);
    }
    if (f) lastSpace = f === ' ';
    i += ch.length;
  }
  map.push(src.length);
  return { text: out, map };
}

/** Split a query into folded terms (all must match). */
export function queryTerms(query) {
  return fold(query).trim().split(' ').filter(Boolean);
}

/**
 * Ranges [start, end) in the ORIGINAL text where any term matches,
 * merged and sorted. Used to highlight search matches.
 */
export function matchRanges(text, terms) {
  if (!terms.length || !text) return [];
  const { text: folded, map } = foldWithMap(text);
  const ranges = [];
  for (const t of terms) {
    let from = 0;
    for (;;) {
      const at = folded.indexOf(t, from);
      if (at < 0) break;
      ranges.push([map[at], map[at + t.length - 1] + charLen(text, map[at + t.length - 1])]);
      from = at + Math.max(1, t.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  // Extend each range over trailing marks (tashkeel) so a highlighted letter keeps its harakat.
  for (const r of merged) {
    while (r[1] < text.length && DROP.test(text[r[1]])) r[1]++;
  }
  return merged;
}

function charLen(text, i) {
  const c = text.codePointAt(i);
  return c > 0xffff ? 2 : 1;
}
