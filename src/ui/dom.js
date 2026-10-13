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

/** Grow a textarea to fit its content (no inner scrollbars). */
export function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
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
