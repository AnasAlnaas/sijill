// The note editor: a full-screen layer with the title, the text or checklist, images,
// and a bottom bar of actions within thumb reach. Every keystroke is saved.

import { h, fill, autoGrow, debounce, dirOf } from './dom.js';
import { icon, markerIcon } from './icons.js';
import { pushLayer } from './layers.js';
import { menuSheet, toast } from './overlays.js';
import { markerSheet, labelsSheet, reminderSheet, historySheet } from './notesheets.js';
import { reminderChip } from './cards.js';
import * as actions from './actions.js';
import { exportNotePdf, shareNoteText, copyNoteText } from './export.js';
import { store } from '../state.js';
import { t, markerName } from '../i18n.js';
import { stamp, fraction } from '../core/format.js';
import { uid, convertPatch, setDone, setIndent, pasteLines, moveItem, splitChecked, progress } from '../core/model.js';
import { saveFile, fileUrl, prepareImage } from '../services/files.js';
import { permission } from '../services/reminders.js';
import { markExternal } from '../native.js';

let current = null;

export function currentEditor() {
  return current;
}

/** Open a note. focus: 'title' | 'body' | 'firstItem' | null */
export function openEditor(id, { focus = null } = {}) {
  if (current) current.close({ silent: true });
  const note = store.get(id);
  if (!note) return null;
  current = new Editor(note, focus);
  return current;
}

export function closeEditor() {
  current?.close();
}

