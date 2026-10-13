// The main screen: a list of notes for the current place (Notes, Reminders, a label,
// Archive, Trash) with the actions at the bottom, within thumb reach.

import { h, fill, debounce } from './dom.js';
import { icon } from './icons.js';
import { pushLayer } from './layers.js';
import { menuSheet, promptDialog, confirmDialog } from './overlays.js';
import { renderCard, onLongPress } from './cards.js';
import { openEditor, currentEditor } from './editor.js';
import { markerSheet, labelsSheet } from './notesheets.js';
import { openSettings } from './settings.js';
import * as actions from './actions.js';
import { store } from '../state.js';
import { t } from '../i18n.js';
import { searchNotes } from '../core/search.js';
import { queryTerms } from '../core/normalize.js';
import { displayTime, isOverdue, repeatOf } from '../core/recurrence.js';
import { uid } from '../core/model.js';

const state = {
  view: { kind: 'notes' },
  query: '',
  searching: false,
  selection: new Set(),
};

let root;
let mainEl;
let barEl;
let searchInput;
let popSearch = null;
let popSelection = null;
let dirty = false;

export function mountApp(container) {
  root = container;
  mainEl = h('main', { class: 'main', id: 'main' });
  barEl = h('nav', { class: 'bottombar', 'aria-label': t('menu') });
  fill(root, mainEl, barEl);

  mainEl.addEventListener('click', (e) => {
    const card = e.target.closest('.card[data-id]');
    if (!card) return;
    const id = card.dataset.id;
    if (state.selection.size) toggleSelect(id);
    else openEditor(id);
  });
  onLongPress(mainEl, '.card[data-id]', (card) => toggleSelect(card.dataset.id));

  store.addEventListener('change', (e) => {
    const d = e.detail || {};
    if (d.settings && !d.notes && !d.labels) return;
    if (d.deleted) for (const id of d.notes || []) state.selection.delete(id);
    scheduleRender();
  });
  document.addEventListener('editor-closed', () => {
    if (dirty) render();
  });
  render();
}

const scheduleRender = debounce(() => {
  // While a note is open the list is hidden: render it when the editor closes.
  if (currentEditor()) {
    dirty = true;
    return;
  }
  render();
}, 60);

export function rerender() {
  normalBar = null;
  render();
}

export function goTo(view) {
  state.view = view;
  clearSelection();
  if (state.searching) endSearch();
  render();
  window.scrollTo(0, 0);
}

export function currentView() {
  return state.view;
}

// --- lists ----------------------------------------------------------------------------------------

function byEdited(a, b) {
  return b.updatedAt - a.updatedAt;
}

function viewNotes() {
  const all = store.allNotes();
  const v = state.view;
  switch (v.kind) {
    case 'archive': return { groups: [[null, all.filter((n) => n.archived && !n.trashedAt).sort(byEdited)]] };
    case 'trash': return { groups: [[null, all.filter((n) => n.trashedAt).sort((a, b) => b.trashedAt - a.trashedAt)]] };
    case 'reminders': {
      const withR = all.filter((n) => n.reminder && !n.trashedAt);
      const isPast = (n) => isOverdue(n.reminder) || (repeatOf(n.reminder) === 'none' && n.reminder.doneAt);
      const upcoming = withR.filter((n) => !isPast(n)).sort((a, b) => displayTime(a.reminder) - displayTime(b.reminder));
      const past = withR.filter(isPast).sort((a, b) => displayTime(b.reminder) - displayTime(a.reminder));
      return { groups: [[past.length ? t('upcoming') : null, upcoming], [t('past'), past]] };
    }
    case 'label': {
      const list = all.filter((n) => !n.trashedAt && !n.archived && n.labels.includes(v.id));
      return pinnedGroups(list);
    }
    default: return pinnedGroups(all.filter((n) => !n.trashedAt && !n.archived));
  }
}

function pinnedGroups(list) {
  const pinned = list.filter((n) => n.pinned).sort(byEdited);
  const rest = list.filter((n) => !n.pinned).sort(byEdited);
  return { groups: pinned.length ? [[t('pinned'), pinned], [t('others'), rest]] : [[null, rest]] };
}

function viewTitle() {
  const v = state.view;
  if (v.kind === 'label') return store.labelName(v.id) || t('labels');
  if (v.kind === 'notes') return t('appName');
  return t(v.kind);
}

function emptyText() {
  return { notes: t('emptyNotes'), reminders: t('emptyReminders'), archive: t('emptyArchive'), trash: t('emptyTrash'), label: t('emptyLabel') }[state.view.kind];
}

function emptyIcon() {
  return { notes: 'note', reminders: 'bell', archive: 'archive', trash: 'trash', label: 'label' }[state.view.kind];
}

