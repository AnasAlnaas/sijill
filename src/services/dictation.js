// Dictation: speech → text, through the phone's own speech recogniser (native plugin
// SijillSpeech). In a desktop browser preview, Chrome's built-in recogniser stands in.
// Only text comes back; audio is never stored.

import { registerPlugin } from '@capacitor/core';
import { isNative, markExternal } from '../native.js';

const Speech = registerPlugin('SijillSpeech');

export const LANGS = { ar: 'ar-SA', en: 'en-US' };

/** { available, permission: 'granted' | 'denied' | 'prompt' } */
export async function speechStatus() {
  if (isNative) return Speech.available();
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  return { available: Boolean(Rec), permission: 'prompt' };
}

export async function requestMic() {
  if (!isNative) return { permission: 'granted' };
  markExternal(); // the permission dialog briefly pauses the app; that's not "leaving"
  return Speech.requestMic();
}

/**
 * Start listening. handlers: { partial(text), final(text), level(0..1), listening(), end(reason), error(kind),
 *   notice('online') — no offline speech pack, so the online recogniser is used }
 * Returns a session with stop().
 */
export async function startDictation(lang, handlers) {
  if (isNative) {
    const subs = await Promise.all([
      Speech.addListener('partial', (e) => handlers.partial?.(e.text || '')),
      Speech.addListener('final', (e) => handlers.final?.(e.text || '')),
      Speech.addListener('level', (e) => handlers.level?.(e.level || 0)),
      Speech.addListener('state', () => handlers.listening?.()),
      Speech.addListener('error', (e) => handlers.error?.(e.error)),
      Speech.addListener('notice', (e) => handlers.notice?.(e.kind)),
      Speech.addListener('end', (e) => {
        for (const s of subs) s.remove();
        handlers.end?.(e.reason);
      }),
    ]);
    try {
      await Speech.start({ lang: LANGS[lang] || lang });
    } catch (e) {
      for (const s of subs) s.remove();
      throw e;
    }
    return { stop: () => Speech.stop() };
  }
  return webSession(lang, handlers);
}

// --- browser preview stand-in -----------------------------------------------------------------

function webSession(lang, handlers) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) throw new Error('unavailable');
  const rec = new Rec();
  rec.lang = LANGS[lang] || lang;
  rec.continuous = true;
  rec.interimResults = true;
  let stopped = false;
  rec.onstart = () => handlers.listening?.();
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) handlers.final?.(r[0].transcript);
      else interim += r[0].transcript;
    }
    handlers.partial?.(interim);
  };
  rec.onerror = (e) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') handlers.error?.(e.error === 'network' ? 'network' : e.error === 'not-allowed' ? 'permission' : 'recognizer');
  };
  rec.onend = () => handlers.end?.(stopped ? 'stopped' : 'silence');
  rec.start();
  return {
    stop: () => {
      stopped = true;
      rec.stop();
    },
  };
}
