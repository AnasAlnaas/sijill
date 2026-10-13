// Getting one note out: copy, share as text, save as PDF.
// PDFs go through Android's own print engine ("Save as PDF"), which shapes Arabic perfectly.

import { Share } from '@capacitor/share';
import { isNative, printHtml, blobToBase64, markExternal } from '../native.js';
import { noteToPlainText, displayTitle } from '../core/model.js';
import { renderMarkdown } from '../core/markdown.js';
import { date, time } from '../core/format.js';
import { fileBlob } from '../services/files.js';
import { store } from '../state.js';
import { t, getLang } from '../i18n.js';
import { toast } from './overlays.js';

export async function copyNoteText(note) {
  try {
    await navigator.clipboard.writeText(noteToPlainText(note));
    toast(t('copied'));
  } catch {
    toast(t('failed', { msg: 'clipboard' }), { error: true });
  }
}

export async function shareNoteText(note) {
  const text = noteToPlainText(note);
  try {
    markExternal();
    if (isNative) await Share.share({ title: displayTitle(note), text, dialogTitle: t('shareText') });
    else if (navigator.share) await navigator.share({ title: displayTitle(note), text });
    else await copyNoteText(note);
  } catch { /* cancelled */ }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const FONT_BASE = isNative ? 'https://appassets.androidplatform.net/assets/public/fonts/' : `${location.origin}/fonts/`;

function fontFaces() {
  const ar = 'U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFC, U+200C-200E';
  const la = 'U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+2122';
  const face = (fam, file, w, range) => `@font-face{font-family:'${fam}';src:url('${FONT_BASE}${file}') format('woff2');font-weight:${w};unicode-range:${range}}`;
  return [
    face('R', 'noto-naskh-arabic-arabic-400-normal.woff2', 400, ar),
    face('R', 'noto-naskh-arabic-arabic-700-normal.woff2', 700, ar),
    face('R', 'noto-serif-latin-400-normal.woff2', 400, la),
    face('R', 'noto-serif-latin-700-normal.woff2', 700, la),
    face('S', 'ibm-plex-sans-arabic-arabic-400-normal.woff2', 400, ar),
    face('S', 'ibm-plex-sans-latin-400-normal.woff2', 400, la),
  ].join('\n');
}

export async function noteHtml(note) {
  const lang = getLang();
  let body;
  if (note.type === 'list') {
    body = `<ul class="list">${(note.items || []).map((i) => `<li dir="auto" class="${i.done ? 'done' : ''}${i.indent ? ' sub' : ''}"><span class="box">${i.done ? '☑' : '☐'}</span> ${esc(i.text)}</li>`).join('')}</ul>`;
  } else {
    body = renderMarkdown(note.body, { interactive: false });
  }
  const imgs = [];
  for (const a of (note.attachments || []).filter((x) => x.type?.startsWith('image/'))) {
    const b = await fileBlob(a);
    if (b) imgs.push(`<img src="data:${a.type};base64,${await blobToBase64(b)}" alt="">`);
  }
  const labels = (note.labels || []).map(store.labelName).filter(Boolean);
  const meta = [`${date(note.updatedAt, { year: 'always' })} · ${time(note.updatedAt)}`, ...labels].map(esc).join(' · ');
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(displayTitle(note) || 'سِجِلّ')}</title>
<style>
${fontFaces()}
@page { margin: 18mm 16mm; }
body { font-family: 'R', serif; color: #111; font-size: 12.5pt; line-height: 1.75; margin: 0; }
h1.title { font-size: 20pt; line-height: 1.4; margin: 0 0 4pt; unicode-bidi: plaintext; text-align: start; }
.meta { font-family: 'S', sans-serif; font-size: 9pt; color: #444; margin-bottom: 14pt; padding-bottom: 8pt; border-bottom: 0.75pt solid #999; }
p { margin: 0 0 9pt; } .ln { display: block; text-align: start; }
h1, h2, h3, h4 { line-height: 1.4; margin: 12pt 0 5pt; text-align: start; }
ul, ol { margin: 0 0 9pt; padding-inline-start: 18pt; } li { text-align: start; }
ul.list { list-style: none; padding: 0; } ul.list li { margin: 2pt 0; } ul.list li.sub { padding-inline-start: 18pt; }
ul.list li.done { color: #555; text-decoration: line-through; } .box { font-family: 'S', sans-serif; }
li.task { list-style: none; } .task-box::before { content: '☐ '; } li.task.done .task-box::before { content: '☑ '; } li.task.done .task-text { text-decoration: line-through; color: #555; }
blockquote { margin: 0 0 9pt; padding-inline-start: 10pt; border-inline-start: 2pt solid #888; color: #333; }
mark { background: #ddd; text-decoration: underline; } a { color: #111; }
pre { white-space: pre-wrap; font-size: 10pt; background: #f2f2f2; padding: 6pt; }
img { max-width: 100%; max-height: 120mm; display: block; margin: 10pt auto; page-break-inside: avoid; }
</style></head><body>
${note.title ? `<h1 class="title" dir="auto">${esc(note.title)}</h1>` : ''}
<div class="meta" dir="auto">${meta}</div>
${body}
${imgs.join('\n')}
</body></html>`;
}

export async function exportNotePdf(note) {
  try {
    const html = await noteHtml(note);
    await printHtml(html, (displayTitle(note) || 'sijill').slice(0, 60));
  } catch (e) {
    toast(t('failed', { msg: e?.message || e }), { error: true });
  }
}
