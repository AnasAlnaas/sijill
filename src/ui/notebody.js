// The writing area of a note: free text with checklists anywhere inside it.
// The text is split into blocks (see core/blocks.js): each run of ordinary lines is a text
// area, each run of task lines is an inline checklist. Every change is joined back into the
// note's Markdown text, so the text around a checklist is never altered.
//
// Ways in and out of a checklist:
//   - the checklist button in the editor bar inserts one at the caret (above, below or in
//     place of the current line),
//   - typing "- [ ] " at the start of a line turns that line into a checklist item,
//   - Enter on an empty item ends the list and goes back to text,
//   - Backspace on an empty first item removes it and returns to the text above.

import { h, fill, autoGrow } from './dom.js';
import { Checklist } from './checklist.js';
import { parseBlocks, serializeBlocks, splitForChecklist, TASK_RE } from '../core/blocks.js';
import { uid } from '../core/model.js';
import { t } from '../i18n.js';

const newItem = () => ({ id: uid(), text: '', done: false, indent: 0 });
const lineCount = (b) => (b.kind === 'text' ? b.text.split('\n').length : b.items.length);

export class NoteBody {
  constructor(editor) {
    this.ed = editor;
    this.el = h('div', { class: 'note-body' });
    this.blocks = [];
    this.views = new Map(); // block → { el, checklist? }
    this.merged = new Map(); // block merged away → { ref, offset }
  }

  get body() {
    return serializeBlocks(this.blocks);
  }

  load() {
    this.blocks = parseBlocks(this.ed.note.body);
    this.tidy();
    this.render();
  }

  /** Drop empty lists, join neighbouring blocks of the same kind, keep a writing space at the end. */
  tidy() {
    const out = [];
    for (const b of this.blocks) {
      if (b.kind === 'tasks' && !b.items.length) continue;
      const prev = out[out.length - 1];
      if (prev && prev.kind === b.kind) {
        if (b.kind === 'tasks') {
          prev.items.push(...b.items);
          this.merged.set(b, { ref: prev, offset: 0 });
          continue;
        }
        if (b.virtual && !b.text) continue;
        if (prev.virtual && !prev.text) {
          out[out.length - 1] = b;
          this.merged.set(prev, { ref: b, offset: 0 });
          continue;
        }
        this.merged.set(b, { ref: prev, offset: prev.text.length + 1 });
        prev.text = `${prev.text}\n${b.text}`;
        prev.virtual = false;
        continue;
      }
      out.push(b);
    }
    if (!out.length || out[out.length - 1].kind === 'tasks') out.push({ kind: 'text', text: '', virtual: true });
    this.blocks = out;
  }

  save() {
    const body = this.body;
    if (body !== (this.ed.note.body || '')) this.ed.set({ body });
    this.ed.renderChips();
  }

  // --- rendering -------------------------------------------------------------------------------

  render(focus) {
    this.views.clear();
    fill(this.el, this.blocks.map((b, i) => (b.kind === 'text' ? this.textView(b, i) : this.tasksView(b, i))));
    for (const ta of this.el.querySelectorAll('textarea')) autoGrow(ta);
    if (focus) this.applyFocus(focus);
  }

