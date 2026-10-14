// The dictation panel inside the editor: live words, a level line, the language switch and
// a full-width Stop button (reachable from either thumb). Recognised text is added to the note
// as it is confirmed, so nothing is lost if the app is closed mid-sentence.

import { h, fill } from './dom.js';
import { icon } from './icons.js';
import { toast } from './overlays.js';
import { whenUnlocked } from './lock.js';
import { store } from '../state.js';
import { t, getLang } from '../i18n.js';
import { speechStatus, requestMic, startDictation } from '../services/dictation.js';
import { openSystemSettings } from '../native.js';

export class DictationPanel {
  constructor(editor) {
    this.ed = editor;
    this.el = h('div', { class: 'dictation', role: 'region', 'aria-label': t('dictate') });
    this.session = null;
    this.state = 'idle'; // idle | starting | listening | stopped
    this.partial = '';
    this.level = 0;
    this.restartAfterEnd = false;
  }

  get lang() {
    return store.settings.dictationLang || getLang();
  }

  async start() {
    if (this.state === 'listening' || this.state === 'starting') return;
    document.activeElement?.blur?.(); // hide the keyboard while dictating
    const st = await speechStatus().catch(() => ({ available: false }));
    if (!st.available) {
      toast(t('speechUnavailable'), { error: true, duration: 8000 });
      return;
    }
    if (st.permission !== 'granted') {
      const r = await requestMic().catch(() => ({ permission: 'denied' }));
      if (r.permission !== 'granted') {
        toast(t('micDenied'), { error: true, duration: 8000, action: t('openAppSettings'), onAction: () => openSystemSettings('app') });
        return;
      }
    }
    await whenUnlocked();
    if (this.ed.closed) return;
    this.mount();
    await this.listen();
  }

  mount() {
    if (!this.el.isConnected) this.ed.barEl.before(this.el);
    document.body.classList.add('dictating'); // messages move to the top, clear of the Stop button
  }

  async listen() {
    this.state = 'starting';
    this.partial = '';
    this.render();
    try {
      this.session = await startDictation(this.lang, {
        listening: () => {
          this.state = 'listening';
          this.render();
        },
        partial: (text) => {
          this.partial = text;
          this.renderLive();
        },
        final: (text) => {
          this.partial = '';
          this.ed.noteBody?.appendText(text);
          this.renderLive();
        },
        level: (l) => {
          this.level = l;
          this.renderLive();
        },
        notice: (kind) => {
          if (kind === 'offline' && !this.toldOffline) {
            this.toldOffline = true;
            toast(t('speechOffline'), { duration: 8000 });
          }
        },
        error: (kind) => {
          toast(kind === 'network' ? t('speechNetwork') : kind === 'permission' ? t('micDenied') : t('speechStuck'), { error: true, duration: 8000 });
        },
        end: () => {
          this.session = null;
          // Words still on screen but not yet confirmed are kept too.
          if (this.partial.trim()) this.ed.noteBody?.appendText(this.partial);
          this.partial = '';
          if (this.restartAfterEnd && !this.ed.closed) {
            this.restartAfterEnd = false;
            this.listen();
            return;
          }
          this.state = 'stopped';
          this.level = 0;
          this.render();
        },
      });
    } catch (e) {
      this.state = 'stopped';
      this.render();
      toast(String(e?.message).includes('permission') ? t('micDenied') : t('speechUnavailable'), { error: true, duration: 8000 });
    }
  }

  stop() {
    this.restartAfterEnd = false;
    this.session?.stop();
  }

  setLang(code) {
    if (code === this.lang) return;
    store.set('dictationLang', code);
    if (this.session) {
      // Switch language mid-dictation: finish the current phrase, then listen again.
      this.restartAfterEnd = true;
      this.session.stop();
    }
    this.render();
  }

  close() {
    // Keep words still being recognised: the note may be closing right now.
    if (this.partial.trim()) this.ed.noteBody?.appendText(this.partial);
    this.partial = '';
    this.stop();
    this.state = 'idle';
    this.el.remove();
    document.body.classList.remove('dictating');
  }

  renderLive() {
    if (this.liveEl) this.liveEl.textContent = this.partial;
    if (this.meterEl) this.meterEl.style.setProperty('--l', `${Math.round(this.level * 100)}%`);
  }

  render() {
    const on = this.state === 'listening' || this.state === 'starting';
    this.liveEl = h('p', { class: 'live', 'aria-live': 'polite' }, this.partial);
    this.meterEl = h('i');
    const langBtn = (code, label) => h('button', {
      role: 'radio', 'aria-checked': String(this.lang === code), lang: code,
      onclick: () => this.setLang(code),
    }, icon('check', { size: 18 }), label);
    fill(this.el,
      h('div', { class: 'status' }, icon(on ? 'mic' : 'info', { size: 22 }), h('span', null, this.state === 'starting' ? t('startingMic') : on ? t('listening') : t('paused'))),
      on ? this.liveEl : null,
      on ? h('div', { class: 'meter', 'aria-hidden': 'true' }, this.meterEl) : null,
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': t('dictationLang') }, langBtn('ar', 'العربية'), langBtn('en', 'English')),
      on
        ? h('button', { class: 'btn primary wide', onclick: () => this.stop() }, icon('stop', { size: 22 }), t('stopDictation'))
        : h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn', onclick: () => this.close() }, icon('check', { size: 20 }), t('done')),
          h('button', { class: 'btn primary', onclick: () => this.listen() }, icon('mic', { size: 20 }), t('resumeDictation'))));
    this.renderLive();
  }
}