function render() {
  dirty = false;
  const terms = state.searching ? queryTerms(state.query) : [];
  const parts = [];

  if (state.searching && terms.length) {
    const results = searchNotes(store.allNotes().filter((n) => !n.trashedAt), state.query, store.labelName);
    parts.push(h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, t('search'))));
    if (!results.length) parts.push(h('p', { class: 'empty' }, icon('search', { size: 32 }), h('br'), t('noResults', { q: state.query })));
    else parts.push(h('div', { class: 'cards' }, results.map((n) => renderCard(n, { terms, selected: state.selection.has(n.id), showArchived: true }))));
  } else {
    const isHome = state.view.kind === 'notes';
    parts.push(h('div', { class: 'page-head' },
      h('h1', { class: `page-title${isHome ? ' wordmark' : ''}`, dir: 'auto' }, viewTitle()),
      state.view.kind === 'label' ? h('button', { class: 'icon-btn', 'aria-label': t('rename'), onclick: renameCurrentLabel }, icon('edit')) : null,
      state.view.kind === 'trash' && store.allNotes().some((n) => n.trashedAt)
        ? h('button', { class: 'btn quiet', onclick: () => actions.emptyTrash() }, t('emptyTrashNow')) : null));
    if (state.view.kind === 'trash') parts.push(h('p', { class: 'page-note' }, t('trashNote')));
    const { groups } = viewNotes();
    const total = groups.reduce((s, [, list]) => s + list.length, 0);
    if (!total) {
      parts.push(h('div', { class: 'empty' }, icon(emptyIcon(), { size: 36 }), h('p', null, emptyText())));
    } else {
      for (const [title, list] of groups) {
        if (!list.length) continue;
        if (title) parts.push(h('h2', { class: 'section-h' }, title === t('pinned') ? icon('pinFilled', { size: 16 }) : null, title));
        parts.push(h('div', { class: 'cards' }, list.map((n) => renderCard(n, { selected: state.selection.has(n.id) }))));
      }
    }
  }
  fill(mainEl, parts);
  renderBar();
}

// --- bottom bar -----------------------------------------------------------------------------------

let normalBar = null;

function renderBar() {
  if (state.selection.size) {
    normalBar = null;
    return renderSelectionBar();
  }
  if (!normalBar || normalBar.lang !== t('search')) buildNormalBar();
  // Show and hide rather than rebuild, so typing a search never drops the keyboard.
  const s = state.searching;
  const trash = state.view.kind === 'trash';
  normalBar.menu.hidden = s;
  normalBar.close.hidden = !s;
  normalBar.list.hidden = s || trash;
  normalBar.add.hidden = s || trash;
}

function buildNormalBar() {
  if (!searchInput) {
    searchInput = h('input', {
      type: 'search', dir: 'auto', enterkeyhint: 'search', autocomplete: 'off', spellcheck: false,
    });
    const onInput = debounce(() => {
      state.query = searchInput.value;
      render();
    }, 90);
    searchInput.addEventListener('focus', startSearch);
    searchInput.addEventListener('input', onInput);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchInput.blur();
    });
  }
  searchInput.placeholder = t('searchPlaceholder');
  searchInput.setAttribute('aria-label', t('search'));
  const close = h('button', { class: 'icon-btn', 'aria-label': t('closeSearch'), onclick: (e) => { e.preventDefault(); endSearch(); } }, icon('close', { size: 20 }));
  const menu = h('button', { class: 'icon-btn', 'aria-label': t('menu'), onclick: openMenu }, icon('menu'));
  const list = h('button', { class: 'icon-btn', 'aria-label': t('newChecklist'), onclick: () => createNote('list') }, icon('checklist'));
  const add = h('button', { class: 'new-btn', 'aria-label': t('newNote'), onclick: () => createNote('note') }, icon('plus', { size: 28 }));
  fill(barEl, menu, h('label', { class: 'search-pill' }, icon('search', { size: 22 }), searchInput, close), list, add);
  normalBar = { lang: t('search'), menu, close, list, add };
}

function startSearch() {
  if (state.searching) return;
  state.searching = true;
  popSearch = pushLayer(endSearch);
  renderBar();
}

function endSearch() {
  if (!state.searching) return;
  state.searching = false;
  state.query = '';
  if (searchInput) {
    searchInput.value = '';
    searchInput.blur();
  }
  popSearch?.();
  popSearch = null;
  render();
}

export function createNote(type, fields = {}) {
  if (state.searching) endSearch();
  const v = state.view;
  const base = { type, ...fields };
  if (v.kind === 'label') base.labels = [v.id];
  if (type === 'list' && !base.items) base.items = [{ id: uid(), text: '', done: false, indent: 0 }];
  if (v.kind === 'archive' || v.kind === 'trash') goTo({ kind: 'notes' });
  const n = store.createNote(base);
  openEditor(n.id, { focus: type === 'list' ? 'firstItem' : 'body' });
  return n;
}

// --- menu -----------------------------------------------------------------------------------------

