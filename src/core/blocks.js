// A note's text is plain Markdown. Checklists inside it are ordinary task lines:
//   - [ ] milk
//   - [x] bread
//     - [ ] a sub-item (two spaces of indent)
// For editing, the text is split into blocks — runs of ordinary lines ("text") and runs of
// task lines ("tasks") — and joined back exactly, so text around a checklist is never touched.

import { uid } from './model.js';

export const TASK_RE = /^(\s*)[-*+] \[([ xX])\](?: (.*))?$/;

export function isTaskLine(line) {
  return TASK_RE.test(line);
}

export function parseTask(line) {
  const m = TASK_RE.exec(line);
  if (!m) return null;
  return { id: uid(), text: m[3] || '', done: m[2] !== ' ', indent: m[1].replace(/\t/g, '  ').length >= 2 ? 1 : 0 };
}

export function taskLine(item) {
  return `${item.indent ? '  ' : ''}- [${item.done ? 'x' : ' '}] ${item.text}`;
}

/** body → [{ kind: 'text', text } | { kind: 'tasks', items }] */
export function parseBlocks(body) {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let text = null;
  let tasks = null;
  for (const line of lines) {
    const item = parseTask(line);
    if (item) {
      if (text) {
        blocks.push({ kind: 'text', text: text.join('\n') });
        text = null;
      }
      if (!tasks) tasks = [];
      tasks.push(item);
    } else {
      if (tasks) {
        blocks.push({ kind: 'tasks', items: tasks });
        tasks = null;
      }
      if (!text) text = [];
      text.push(line);
    }
  }
  if (tasks) blocks.push({ kind: 'tasks', items: tasks });
  if (text) blocks.push({ kind: 'text', text: text.join('\n') });
  return blocks;
}

/**
 * blocks → body. A text block marked `virtual` (the empty writing space the editor adds
 * after a trailing checklist) only counts once something is typed in it.
 */
export function serializeBlocks(blocks) {
  return blocks
    .filter((b) => !(b.kind === 'text' && b.virtual && !b.text))
    .filter((b) => !(b.kind === 'tasks' && !b.items.length))
    .map((b) => (b.kind === 'text' ? b.text : b.items.map(taskLine).join('\n')))
    .join('\n');
}

/** Checklist progress over all task lines in a note's text, or null if there are none. */
export function bodyProgress(body) {
  let done = 0;
  let total = 0;
  for (const line of String(body ?? '').split('\n')) {
    const t = parseTask(line);
    if (t && t.text.trim()) {
      total++;
      if (t.done) done++;
    }
  }
  return total ? { done, total } : null;
}

/**
 * Where to put a new checklist when the caret is at `pos` in a text block:
 *   - on an empty line: the checklist replaces that line,
 *   - at the very start of a line with text: above that line,
 *   - anywhere else: below the caret's line.
 * Returns { before, after } — the text that stays above and below the new checklist.
 */
export function splitForChecklist(text, pos) {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = text.indexOf('\n', pos);
  if (lineEnd < 0) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  const cut = (a, b) => ({ before: text.slice(0, a).replace(/\n$/, ''), after: text.slice(b).replace(/^\n/, '') });
  if (!line.trim()) return { ...cut(lineStart, lineEnd), at: 'replace' };
  if (pos === lineStart) return { ...cut(lineStart, lineStart), at: 'above' };
  return { ...cut(lineEnd, lineEnd), at: 'below' };
}
