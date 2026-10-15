// The note editor: a full-screen layer with the title, the text or checklist, images,
// and a bottom bar of actions within thumb reach. Every keystroke is saved.

import { h, fill, autoGrow, debounce, keepCaretVisible } from './dom.js';
import { Checklist } from './checklist.js';
import { NoteBody } from './notebody.js';
import { DictationPanel } from './dictation.js';
import { icon, markerIcon } from './icons.js';
import { pushLayer } from './layers.js';
import { menuSheet, toast } from './overlays.js';
import { markerSheet, labelsSheet, reminderSheet, historySheet } from './notesheets.js';
import { reminderChip, expiryChip } from './cards.js';
import * as actions from './actions.js';
import { exportNotePdf, shareNoteText, copyNoteText } from './export.js';
import { store } from '../state.js';
import { t, markerName } from '../i18n.js';
import { stamp, fraction } from '../core/format.js';
import { convertPatch, progress } from '../core/model.js';
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
      requestAnimationFrame(() => keepCaretVisible(this.title));
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
      else if (focus === 'body') this.noteBody?.focusEnd();
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
    else if (this.noteBody && !this.noteBody.hasFocus() && this.noteBody.body !== (n.body || '')) {
      this.noteBody.load();
    }
    this.renderChips();
    this.renderImages();
    this.renderBar();
    this.renderStamp();
  }

  renderContent() {
    const n = this.note;
    this.noteBody = null;
    this.checklist = null;
    this.focusedItem = null;
    this.focusedChecklist = null;
    if (n.type === 'list') {
      this.checklist = new Checklist(this);
      fill(this.contentEl, this.checklist.el);
      this.checklist.render();
    } else {
      // Text with checklists anywhere inside it.
      this.noteBody = new NoteBody(this);
      fill(this.contentEl, this.noteBody.el);
      this.noteBody.load();
    }
  }

  /** Dictate into this note (text notes only). */
  startDictation() {
    if (!this.noteBody || this.readOnly) return;
    if (!this.dictation) this.dictation = new DictationPanel(this);
    this.dictation.start();
  }

  focusContentStart() {
    if (this.noteBody) this.noteBody.focusStart();
    else this.checklist?.focusFirst();
  }

  renderChips() {
    const n = this.note;
    const chips = [];
    const rc = reminderChip(n, { button: true, onClick: () => this.pickReminder() });
    if (rc) chips.push(rc);
    if (n.expiresAt && !n.trashedAt) chips.push(expiryChip(n, { button: true, onClick: () => this.more() }));
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
        h('button', { class: 'btn quiet wide-half', onclick: () => { actions.restoreNotes([this.id]); this.readOnly = false; this.close({ silent: true }); } }, icon('restore'), t('restore')),
        h('button', { class: 'btn quiet wide-half', onclick: async () => { if (await actions.deleteForever([this.id])) this.close({ silent: true }); } }, icon('trash'), t('deleteForever')));
      return;
    }
    const cl = this.focusedChecklist;
    const keep = (e) => e.preventDefault(); // tapping these must not take focus from the text
    // The first two places change with what you are doing; the other four never move.
    const lead = cl && this.focusedItem
      ? [
        h('button', { class: 'icon-btn', 'aria-label': t('outdent'), onpointerdown: keep, onclick: () => cl.indent(this.focusedItem, 0) }, icon('outdent')),
        h('button', { class: 'icon-btn', 'aria-label': t('indent'), onpointerdown: keep, onclick: () => cl.indent(this.focusedItem, 1) }, icon('indent')),
      ]
      : [
        n.type === 'list' ? null : h('button', { class: 'icon-btn', 'aria-label': t('addChecklist'), onpointerdown: keep, onclick: () => this.noteBody?.insertChecklist() }, icon('checklistAdd')),
        h('button', { class: 'icon-btn', 'aria-label': `${t('marker')}: ${markerName(n.marker)}`, onclick: () => this.pickMarker() }, n.marker ? markerIcon(n.marker, { size: 22 }) : icon('marker')),
      ];
    // Spread evenly along the bottom edge so either thumb reaches every button.
    fill(this.barEl,
      ...lead,
      h('button', { class: 'icon-btn', 'aria-label': t('labels'), onclick: () => this.pickLabels() }, icon('label')),
      h('button', { class: 'icon-btn', 'aria-label': t('reminder'), 'aria-pressed': n.reminder ? 'true' : 'false', onclick: () => this.pickReminder() }, icon(n.reminder ? 'bellAlert' : 'bell')),
      h('button', {
        class: 'icon-btn', 'aria-label': n.pinned ? t('unpin') : t('pin'), 'aria-pressed': String(n.pinned),
        onclick: () => {
          store.updateNote(this.id, n.pinned ? { pinned: false } : { pinned: true, archived: false }, { touch: false });
          this.renderBar();
        },
      }, icon(n.pinned ? 'pinFilled' : 'pin')),
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
      { icon: 'mic', label: t('dictate'), hidden: n.type === 'list', onClick: () => this.startDictation() },
      { icon: 'image', label: t('addImage'), onClick: () => this.addImage() },
      { icon: 'restore', label: t('uncheckAll'), hidden: !(n.type === 'list' && n.items.some((i) => i.done)), onClick: () => this.checklist?.uncheckAll() },
      { icon: 'trash', label: t('deleteChecked'), hidden: !(n.type === 'list' && n.items.some((i) => i.done)), onClick: () => this.checklist?.deleteChecked() },
      { icon: 'history', label: t('history'), onClick: () => historySheet(this.id, () => this.refreshAll()) },
      n.expiresAt
        ? { icon: 'hourglass', label: t('keepForever'), onClick: () => actions.setExpiry([this.id], false) }
        : { icon: 'hourglass', label: t('expireMonth'), onClick: () => actions.setExpiry([this.id], true) },
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
    this.dictation?.close();
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