  textView(b, i) {
    const last = i === this.blocks.length - 1;
    const showHint = this.blocks.length === 1 || (last && b.virtual);
    const ta = h('textarea', {
      class: `ed-body${last ? ' last' : ''}`, rows: '1',
      placeholder: showHint ? t('bodyPlaceholder') : '',
      readOnly: this.ed.readOnly, 'aria-label': t('bodyPlaceholder'),
    });
    ta.value = b.text;
    ta.addEventListener('input', () => {
      autoGrow(ta);
      b.text = ta.value;
      if (b.text) b.virtual = false;
      // Typed Markdown: a line starting "- [ ] " becomes a checklist item.
      if (ta.value.split('\n').some((l) => TASK_RE.test(l))) {
        this.reparseAt(b, ta.selectionStart);
        return;
      }
      this.save();
    });
    // Remember the caret, in case tapping a toolbar button takes focus away from the text.
    ta.addEventListener('blur', () => {
      this.lastCaret = { block: b, pos: ta.selectionStart, at: Date.now() };
    });
    ta.addEventListener('keydown', (e) => {
      // Backspace at the very start of text just below a list: continue in the list's last item.
      const prev = this.blocks[this.blocks.indexOf(b) - 1];
      if (e.key === 'Backspace' && ta.selectionStart === 0 && ta.selectionEnd === 0 && prev?.kind === 'tasks') {
        e.preventDefault();
        this.applyFocus({ ref: prev, item: prev.items[prev.items.length - 1].id, pos: 'end' });
      }
    });
    this.views.set(b, { el: ta });
    return ta;
  }

  tasksView(b, i) {
    const cl = new Checklist(this.ed, {
      inline: true,
      getItems: () => b.items,
      save: (items) => {
        b.items = items;
        this.save();
      },
      restructure: (items) => {
        b.items = items;
        if (items.length) return false;
        // The list was emptied: it disappears and writing continues in the text around it.
        const idx = this.blocks.indexOf(b);
        const prev = this.blocks[idx - 1];
        const next = this.blocks[idx + 1];
        const focus = prev?.kind === 'text' ? { ref: prev, pos: prev.text.length } : next ? { ref: next, pos: 0 } : null;
        this.commitStructure(focus);
        return true;
      },
      onExit: (id) => this.exitList(b, id),
      onBackspaceStart: (id) => {
        const idx = this.blocks.indexOf(b);
        b.items = b.items.filter((x) => x.id !== id);
        const prev = this.blocks[idx - 1];
        const focus = prev?.kind === 'text' ? { ref: prev, pos: prev.text.length } : b.items.length ? { ref: b, item: b.items[0].id, pos: 0 } : null;
        this.commitStructure(focus);
      },
    });
    this.views.set(b, { el: cl.el, checklist: cl });
    cl.render();
    return cl.el;
  }

  commitStructure(focus) {
    this.merged.clear();
    this.tidy();
    this.save();
    this.render(focus);
  }

  resolve(ref) {
    let offset = 0;
    let r = ref;
    for (let n = 0; n < 10 && this.merged.has(r); n++) {
      const m = this.merged.get(r);
      offset += m.offset;
      r = m.ref;
    }
    return { ref: r, offset };
  }

  applyFocus(focus) {
    const { ref, offset } = this.resolve(focus.ref);
    const view = this.views.get(ref);
    if (!view) return;
    if (view.checklist) {
      view.checklist.focus(focus.item || ref.items[0]?.id, focus.pos);
      return;
    }
    const ta = view.el;
    ta.focus({ preventScroll: true });
    const p = focus.pos === 'end' ? ta.value.length : Math.min(ta.value.length, (focus.pos || 0) + offset);
    ta.setSelectionRange(p, p);
    ta.scrollIntoView({ block: 'nearest' });
  }

  // --- structure changes -----------------------------------------------------------------------

  /** Enter on an empty item: the list ends there and an empty line of text follows. */
  exitList(b, id) {
    const idx = this.blocks.indexOf(b);
    const at = b.items.findIndex((x) => x.id === id);
    const before = b.items.slice(0, at);
    const after = b.items.slice(at + 1);
    const next = this.blocks[idx + 1];
    let target;
    if (!after.length && next?.kind === 'text' && !next.text) {
      target = next;
      b.items = before;
    } else {
      target = { kind: 'text', text: '' };
      const parts = [{ kind: 'tasks', items: before }, target];
      if (after.length) parts.push({ kind: 'tasks', items: after });
      this.blocks.splice(idx, 1, ...parts);
    }
    // Keep the new empty line even though it has no text yet.
    target.virtual = false;
    this.commitStructure({ ref: target, pos: 0 });
  }

