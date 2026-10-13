// Bottom sheets, confirm dialogs, toasts with Undo, and a busy indicator.

import { h, fill } from './dom.js';
import { icon } from './icons.js';
import { pushLayer } from './layers.js';
import { t } from '../i18n.js';

// --- sheets -------------------------------------------------------------------------------------

/**
 * Open a bottom sheet. build(sheetEl, close) fills it.
 * Returns { el, close }. onClose runs once, however it was closed.
 */
export function openSheet(build, { label, onClose } = {}) {
  const scrim = h('div', { class: 'scrim' });
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label || '' });
  let closed = false;
  const prevFocus = document.activeElement;
  const close = () => {
    if (closed) return;
    closed = true;
    pop();
    sheet.classList.add('closing');
    scrim.style.opacity = '0';
    setTimeout(() => {
      sheet.remove();
      scrim.remove();
    }, 140);
    onClose?.();
    if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
  };
  const pop = pushLayer(close);
  scrim.addEventListener('click', close);
  sheet.append(h('div', { class: 'sheet-grab', 'aria-hidden': 'true' }));
  build(sheet, close);
  document.body.append(scrim, sheet);
  requestAnimationFrame(() => {
    const first = sheet.querySelector('[autofocus]') || sheet.querySelector('button, input, textarea');
    if (first && !first.hasAttribute('autofocus')) sheet.focus?.();
    else first?.focus({ preventScroll: true });
  });
  return { el: sheet, close };
}

/** A sheet with a list of actions. items: [{ icon, label, onClick, current, hidden }] or 'sep' */
export function menuSheet(title, items) {
  return openSheet((sheet, close) => {
    if (title) sheet.append(h('h2', null, title));
    const list = h('div', { class: 'sheet-list', role: 'menu' });
    for (const it of items) {
      if (!it || it.hidden) continue;
      if (it === 'sep') {
        list.append(h('div', { class: 'sheet-sep', role: 'separator' }));
        continue;
      }
      list.append(h('button', {
        class: `sheet-item${it.current ? ' current' : ''}`,
        role: 'menuitem',
        'aria-current': it.current ? 'page' : null,
        onclick: () => {
          close();
          it.onClick?.();
        },
      }, it.icon ? (typeof it.icon === 'string' ? icon(it.icon) : it.icon) : null, h('span', { class: 'grow' }, it.label)));
    }
    sheet.append(list);
  }, { label: title });
}

// --- dialogs ---------------------------------------------------------------------------------

export function confirmDialog({ title, message, confirm, danger = false }) {
  return new Promise((resolve) => {
    const scrim = h('div', { class: 'scrim top' });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      pop();
      dlg.remove();
      scrim.remove();
      resolve(v);
    };
    const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => finish(true) }, confirm);
    const dlg = h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', null, title),
      message ? h('p', null, message) : null,
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn', onclick: () => finish(false) }, t('cancel')),
        ok));
    const pop = pushLayer(() => finish(false));
    scrim.addEventListener('click', () => finish(false));
    document.body.append(scrim, dlg);
    ok.focus();
  });
}

export function promptDialog({ title, value = '', placeholder = '', confirm }) {
  return new Promise((resolve) => {
    const scrim = h('div', { class: 'scrim top' });
    let done = false;
    const input = h('input', { class: 'input', value, placeholder, dir: 'auto', enterkeyhint: 'done' });
    const finish = (v) => {
      if (done) return;
      done = true;
      pop();
      dlg.remove();
      scrim.remove();
      resolve(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(input.value.trim() || null);
    });
    const dlg = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', null, title),
      h('div', { class: 'field' }, input),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn', onclick: () => finish(null) }, t('cancel')),
        h('button', { class: 'btn primary', onclick: () => finish(input.value.trim() || null) }, confirm || t('save'))));
    const pop = pushLayer(() => finish(null));
    scrim.addEventListener('click', () => finish(null));
    document.body.append(scrim, dlg);
    input.focus();
    input.select();
  });
}

// --- toasts -------------------------------------------------------------------------------------

let toastBox = null;

export function toast(message, { action, onAction, error = false, duration = 6000 } = {}) {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastBox);
  }
  fill(toastBox);
  const el = h('div', { class: `toast${error ? ' error' : ''}` }, h('span', { class: 'msg' }, message));
  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    el.remove();
  };
  if (action) {
    el.append(h('button', {
      onclick: () => {
        dismiss();
        onAction?.();
      },
    }, action));
  }
  toastBox.append(el);
  timer = setTimeout(dismiss, duration);
  return dismiss;
}

// --- busy --------------------------------------------------------------------------------------

export function busy(text) {
  const label = h('div', null, text);
  const bar = h('i');
  const box = h('div', { class: 'busy', role: 'alert', 'aria-busy': 'true' }, h('div', null, label, h('div', { class: 'bar' }, bar)));
  document.body.append(box);
  return {
    update(msg, fraction) {
      if (msg) label.textContent = msg;
      if (fraction != null) bar.style.setProperty('--p', `${Math.round(fraction * 100)}%`);
    },
    done() {
      box.remove();
    },
  };
}
