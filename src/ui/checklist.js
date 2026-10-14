// A checklist editor: the whole-note checklist (with ticked items moved to a collapsible
// "checked" section) and, in inline mode, a checklist inside a note's text (items stay in place).

import { h, fill, autoGrow, dirOf } from './dom.js';
import { icon } from './icons.js';
import { toast } from './overlays.js';
import { store } from '../state.js';
import { t } from '../i18n.js';
import { uid, setDone, setIndent, pasteLines, moveItem, splitChecked } from '../core/model.js';

export class Checklist {
  /**
   * opts (inline mode, for a checklist inside a note's text):
   *   inline: true
   *   getItems() / save(items)           read and save this checklist's items
   *   restructure(items, focus) → bool   items changed shape (emptied etc.); true if the note re-rendered
   *   onExit(id)                          Enter on an empty item: leave the list here
   *   onBackspaceStart()                  Backspace at the start of an empty first item
   */
  constructor(editor, opts = {}) {
    this.ed = editor;
    this.opts = opts;
    this.inline = Boolean(opts.inline);
    this.el = h('div', { class: `checklist${this.inline ? ' inline' : ''}` });
    this.el.addEventListener('focusin', (e) => {
      const row = e.target.closest('.cl-row[data-id]');
      const id = row?.dataset.id || null;
      if (id !== this.ed.focusedItem || this.ed.focusedChecklist !== this) {
        this.ed.focusedItem = id;
        this.ed.focusedChecklist = id ? this : null;
        this.ed.renderBar();
      }
    });
    this.el.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!this.el.contains(document.activeElement) && this.ed.focusedChecklist === this) {
          this.ed.focusedItem = null;
          this.ed.focusedChecklist = null;
          this.ed.renderBar();
        }
      }, 0);
    });
  }

  get items() {
    return this.opts.getItems ? this.opts.getItems() : this.ed.note?.items || [];
  }

  /** Save while typing (no re-render). */
  save(items) {
    if (this.opts.save) this.opts.save(items);
    else this.ed.set({ items });
  }

  commit(items, focus) {
    if (this.opts.restructure && this.opts.restructure(items, focus)) return;
    this.save(items);
    this.render(focus);
    this.ed.renderChips();
  }

  render(focus) {
    const ro = this.ed.readOnly;
    const focused = this.el.contains(document.activeElement) ? document.activeElement : null;
    const activeRow = focused?.closest('.cl-row')?.dataset.id;
    const caret = focused?.tagName === 'TEXTAREA' ? focused.selectionStart : null;
    const wasNew = focused?.classList.contains('cl-new');

    // Inside a note, items stay where they are; a whole-note checklist moves ticked items down.
    const { active, done } = this.inline ? { active: this.items, done: [] } : splitChecked(this.items);
    const parts = [h('div', { class: 'cl-group' }, active.map((i) => this.row(i)))];
    if (!ro && !this.inline) parts.push(this.addRow());
    if (done.length) {
      const collapsed = store.settings.checkedCollapsed;
      parts.push(h('button', {
        class: 'cl-done-toggle',
        'aria-expanded': String(!collapsed),
        onclick: () => {
          store.set('checkedCollapsed', !collapsed);
          this.render();
        },
      }, icon('chevronDown', { size: 20 }), h('span', { style: { flex: '1', textAlign: 'start' } }, t('checkedItems', { n: done.length }))));
      if (!collapsed) {
        parts.push(h('div', { class: 'cl-group done' }, done.map((i) => this.row(i))));
      }
    }
    fill(this.el, parts);
    for (const ta of this.el.querySelectorAll('textarea')) autoGrow(ta);

    if (focus) this.focus(focus.id, focus.pos);
    else if (activeRow) {
      const target = this.el.querySelector(`.cl-row[data-id="${CSS.escape(activeRow)}"] textarea`);
      if (target) {
        target.focus({ preventScroll: true });
        if (caret != null) target.setSelectionRange(caret, caret);
      }
    } else if (wasNew) this.el.querySelector('.cl-new')?.focus({ preventScroll: true });
  }

  row(item) {
    const ro = this.ed.readOnly;
    const ta = h('textarea', {
      class: 'cl-text', rows: '1', readOnly: ro, enterkeyhint: 'next',
      'aria-label': t('itemPlaceholder'), maxlength: '5000',
    });
    ta.value = item.text;
    ta.addEventListener('input', () => {
      if (ta.value.includes('\n')) {
        // Some keyboards insert the newline instead of sending Enter: split there.
        const pos = ta.value.indexOf('\n');
        const before = ta.value.slice(0, pos);
        const after = ta.value.slice(pos + 1).replace(/\n/g, ' ');
        this.splitAt(item.id, before, after);
        return;
      }
      autoGrow(ta);
      setRowDir(row, ta.value);
      this.save(this.items.map((i) => (i.id === item.id ? { ...i, text: ta.value } : i)));
    });
    ta.addEventListener('keydown', (e) => this.onKey(e, item.id, ta));
    ta.addEventListener('paste', (e) => this.onPaste(e, item.id, ta));

    const check = h('button', {
      class: 'cl-check', role: 'checkbox', 'aria-checked': String(item.done),
      'aria-label': item.done ? t('markNotDone') : t('markDone'), disabled: ro,
      onclick: () => this.commit(setDone(this.items, item.id, !item.done)),
    }, icon(item.done ? 'boxChecked' : 'boxEmpty', { size: 26 }));

    const handle = ro ? h('span', { class: 'cl-handle', 'aria-hidden': 'true' }) : h('span', { class: 'cl-handle', 'aria-hidden': 'true', title: t('dragItem') }, icon('grip', { size: 20 }));
    const row = h('div', { class: `cl-row${item.done ? ' done' : ''}`, dataset: { id: item.id }, style: { '--indent': item.indent ? 1 : 0 } },
      handle, check, ta,
      ro ? null : h('button', { class: 'icon-btn cl-del', 'aria-label': t('deleteItem'), tabindex: '-1', onpointerdown: (e) => e.preventDefault(), onclick: () => this.remove(item.id, true) }, icon('close', { size: 20 })));
    setRowDir(row, item.text);
    if (!ro) handle.addEventListener('pointerdown', (e) => this.startDrag(e, row, item));
    return row;
  }

  addRow() {
    const ta = h('textarea', { class: 'cl-text cl-new', rows: '1', placeholder: t('addItem'), 'aria-label': t('addItem'), enterkeyhint: 'next' });
    ta.addEventListener('input', () => {
      if (!ta.value.trim() && !ta.value.includes('\n')) return;
      const lines = ta.value.split('\n').filter((l, i) => i === 0 || l.trim());
      const fresh = lines.map((text) => ({ id: uid(), text, done: false, indent: 0 }));
      // Insert after the last unchecked item, before checked ones.
      const items = [...this.items];
      let at = items.length;
      while (at > 0 && items[at - 1].done) at--;
      items.splice(at, 0, ...fresh);
      this.commit(items, { id: fresh[fresh.length - 1].id, pos: 'end' });
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
    ta.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text/plain');
      if (!text || !text.includes('\n')) return;
      e.preventDefault();
      const fresh = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => ({ id: uid(), text: l.replace(/^\s*(?:[-*+•]|\d+[.)])\s+(\[[ xX]\]\s*)?/, '').trim(), done: false, indent: /^\s{2,}/.test(l) ? 1 : 0 }));
      const items = [...this.items];
      let at = items.length;
      while (at > 0 && items[at - 1].done) at--;
      items.splice(at, 0, ...fresh);
      this.commit(items, { id: fresh[fresh.length - 1].id, pos: 'end' });
    });
    return h('div', { class: 'cl-row cl-add' }, h('span', { class: 'cl-plus', 'aria-hidden': 'true' }, icon('plus', { size: 22 })), ta);
  }

  splitAt(id, before, after) {
    const items = [...this.items];
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const item = items[idx];
    if (!before && !after && item.indent) {
      items[idx] = { ...item, indent: 0 };
      this.commit(items, { id, pos: 0 });
      return;
    }
    // Inside a note, Enter on an empty item ends the list and goes back to writing text.
    if (!before && !after && this.inline && this.opts.onExit) {
      this.opts.onExit(id);
      return;
    }
    items[idx] = { ...item, text: before };
    const next = { id: uid(), text: after, done: false, indent: item.indent || 0 };
    items.splice(idx + 1, 0, next);
    this.commit(items, { id: next.id, pos: 0 });
  }

  onKey(e, id, ta) {
    if (e.isComposing) return;
    const items = [...this.items];
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const item = items[idx];

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.splitAt(id, ta.value.slice(0, ta.selectionStart), ta.value.slice(ta.selectionEnd));
      return;
    }
    if (e.key === 'Backspace' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      if (item.indent) {
        e.preventDefault();
        this.commit(setIndent(items, id, 0), { id, pos: 0 });
        return;
      }
      const visible = this.visibleIds();
      const prevId = visible[visible.indexOf(id) - 1];
      const prev = prevId ? items.find((i) => i.id === prevId) : null;
      if (!prev || (!this.inline && prev.done !== item.done)) {
        if (!ta.value) {
          e.preventDefault();
          if (this.inline && !prev && this.opts.onBackspaceStart) this.opts.onBackspaceStart(id);
          else this.remove(id, true);
        }
        return;
      }
      e.preventDefault();
      const pos = prev.text.length;
      items[items.indexOf(prev)] = { ...prev, text: prev.text + ta.value };
      items.splice(items.indexOf(item), 1);
      this.commit(items, { id: prev.id, pos });
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      this.indent(id, e.shiftKey ? 0 : 1);
    }
  }

  onPaste(e, id, ta) {
    const text = e.clipboardData?.getData('text/plain');
    if (!text || !/\n/.test(text.trim())) return;
    e.preventDefault();
    const { items, focusId } = pasteLines(this.items, id, ta.selectionStart, ta.selectionEnd, text);
    this.commit(items, { id: focusId, pos: 'end' });
  }

  indent(id, level) {
    const ta = this.el.querySelector(`.cl-row[data-id="${CSS.escape(id)}"] textarea`);
    this.commit(setIndent(this.items, id, level), { id, pos: ta ? ta.selectionStart : 'end' });
  }

  uncheckAll() {
    const before = this.items;
    this.commit(before.map((i) => ({ ...i, done: false })));
  }

  deleteChecked() {
    const before = this.items;
    this.commit(before.filter((i) => !i.done));
    toast(t('toastItemsDeleted'), { action: t('undo'), onAction: () => this.commit(before) });
  }

  visibleIds() {
    return [...this.el.querySelectorAll('.cl-row[data-id]')].map((r) => r.dataset.id);
  }

  remove(id, focusNeighbour = false) {
    const visible = this.visibleIds();
    const vi = visible.indexOf(id);
    const target = visible[vi - 1] || visible[vi + 1];
    this.commit(this.items.filter((i) => i.id !== id), focusNeighbour && target ? { id: target, pos: 'end' } : null);
  }

  focus(id, pos) {
    const ta = this.el.querySelector(`.cl-row[data-id="${CSS.escape(id)}"] textarea`);
    if (!ta) return;
    ta.focus();
    const p = pos === 'end' || pos == null ? ta.value.length : Math.min(pos, ta.value.length);
    ta.setSelectionRange(p, p);
    ta.scrollIntoView({ block: 'nearest' });
  }

  /** A new empty item right after `id` (or at the end), focused. */
  addAfter(id) {
    const items = [...this.items];
    const idx = items.findIndex((i) => i.id === id);
    const at = idx < 0 ? items.length : idx + 1;
    const fresh = { id: uid(), text: '', done: false, indent: idx < 0 ? 0 : items[idx].indent };
    items.splice(at, 0, fresh);
    this.commit(items, { id: fresh.id, pos: 0 });
  }

  focusFirst() {
    const first = this.el.querySelector('.cl-group .cl-row[data-id] textarea');
    if (first && !first.value) first.focus();
    else this.el.querySelector('.cl-new')?.focus();
  }

  startDrag(e, row, item) {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const group = row.parentElement;
    const rtl = document.documentElement.dir === 'rtl';
    const startX = e.clientX;
    let indent = item.indent || 0;
    handle.setPointerCapture(e.pointerId);
    row.classList.add('dragging');
    const move = (ev) => {
      let before = null;
      for (const r of group.children) {
        if (r === row) continue;
        const rect = r.getBoundingClientRect();
        if (ev.clientY < rect.top + rect.height / 2) {
          before = r;
          break;
        }
      }
      if (before) {
        if (row.nextSibling !== before) group.insertBefore(row, before);
      } else if (group.lastElementChild !== row) group.append(row);
      // Dragging toward the line's end indents, back toward its start outdents (mirrored in RTL).
      const dx = (ev.clientX - startX) * (rtl ? -1 : 1);
      indent = dx > 28 ? 1 : dx < -28 ? 0 : item.indent || 0;
      if (group.firstElementChild === row) indent = 0;
      row.style.setProperty('--indent', indent);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      row.classList.remove('dragging');
      const next = row.nextElementSibling?.dataset.id || null;
      let beforeId = next;
      if (!beforeId) {
        // Dropped at the end of its group: place before the first item of the next group, if any.
        const order = this.items;
        const groupIds = new Set([...group.children].map((r) => r.dataset.id));
        const lastInGroup = [...order].reverse().find((i) => groupIds.has(i.id) && i.id !== item.id);
        const after = lastInGroup ? order[order.indexOf(lastInGroup) + 1] : null;
        beforeId = after && after.id !== item.id ? after.id : null;
      }
      this.commit(moveItem(this.items, item.id, beforeId, indent));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }
}

// Each checklist line follows its own text: an English item has its box on the left,
// an Arabic one on the right, whatever the interface language.
function setRowDir(row, text) {
  const d = dirOf(text);
  if (d) row.dir = d;
  else row.removeAttribute('dir');
}