function openMenu() {
  const v = state.view;
  const labels = store.allLabels();
  menuSheet(null, [
    { icon: 'note', label: t('notes'), current: v.kind === 'notes', onClick: () => goTo({ kind: 'notes' }) },
    { icon: 'bell', label: t('reminders'), current: v.kind === 'reminders', onClick: () => goTo({ kind: 'reminders' }) },
    ...(labels.length ? ['sep'] : []),
    ...labels.map((l) => ({ icon: 'label', label: l.name, current: v.kind === 'label' && v.id === l.id, onClick: () => goTo({ kind: 'label', id: l.id }) })),
    { icon: 'edit', label: t('editLabels'), onClick: editLabels },
    'sep',
    { icon: 'archive', label: t('archive'), current: v.kind === 'archive', onClick: () => goTo({ kind: 'archive' }) },
    { icon: 'trash', label: t('trash'), current: v.kind === 'trash', onClick: () => goTo({ kind: 'trash' }) },
    'sep',
    { icon: 'settings', label: t('settings'), onClick: () => openSettings() },
  ]);
}

function editLabels() {
  const labels = store.allLabels();
  menuSheet(t('editLabels'), [
    { icon: 'plus', label: t('newLabel'), onClick: async () => { const name = await promptDialog({ title: t('newLabel'), confirm: t('create') }); if (name) store.createLabel(name); } },
    ...labels.map((l) => ({ icon: 'label', label: l.name, onClick: () => labelActions(l) })),
  ]);
}

function labelActions(l) {
  menuSheet(l.name, [
    { icon: 'edit', label: t('rename'), onClick: async () => { const name = await promptDialog({ title: t('rename'), value: l.name }); if (name) store.renameLabel(l.id, name); } },
    {
      icon: 'trash',
      label: t('delete'),
      onClick: async () => {
        const ok = await confirmDialog({ title: t('deleteLabelQ', { name: l.name }), message: t('deleteLabelBody'), confirm: t('delete'), danger: true });
        if (ok) {
          store.deleteLabel(l.id);
          if (state.view.kind === 'label' && state.view.id === l.id) goTo({ kind: 'notes' });
        }
      },
    },
  ]);
}

async function renameCurrentLabel() {
  const l = store.label(state.view.id);
  if (!l) return;
  const name = await promptDialog({ title: t('rename'), value: l.name });
  if (name) store.renameLabel(l.id, name);
}

// --- selection --------------------------------------------------------------------------------------

function toggleSelect(id) {
  if (state.selection.has(id)) state.selection.delete(id);
  else state.selection.add(id);
  if (state.selection.size && !popSelection) popSelection = pushLayer(clearSelection);
  if (!state.selection.size) clearSelection();
  else render();
}

function clearSelection() {
  state.selection.clear();
  popSelection?.();
  popSelection = null;
  if (mainEl) render();
}

function renderSelectionBar() {
  const ids = [...state.selection];
  const notes = ids.map((id) => store.get(id)).filter(Boolean);
  const inTrash = notes.every((n) => n.trashedAt);
  const allPinned = notes.every((n) => n.pinned);
  const allArchived = notes.every((n) => n.archived);
  const done = (fn) => () => {
    fn(ids);
    clearSelection();
  };
  fill(barEl,
    h('button', { class: 'icon-btn', 'aria-label': t('clearSelection'), onclick: clearSelection }, icon('close')),
    h('span', { class: 'count', 'aria-live': 'polite' }, t('selected', { n: ids.length })),
    inTrash
      ? [
        h('button', { class: 'icon-btn', 'aria-label': t('restore'), onclick: done(actions.restoreNotes) }, icon('restore')),
        h('button', { class: 'icon-btn', 'aria-label': t('deleteForever'), onclick: async () => { if (await actions.deleteForever(ids)) clearSelection(); } }, icon('trash')),
      ]
      : [
        h('button', { class: 'icon-btn', 'aria-label': allPinned ? t('unpin') : t('pin'), onclick: done((x) => actions.setPinned(x, !allPinned)) }, icon(allPinned ? 'pinFilled' : 'pin')),
        h('button', { class: 'icon-btn', 'aria-label': allArchived ? t('unarchive') : t('doArchive'), onclick: done(allArchived ? actions.unarchiveNotes : actions.archiveNotes) }, icon(allArchived ? 'unarchive' : 'archive')),
        h('button', { class: 'icon-btn', 'aria-label': t('moveToTrash'), onclick: done(actions.trashNotes) }, icon('trash')),
        h('button', {
          class: 'icon-btn', 'aria-label': t('more'),
          onclick: () => menuSheet(null, [
            { icon: 'marker', label: t('marker'), onClick: () => markerSheet(notes.length === 1 ? notes[0].marker : null, (m) => { actions.setMarker(ids, m); clearSelection(); }) },
            {
              icon: 'label',
              label: t('labels'),
              onClick: () => {
                const common = store.allLabels().filter((l) => notes.every((n) => n.labels.includes(l.id))).map((l) => l.id);
                let prev = new Set(common);
                labelsSheet(common, (next) => {
                  const nextSet = new Set(next);
                  const added = next.filter((x) => !prev.has(x));
                  const removed = [...prev].filter((x) => !nextSet.has(x));
                  store.updateNotes(ids, (n) => ({ labels: [...new Set([...n.labels.filter((x) => !removed.includes(x)), ...added])] }), { touch: false });
                  prev = nextSet;
                });
              },
            },
          ]),
        }, icon('more')),
      ]);
}
