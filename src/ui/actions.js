// Note actions shared by cards, the selection bar and the editor.
// Anything that moves or removes notes offers Undo.

import { store } from '../state.js';
import { t } from '../i18n.js';
import { toast, confirmDialog } from './overlays.js';

function snapshot(ids, fields) {
  return ids.map((id) => store.get(id)).filter(Boolean)
    .map((n) => ({ id: n.id, patch: Object.fromEntries(fields.map((f) => [f, n[f]])) }));
}

function undoFor(snaps) {
  return () => {
    for (const s of snaps) store.updateNote(s.id, s.patch, { touch: false, silent: true });
    store.emit({ notes: snaps.map((s) => s.id) });
  };
}

function act(ids, fields, patchFn, key) {
  if (!ids.length) return;
  const snaps = snapshot(ids, fields);
  store.updateNotes(ids, patchFn, { touch: false });
  toast(t(key, { n: ids.length }), { action: t('undo'), onAction: undoFor(snaps) });
}

export const archiveNotes = (ids) => act(ids, ['archived', 'pinned'], () => ({ archived: true, pinned: false }), 'toastArchived');
export const unarchiveNotes = (ids) => act(ids, ['archived'], () => ({ archived: false }), 'toastUnarchived');
export const trashNotes = (ids) => act(ids, ['trashedAt', 'pinned'], () => ({ trashedAt: Date.now(), pinned: false }), 'toastTrashed');
export const restoreNotes = (ids) => act(ids, ['trashedAt'], () => ({ trashedAt: null }), 'toastRestored');

export function setPinned(ids, pinned) {
  act(ids, ['pinned', 'archived'], () => (pinned ? { pinned: true, archived: false } : { pinned: false }), pinned ? 'toastPinned' : 'toastUnpinned');
}

export async function deleteForever(ids) {
  if (!ids.length) return false;
  const ok = await confirmDialog({
    title: t('confirmDeleteTitle', { n: ids.length }),
    message: t('confirmDeleteBody'),
    confirm: t('deleteForever'),
    danger: true,
  });
  if (ok) store.deleteForever(ids);
  return ok;
}

export async function emptyTrash() {
  const ids = store.allNotes().filter((n) => n.trashedAt).map((n) => n.id);
  if (!ids.length) return;
  const ok = await confirmDialog({
    title: t('confirmEmptyTrash'),
    message: t('confirmDeleteBody'),
    confirm: t('emptyTrashNow'),
    danger: true,
  });
  if (ok) store.deleteForever(ids);
}

export function setMarker(ids, marker) {
  const snaps = snapshot(ids, ['marker']);
  store.updateNotes(ids, () => ({ marker }), { touch: false });
  return undoFor(snaps);
}
