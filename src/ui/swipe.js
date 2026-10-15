// Swipe a card sideways: toward the end of the reading line to archive it, toward the start
// to move it to Trash (so in Arabic: left = archive, right = Trash; mirrored in English).
// What will happen is written behind the card while dragging (icon + words, not colour),
// it only triggers past a clear threshold, and the action offers Undo.

import { h } from './dom.js';
import { icon } from './icons.js';

const DECIDE = 12; // px before deciding between a swipe and a scroll
const FLING = 0.6; // px/ms counts as a quick flick

/**
 * container: element holding .card-wrap > .card[data-id]
 * opts.actionFor(id, side) → { key, icon, label } | null   side: 'end' | 'start'
 * opts.onAction(id, key)
 */
export function enableSwipe(container, opts) {
  let g = null;
  let swallowClickUntil = 0;

  const isRtl = () => document.documentElement.dir === 'rtl';

  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || g) return;
    const card = e.target.closest('.card[data-id]');
    if (!card || !opts.enabled?.()) return;
    g = { card, id: card.dataset.id, x: e.clientX, y: e.clientY, t: e.timeStamp, pointer: e.pointerId, swiping: false, dx: 0, side: null, armed: false };
  });

  container.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.pointer) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.swiping) {
      if (Math.abs(dy) > DECIDE && Math.abs(dy) > Math.abs(dx)) {
        g = null; // a scroll: leave it to the browser
        return;
      }
      if (Math.abs(dx) < DECIDE || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      g.swiping = true;
      g.wrap = g.card.parentElement;
      g.width = g.card.offsetWidth;
      g.card.setPointerCapture?.(e.pointerId);
      g.card.classList.add('swiping');
    }
    g.dx = dx;
    // Physical movement → reading direction: "end" is right in English, left in Arabic.
    const side = (dx > 0) !== isRtl() ? 'end' : 'start';
    if (side !== g.side) {
      g.side = side;
      g.action = opts.actionFor(g.id, side);
      setBackground(g, isRtl());
    }
    const resist = g.action ? 1 : 0.25; // no action this way: the card barely moves
    g.card.style.transform = `translateX(${dx * resist}px)`;
    const armed = Boolean(g.action) && Math.abs(dx) > Math.min(130, g.width * 0.35);
    if (armed !== g.armed) {
      g.armed = armed;
      g.bg?.classList.toggle('armed', armed);
      if (armed) navigator.vibrate?.(12);
    }
  });

  const finish = (e) => {
    if (!g || (e && e.pointerId !== g.pointer)) return;
    const cur = g;
    g = null;
    if (!cur.swiping) return;
    swallowClickUntil = Date.now() + 400;
    cur.card.classList.remove('swiping');
    const v = e ? Math.abs(cur.dx) / Math.max(1, e.timeStamp - cur.t) : 0;
    const go = cur.action && e?.type === 'pointerup' && (cur.armed || (v > FLING && Math.abs(cur.dx) > 60));
    if (go) {
      cur.card.style.transition = 'transform .16s ease-in, opacity .16s ease-in';
      cur.card.style.transform = `translateX(${Math.sign(cur.dx) * (cur.width + 40)}px)`;
      cur.card.style.opacity = '0';
      setTimeout(() => opts.onAction(cur.id, cur.action.key), 150);
    } else {
      cur.card.style.transition = 'transform .18s cubic-bezier(.2,.7,.2,1)';
      cur.card.style.transform = '';
      setTimeout(() => {
        cur.card.style.transition = '';
        cur.bg?.remove();
      }, 200);
    }
  };
  container.addEventListener('pointerup', finish);
  container.addEventListener('pointercancel', finish);

  // A swipe must not also open the note.
  container.addEventListener('click', (e) => {
    if (Date.now() < swallowClickUntil) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}

function setBackground(g, rtl) {
  g.bg?.remove();
  g.bg = null;
  if (!g.action) return;
  // The label sits on the side the card is moving away from, so it is uncovered first.
  const leftSide = g.dx > 0;
  // Laid out physically (left/right); only the words follow the language.
  g.bg = h('div', { class: `swipe-bg ${leftSide ? 'left' : 'right'}`, 'aria-hidden': 'true', dir: 'ltr' },
    icon(g.action.icon, { size: 24 }), h('span', { dir: rtl ? 'rtl' : 'ltr' }, g.action.label));
  g.wrap.prepend(g.bg);
}