class Editor {
  constructor(note, focus) {
    this.id = note.id;
    this.readOnly = Boolean(note.trashedAt);
    this.focusedItem = null;
    store.beginSession(this.id);

    this.stampEl = h('span', { class: 'stamp', 'aria-live': 'off' });
    this.chipsEl = h('div', { class: 'ed-chips' });
    this.contentEl = h('div');
    this.imagesEl = h('div', { class: 'ed-images' });
    this.barEl = h('div', { class: 'editor-bar', role: 'toolbar', 'aria-label': t('more') });

    this.title = h('textarea', {
      class: 'ed-title', rows: '1', placeholder: t('titlePlaceholder'),
      readOnly: this.readOnly, 'aria-label': t('titlePlaceholder'), enterkeyhint: 'next', maxlength: '500',
    });
    this.title.value = note.title;
    this.title.addEventListener('input', () => {
      if (this.title.value.includes('\n')) this.title.value = this.title.value.replace(/\n/g, ' ');
      autoGrow(this.title);
      this.set({ title: this.title.value });
    });
    this.title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        this.focusContentStart();
      }
    });

    this.el = h('div', { class: 'layer editor', role: 'dialog', 'aria-modal': 'true', 'aria-label': note.title || t('newNote') },
      h('div', { class: 'layer-top' },
        h('button', { class: 'icon-btn', 'aria-label': t('back'), onclick: () => this.close() }, icon('back')),
        this.stampEl,
        h('span', { style: { inlineSize: 'var(--tap)' } })),
      h('div', { class: 'layer-scroll' },
        h('div', { class: 'editor-inner' },
          this.readOnly ? h('div', { class: 'ed-trash-note' }, icon('trash'), h('span', null, t('trashNote'))) : null,
          this.chipsEl,
          this.title,
          this.contentEl,
          this.imagesEl)),
      this.barEl);

    this.popLayer = pushLayer(() => this.close());
    this.onStoreChange = (e) => {
      const d = e.detail || {};
      if (d.labels || (d.notes && d.notes.includes(this.id) && !this.selfUpdate)) this.refreshFromStore();
      if (d.deleted && d.notes?.includes(this.id)) this.close({ silent: true });
    };
    store.addEventListener('change', this.onStoreChange);

    document.body.append(this.el);
    this.renderContent();
    this.renderChips();
    this.renderImages();
    this.renderBar();
    this.renderStamp();
    requestAnimationFrame(() => {
      autoGrow(this.title);
      if (focus === 'title') this.title.focus();
      else if (focus === 'body') this.body?.focus();
      else if (focus === 'firstItem') this.checklist?.focusFirst();
    });
  }

  get note() {
    return store.get(this.id);
  }

  set(patch) {
    if (this.readOnly) return;
    this.selfUpdate = true;
    store.updateNote(this.id, patch);
    this.selfUpdate = false;
    this.renderStampSoon();
  }

  renderStampSoon = debounce(() => this.renderStamp(), 400);

  renderStamp() {
    const n = this.note;
    if (!n) return;
    this.stampEl.textContent = t('edited', { when: stamp(n.updatedAt) });
  }

  refreshFromStore() {
    const n = this.note;
    if (!n) return;
    if (document.activeElement !== this.title && this.title.value !== n.title) {
      this.title.value = n.title;
      autoGrow(this.title);
    }
    const typeChanged = (n.type === 'list') !== Boolean(this.checklist);
    if (typeChanged) this.renderContent();
    else if (this.checklist) this.checklist.render();
    else if (this.body && document.activeElement !== this.body && this.body.value !== n.body) {
      this.body.value = n.body;
      autoGrow(this.body);
    }
    this.renderChips();
    this.renderImages();
    this.renderBar();
    this.renderStamp();
  }

  renderContent() {
    const n = this.note;
    this.body = null;
    this.checklist = null;
    if (n.type === 'list') {
      this.checklist = new Checklist(this);
      fill(this.contentEl, this.checklist.el);
      this.checklist.render();
    } else {
      this.body = h('textarea', {
        class: 'ed-body', placeholder: t('bodyPlaceholder'),
        readOnly: this.readOnly, 'aria-label': t('bodyPlaceholder'),
      });
      this.body.value = n.body;
      this.body.addEventListener('input', () => {
        autoGrow(this.body);
        this.set({ body: this.body.value });
      });
      fill(this.contentEl, this.body);
      requestAnimationFrame(() => autoGrow(this.body));
    }
  }

  focusContentStart() {
    if (this.body) {
      this.body.focus();
      this.body.setSelectionRange(0, 0);
    } else this.checklist?.focusFirst();
  }

  renderChips() {
    const n = this.note;
    const chips = [];
    const rc = reminderChip(n, { button: true, onClick: () => this.pickReminder() });
    if (rc) chips.push(rc);
    for (const id of n.labels) {
      const name = store.labelName(id);
      if (name) chips.push(h('button', { class: 'chip', dir: 'auto', onclick: () => this.pickLabels() }, icon('label', { size: 15 }), h('span', null, name)));
    }
    const p = progress(n);
    if (p) chips.push(h('span', { class: 'chip strong', 'aria-label': t('progress', { done: p.done, total: p.total }) }, icon('checklist', { size: 16 }), h('span', { class: 'progress' }, fraction(p.done, p.total))));
    fill(this.chipsEl, chips);
  }

  renderImages() {
    const imgs = (this.note.attachments || []).filter((a) => a.type?.startsWith('image/'));
    fill(this.imagesEl, imgs.map((a) => {
      const img = h('img', { alt: a.name, loading: 'lazy' });
      fileUrl(a).then((u) => { if (u) img.src = u; });
      return h('figure', null,
        h('button', { style: { display: 'block', inlineSize: '100%' }, 'aria-label': a.name, onclick: () => viewImage(a) }, img),
        this.readOnly ? null : h('button', {
          class: 'icon-btn', 'aria-label': `${t('remove')}: ${a.name}`,
          onclick: () => {
            const before = this.note.attachments;
            this.set({ attachments: before.filter((x) => x.id !== a.id) });
            this.renderImages();
            toast(t('remove'), { action: t('undo'), onAction: () => { this.set({ attachments: before }); this.renderImages(); } });
          },
        }, icon('close', { size: 20 })));
    }));
  }

  renderBar() {
    const n = this.note;
    if (!n) return;
    if (this.readOnly) {
      fill(this.barEl,
        h('button', { class: 'btn quiet', onclick: () => { actions.restoreNotes([this.id]); this.readOnly = false; this.close({ silent: true }); } }, icon('restore'), t('restore')),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn quiet', onclick: async () => { if (await actions.deleteForever([this.id])) this.close({ silent: true }); } }, icon('trash'), t('deleteForever')));
      return;
    }
    const itemTools = this.checklist && this.focusedItem
      ? [
        h('button', { class: 'icon-btn', 'aria-label': t('outdent'), onpointerdown: (e) => e.preventDefault(), onclick: () => this.checklist.indent(this.focusedItem, 0) }, icon('outdent')),
        h('button', { class: 'icon-btn', 'aria-label': t('indent'), onpointerdown: (e) => e.preventDefault(), onclick: () => this.checklist.indent(this.focusedItem, 1) }, icon('indent')),
        h('span', { class: 'spacer' }),
      ]
      : [];
    fill(this.barEl,
      ...itemTools,
      h('button', { class: 'icon-btn', 'aria-label': `${t('marker')}: ${markerName(n.marker)}`, onclick: () => this.pickMarker() }, n.marker ? markerIcon(n.marker, { size: 22 }) : icon('marker')),
      h('button', { class: 'icon-btn', 'aria-label': t('labels'), onclick: () => this.pickLabels() }, icon('label')),
      h('button', { class: 'icon-btn', 'aria-label': t('reminder'), 'aria-pressed': n.reminder ? 'true' : 'false', onclick: () => this.pickReminder() }, icon(n.reminder ? 'bellAlert' : 'bell')),
      h('button', {
        class: 'icon-btn', 'aria-label': n.pinned ? t('unpin') : t('pin'), 'aria-pressed': String(n.pinned),
        onclick: () => {
          store.updateNote(this.id, n.pinned ? { pinned: false } : { pinned: true, archived: false }, { touch: false });
          this.renderBar();
        },
      }, icon(n.pinned ? 'pinFilled' : 'pin')),
      itemTools.length ? null : h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', 'aria-label': t('more'), onclick: () => this.more() }, icon('more')));
  }

  pickMarker() {
    markerSheet(this.note.marker, (m) => {
      store.updateNote(this.id, { marker: m }, { touch: false });
    });
  }

  pickLabels() {
    labelsSheet(this.note.labels, (ids) => store.updateNote(this.id, { labels: ids }, { touch: false }));
  }

  pickReminder() {
    reminderSheet(this.note, async (r) => {
      store.updateNote(this.id, { reminder: r }, { touch: false });
      if (r) {
        const s = await permission.status().catch(() => null);
        if (s && s.notifications === 'prompt') await permission.request().catch(() => {});
      }
    });
  }

  more() {
    const n = this.note;
    menuSheet(null, [
      { icon: 'convert', label: n.type === 'list' ? t('toNote') : t('toChecklist'), onClick: () => { store.updateNote(this.id, convertPatch(this.note)); } },
      { icon: 'image', label: t('addImage'), onClick: () => this.addImage() },
      { icon: 'restore', label: t('uncheckAll'), hidden: !(n.type === 'list' && n.items.some((i) => i.done)), onClick: () => this.checklist?.uncheckAll() },
      { icon: 'trash', label: t('deleteChecked'), hidden: !(n.type === 'list' && n.items.some((i) => i.done)), onClick: () => this.checklist?.deleteChecked() },
      { icon: 'history', label: t('history'), onClick: () => historySheet(this.id, () => this.refreshAll()) },
      'sep',
      { icon: 'copy', label: t('copyText'), onClick: () => copyNoteText(this.note) },
      { icon: 'share', label: t('shareText'), onClick: () => shareNoteText(this.note) },
      { icon: 'pdf', label: t('exportPdf'), onClick: () => exportNotePdf(this.note) },
      'sep',
      n.archived
        ? { icon: 'unarchive', label: t('unarchive'), onClick: () => { actions.unarchiveNotes([this.id]); } }
        : { icon: 'archive', label: t('doArchive'), onClick: () => { actions.archiveNotes([this.id]); this.close({ silent: true }); } },
      { icon: 'trash', label: t('moveToTrash'), onClick: () => { this.close({ silent: true, keep: true }); actions.trashNotes([this.id]); } },
    ]);
  }

  refreshAll() {
    const n = this.note;
    this.title.value = n.title;
    autoGrow(this.title);
    this.renderContent();
    this.refreshFromStore();
  }

  addImage() {
    const input = h('input', { type: 'file', accept: 'image/*', multiple: true });
    input.addEventListener('change', async () => {
      const added = [];
      for (const f of input.files) {
        const prepared = await prepareImage(f);
        added.push(await saveFile(prepared, prepared.name || f.name, prepared.type));
      }
      if (added.length) {
        this.set({ attachments: [...this.note.attachments, ...added] });
        this.renderImages();
      }
    });
    markExternal();
    input.click();
  }

  close({ silent = false, keep = false } = {}) {
    if (this.closed) return;
    this.closed = true;
    this.renderStampSoon.cancel();
    store.removeEventListener('change', this.onStoreChange);
    this.popLayer();
    const { discarded } = keep ? { discarded: false } : store.endSession(this.id);
    if (keep) store.sessions.delete(this.id);
    store.flush();
    this.el.classList.add('closing');
    setTimeout(() => this.el.remove(), 140);
    if (current === this) current = null;
    if (discarded && !silent) toast(t('toastEmptyDiscarded'));
    document.dispatchEvent(new CustomEvent('editor-closed', { detail: { id: this.id } }));
  }
}

// --- checklist ------------------------------------------------------------------------------------

class Checklist {
  constructor(editor) {
    this.ed = editor;
    this.el = h('div', { class: 'checklist' });
    this.el.addEventListener('focusin', (e) => {
      const row = e.target.closest('.cl-row[data-id]');
      const id = row?.dataset.id || null;
      if (id !== this.ed.focusedItem) {
        this.ed.focusedItem = id;
        this.ed.renderBar();
      }
    });
    this.el.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!this.el.contains(document.activeElement) && this.ed.focusedItem) {
          this.ed.focusedItem = null;
          this.ed.renderBar();
        }
      }, 0);
    });
  }

  get items() {
    return this.ed.note?.items || [];
  }

  commit(items, focus) {
    this.ed.set({ items });
    this.render(focus);
    this.ed.renderChips();
  }

  render(focus) {
    const ro = this.ed.readOnly;
    const focused = this.el.contains(document.activeElement) ? document.activeElement : null;
    const activeRow = focused?.closest('.cl-row')?.dataset.id;
    const caret = focused?.tagName === 'TEXTAREA' ? focused.selectionStart : null;
    const wasNew = focused?.classList.contains('cl-new');

    const { active, done } = splitChecked(this.items);
    const parts = [h('div', { class: 'cl-group' }, active.map((i) => this.row(i)))];
    if (!ro) parts.push(this.addRow());
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
      this.ed.set({ items: this.items.map((i) => (i.id === item.id ? { ...i, text: ta.value } : i)) });
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
      if (!prev || prev.done !== item.done) {
        if (!ta.value) {
          e.preventDefault();
          this.remove(id, true);
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

// --- image viewer ---------------------------------------------------------------------------------

function viewImage(att) {
  const img = h('img', { alt: att.name, style: { maxInlineSize: '100%', maxBlockSize: '100%', objectFit: 'contain', margin: 'auto' } });
  fileUrl(att).then((u) => { if (u) img.src = u; });
  let pop;
  const close = () => {
    pop();
    layer.remove();
  };
  const layer = h('div', { class: 'layer', style: { background: '#000', zIndex: '35' }, role: 'dialog', 'aria-label': att.name },
    h('div', { class: 'layer-top' }, h('button', { class: 'icon-btn', style: { color: '#eee' }, 'aria-label': t('close'), onclick: close }, icon('close'))),
    h('div', { style: { flex: '1', display: 'grid', placeItems: 'center', padding: '1rem', minBlockSize: '0' } }, img));
  pop = pushLayer(close);
  document.body.append(layer);
}