  /** The editor bar's checklist button. */
  insertChecklist() {
    const a = document.activeElement;
    const ed = this.ed;
    if (ed.focusedChecklist && this.el.contains(ed.focusedChecklist.el) && ed.focusedItem) {
      ed.focusedChecklist.addAfter(ed.focusedItem);
      return;
    }
    const tasks = { kind: 'tasks', items: [newItem()] };
    let textBlock = [...this.views].find(([, v]) => v.el === a)?.[0];
    let pos = textBlock ? a.selectionStart : 0;
    if (!textBlock && this.lastCaret && Date.now() - this.lastCaret.at < 1500 && this.blocks.includes(this.lastCaret.block)) {
      textBlock = this.lastCaret.block;
      pos = this.lastCaret.pos;
    }
    if (textBlock) {
      const { before, after } = splitForChecklist(textBlock.text, pos);
      const parts = [];
      if (before) parts.push({ kind: 'text', text: before });
      parts.push(tasks);
      if (after) parts.push({ kind: 'text', text: after });
      this.blocks.splice(this.blocks.indexOf(textBlock), 1, ...parts);
    } else {
      const last = this.blocks[this.blocks.length - 1];
      if (last?.kind === 'text' && !last.text) this.blocks.splice(this.blocks.length - 1, 0, tasks);
      else this.blocks.push(tasks);
    }
    this.commitStructure({ ref: tasks, item: tasks.items[0].id, pos: 0 });
  }

  /** Re-read the text after typed Markdown created checklist items; keep the caret's line. */
  reparseAt(block, pos) {
    let line = 0;
    for (const b of this.blocks) {
      if (b === block) break;
      line += lineCount(b);
    }
    const before = block.text.slice(0, pos);
    line += before.split('\n').length - 1;
    const col = pos - (before.lastIndexOf('\n') + 1);
    this.blocks = parseBlocks(this.body);
    this.merged.clear();
    this.tidy();
    this.save();
    // Find where that line is now.
    let start = 0;
    let focus = null;
    for (const b of this.blocks) {
      const n = lineCount(b);
      if (line < start + n) {
        const k = line - start;
        if (b.kind === 'tasks') focus = { ref: b, item: b.items[k].id, pos: 'end' };
        else focus = { ref: b, pos: b.text.split('\n').slice(0, k).reduce((s, l) => s + l.length + 1, 0) + col };
        break;
      }
      start += n;
    }
    this.render(focus);
  }

  // --- for the editor -----------------------------------------------------------------------------

  focusStart() {
    const first = this.blocks[0];
    if (first) this.applyFocus(first.kind === 'tasks' ? { ref: first, item: first.items[0].id, pos: 0 } : { ref: first, pos: 0 });
  }

  focusEnd() {
    const last = this.blocks[this.blocks.length - 1];
    if (last) this.applyFocus(last.kind === 'tasks' ? { ref: last, item: last.items[last.items.length - 1].id, pos: 'end' } : { ref: last, pos: 'end' });
  }

  hasFocus() {
    return this.el.contains(document.activeElement);
  }

  /** Add dictated text at the end of the note (a space or new line apart from what's there). */
  appendText(text) {
    const clean = String(text || '').trim();
    if (!clean) return;
    let last = this.blocks[this.blocks.length - 1];
    if (!last || last.kind !== 'text') {
      last = { kind: 'text', text: '' };
      this.blocks.push(last);
    }
    const sep = !last.text || /\s$/.test(last.text) ? '' : ' ';
    last.text += sep + clean;
    last.virtual = false;
    const view = this.views.get(last);
    if (view && !view.checklist) {
      view.el.value = last.text;
      autoGrow(view.el);
      view.el.scrollIntoView({ block: 'end' });
    } else this.render();
    this.save();
  }
}
