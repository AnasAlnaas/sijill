// A small, safe Markdown renderer tuned for notes (from Jotter).
// Every line and block carries dir="auto", so mixed Arabic and English read correctly.
// Everything is HTML-escaped first; only a known set of tags is ever produced.
// Single line breaks are kept (notes are written line by line, like in Keep).
//
// Supports: # headings, **bold**, *italic*, ~~strike~~, ==highlight==, `code`,
// ``` fences, > quotes, - / 1. lists, - [ ] tasks, ---, [links](https://…),
// bare URLs and [[Wiki links]] to other notes.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE_RE = /^\s*(```|~~~)/;
const TASK_LINE_RE = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\]\s)/;
const SAFE_URL = /^(https?:|mailto:|tel:)/i;
const URL_RE = /\bhttps?:\/\/[^\s<]*[^\s<.,:;"')\]!?*_~]/g;

function unescapeHtml(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function anchor(url, label) {
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function inline(text) {
  const slots = [];
  const slot = (html) => `\u0000${slots.push(html) - 1}\u0000`;

  let s = text.replace(/`([^`\n]+)`/g, (_, c) => slot(`<code>${escapeHtml(c)}</code>`));
  s = escapeHtml(s);
  s = s.replace(/\[\[([^\]\n]{1,200})\]\]/g, (_, t) => slot(`<a href="#" class="wikilink" data-wiki="${t}">${t}</a>`));
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, url) =>
    SAFE_URL.test(unescapeHtml(url)) ? slot(anchor(url, label)) : m);
  s = s.replace(URL_RE, (url) => slot(anchor(url, url)));
  s = s
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([^\n]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^\n*]*?[^\s*])?\*(?!\*)/g, (m, pre, body) => body === undefined ? m : `${pre}<em>${body}</em>`)
    .replace(/(^|[^\w])_(?=\S)([^\n_]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, '<del>$1</del>')
    .replace(/==(?=\S)([^\n]*?\S)==/g, '<mark>$1</mark>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

function inlineLines(text) {
  return text.split('\n').map(inline).join('<br>');
}

function renderBlocks(lines, state) {
  let html = '';
  let para = [];
  const flush = () => {
    if (para.length) html += `<p>${para.map((l) => `<span class="ln" dir="auto">${inline(l)}</span>`).join('')}</p>`;
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;

    if ((m = FENCE_RE.exec(line))) {
      flush();
      const fence = m[1];
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
      i++;
      html += `<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`;
      continue;
    }
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      flush();
      const lvl = m[1].length;
      html += `<h${lvl} dir="auto">${inline(m[2])}</h${lvl}>`;
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      html += '<hr>';
      i++;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) buf.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      html += `<blockquote>${renderBlocks(buf, { ...state, interactive: false })}</blockquote>`;
      continue;
    }
    if (LIST_RE.test(line)) {
      flush();
      const items = [];
      while (i < lines.length) {
        const lm = LIST_RE.exec(lines[i]);
        if (lm) {
          items.push({
            indent: lm[1].replace(/\t/g, '    ').length,
            ordered: /\d/.test(lm[2]),
            start: parseInt(lm[2], 10),
            text: lm[3],
          });
          i++;
        } else if (items.length && /^\s+\S/.test(lines[i]) && !FENCE_RE.test(lines[i])) {
          items[items.length - 1].text += '\n' + lines[i++].trim();
        } else break;
      }
      html += renderList(items, state);
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return html;
}

function renderList(items, state) {
  let out = '';
  const stack = [];
  for (const it of items) {
    const tag = it.ordered ? 'ol' : 'ul';
    while (stack.length && it.indent < stack[stack.length - 1].indent) out += `</li></${stack.pop().tag}>`;
    const top = stack[stack.length - 1];
    if (!top || it.indent > top.indent) {
      out += `<${tag}${it.ordered && it.start !== 1 ? ` start="${it.start}"` : ''}>`;
      stack.push({ indent: it.indent, tag });
    } else {
      out += '</li>';
      if (top.tag !== tag) {
        out += `</${top.tag}><${tag}>`;
        top.tag = tag;
      }
    }
    const task = /^\[([ xX])\]\s+([\s\S]*)$/.exec(it.text);
    if (task) {
      const done = task[1] !== ' ';
      const box = state.interactive
        ? `<span class="task-box" role="checkbox" aria-checked="${done}" tabindex="0" data-task="${state.tasks++}"></span>`
        : '<span class="task-box"></span>';
      out += `<li dir="auto" class="task${done ? ' done' : ''}">${box}<span class="task-text">${inlineLines(task[2])}</span>`;
    } else {
      out += `<li dir="auto">${inlineLines(it.text)}`;
    }
  }
  while (stack.length) out += `</li></${stack.pop().tag}>`;
  return out;
}

export function renderMarkdown(src, { interactive = true } = {}) {
  const text = String(src || '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n');
  return renderBlocks(text.split('\n'), { tasks: 0, interactive });
}

/** Plain text with clickable links and kept line breaks (when Markdown is off). */
export function renderPlain(src) {
  const slots = [];
  let s = escapeHtml(String(src || '').replace(/\u0000/g, ''));
  s = s.replace(URL_RE, (url) => `\u0000${slots.push(anchor(url, url)) - 1}\u0000`);
  s = s.replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

/** Flip the n-th "- [ ]" task in the source. Matches the renderer's numbering. */
export function toggleTask(src, index) {
  const lines = String(src).split('\n');
  let n = 0;
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const f = FENCE_RE.exec(lines[i]);
    if (f) {
      if (!fence) fence = f[1];
      else if (lines[i].trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;
    const m = TASK_LINE_RE.exec(lines[i]);
    if (!m) continue;
    if (n === index) {
      lines[i] = m[1] + (m[2] === ' ' ? 'x' : ' ') + lines[i].slice(m[1].length + 1);
      return lines.join('\n');
    }
    n++;
  }
  return src;
}

/** Strip Markdown syntax for previews, notifications and exports. */
export function toPlainText(src) {
  return String(src || '')
    .replace(/^\s*(```|~~~).*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1');
}
