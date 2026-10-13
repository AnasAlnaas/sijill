// App lock: fingerprint, face or the phone's PIN (Android's own prompt).
// Locks on start and after the app has been in the background for the chosen time.
// Trips out to the system's own screens (file picker, share, print) don't count.

import { h } from './dom.js';
import { t } from '../i18n.js';
import { authenticate, externalActivityAt } from '../native.js';

let overlay = null;
let pausedAt = 0;

export function isLocked() {
  return Boolean(overlay);
}

export function lockNow() {
  if (overlay) return;
  const btn = h('button', { class: 'btn primary', onclick: () => unlock() }, t('unlock'));
  overlay = h('div', { class: 'lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('locked') },
    h('p', { class: 'wordmark', 'aria-hidden': 'true' }, 'سِجِلّ'),
    h('p', null, t('locked')),
    btn);
  document.body.append(overlay);
  document.activeElement?.blur?.();
  btn.focus();
}

export async function unlock() {
  if (!overlay) return true;
  const r = await authenticate(t('unlockReason'), '');
  if (r.ok) {
    overlay.remove();
    overlay = null;
    return true;
  }
  return false;
}

export function onPause(settings) {
  pausedAt = Date.now();
  if (settings.lock && settings.lockAfter === 0 && !recentlyExternal()) lockNow();
}

export function onResume(settings) {
  if (!settings.lock) return;
  if (recentlyExternal()) return;
  if (overlay || Date.now() - pausedAt >= (settings.lockAfter || 0) * 1000) {
    lockNow();
    unlock();
  }
}

function recentlyExternal() {
  return Date.now() - externalActivityAt() < 120000 && externalActivityAt() > pausedAt - 3000;
}
