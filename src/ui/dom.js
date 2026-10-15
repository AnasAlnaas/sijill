// Small DOM helpers (adapted from Jotter).

const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'readOnly', 'tabIndex', 'textContent', 'spellcheck', 'autofocus']);

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

/** h('div', { class: 'x', onclick }, child, 'text', [more]) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || (v === false && !PROPS.has(k))) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

function scrollParent(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement;
}

/**
 * Grow a textarea to fit its content (no inner scrollbars).
 * Measuring needs a moment at height:auto, which briefly shortens the page; the scroll
 * position is put back so the view never jumps to the top while writing.
 */
export function autoGrow(ta) {
  const sp = scrollParent(ta);
  const top = sp?.scrollTop;
  const before = ta.offsetHeight;
  // Keep the page as tall as it was while measuring, so the browser has no reason to scroll.
  const content = sp === document.scrollingElement ? document.body : sp?.firstElementChild;
  const held = content?.style.minHeight;
  if (content) content.style.minHeight = `${content.offsetHeight}px`;
  ta.style.height = 'auto';
  const h = ta.scrollHeight;
  ta.style.height = `${h}px`;
  if (content) content.style.minHeight = held || '';
  if (sp && sp.scrollTop !== top) sp.scrollTop = top;
  return h !== before;
}

// A hidden copy of the textarea, to find where the caret is (in pixels from the top).
let mirror = null;
function caretTop(ta) {
  if (!mirror) {
    mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    // Fixed at the top-left, invisible and inside the screen: it must never widen the page.
    mirror.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;z-index:-1;contain:layout paint;white-space:pre-wrap;overflow-wrap:break-word;';
    document.body.append(mirror);
  }
  const cs = getComputedStyle(ta);
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderBottomWidth', 'boxSizing', 'direction', 'unicodeBidi', 'textAlign', 'tabSize']) {
    mirror.style[p] = cs[p];
  }
  mirror.style.width = `${ta.clientWidth}px`;
  mirror.textContent = ta.value.slice(0, ta.selectionEnd);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.append(marker);
  return { top: marker.offsetTop, height: parseFloat(cs.lineHeight) || 24 };
}

/**
 * Keep the line being typed in view (above the keyboard and the bottom bar), scrolling
 * only as much as needed.
 */
export function keepCaretVisible(ta, margin = 24) {
  if (document.activeElement !== ta) return;
  const sp = scrollParent(ta);
  if (!sp) return;
  const { top, height } = caretTop(ta);
  const taRect = ta.getBoundingClientRect();
  const spRect = sp === document.scrollingElement ? { top: 0, bottom: window.visualViewport?.height || innerHeight } : sp.getBoundingClientRect();
  const caretY = taRect.top + top;
  if (caretY + height + margin > spRect.bottom) sp.scrollTop += caretY + height + margin - spRect.bottom;
  else if (caretY - margin < spRect.top) sp.scrollTop -= spRect.top - (caretY - margin);
}

export function debounce(fn, ms) {
  let tm;
  const d = (...args) => {
    clearTimeout(tm);
    tm = setTimeout(() => fn(...args), ms);
  };
  d.cancel = () => clearTimeout(tm);
  d.flush = (...args) => {
    clearTimeout(tm);
    fn(...args);
  };
  return d;
}

/** Text with search matches wrapped in <mark>. ranges from normalize.matchRanges. */
export function highlighted(text, ranges) {
  if (!ranges?.length) return document.createTextNode(text);
  const frag = document.createDocumentFragment();
  let at = 0;
  for (const [s, e] of ranges) {
    if (s > at) frag.append(text.slice(at, s));
    frag.append(h('mark', null, text.slice(s, e)));
    at = e;
  }
  if (at < text.length) frag.append(text.slice(at));
  return frag;
}

export const isRtl = () => document.documentElement.dir === 'rtl';

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
const LTR_CHAR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;

/** Direction of a piece of text from its first strong letter, or null if it has none. */
export function dirOf(text) {
  for (const ch of String(text || '')) {
    if (RTL_CHAR.test(ch)) return 'rtl';
    if (LTR_CHAR.test(ch)) return 'ltr';
  }
  return null;
}
