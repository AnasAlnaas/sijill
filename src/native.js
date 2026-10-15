// The app's own native Android plugins (see android/app/src/main/java/app/sijill/notes),
// with stand-ins so the same code runs in a desktop browser preview.

import { Capacitor, registerPlugin } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

const System = registerPlugin('SijillSystem');

// When the app hands over to a system screen (file picker, share sheet, print), Android
// pauses it. The app lock uses this to tell that apart from really leaving the app.
let externalAt = 0;
export const markExternal = () => { externalAt = Date.now(); };
export const externalActivityAt = () => externalAt;
const Reminders = registerPlugin('SijillReminders');

// --- base64 helpers --------------------------------------------------------------------------

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',', 2)[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --- device ----------------------------------------------------------------------------------

export async function deviceInfo() {
  if (!isNative) return { fontScale: 1, sdk: 0, manufacturer: 'browser', appVersion: 'preview' };
  try {
    return await System.getInfo();
  } catch {
    return { fontScale: 1, sdk: 0, manufacturer: '', appVersion: '' };
  }
}

export async function setSecureScreen(on) {
  if (isNative) await System.setSecure({ on }).catch(() => {});
}

export async function openSystemSettings(which) {
  markExternal();
  if (isNative) await System.openSettings({ which }).catch(() => {});
}

/** What launched the app: a shortcut or a tapped notification. */
export async function takeLaunchAction() {
  if (!isNative) {
    const p = new URLSearchParams(location.search);
    return p.get('action') ? { action: p.get('action'), noteId: p.get('note') } : null;
  }
  try {
    const r = await System.takeLaunchAction();
    return r?.action ? r : null;
  } catch {
    return null;
  }
}

export function onLaunchAction(fn) {
  if (isNative) System.addListener('launchAction', fn);
}

/** Status bar, navigation bar and window background in the theme's colour. */
export async function setBarColors(color, light = false) {
  // Minified CSS writes colours like #000; Android only reads the six-digit form.
  const c = String(color || '').trim().replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, '#$1$1$2$2$3$3');
  if (isNative && /^#[0-9a-f]{6}$/i.test(c)) await System.setBarColors({ color: c, light }).catch(() => {});
}

/** Long-press shortcuts on the app icon, labelled in the app's language. */
export async function setShortcuts(items) {
  if (isNative) await System.setShortcuts({ items }).catch(() => {});
}

// --- app lock ----------------------------------------------------------------------------------

export async function canAuthenticate() {
  if (!isNative) return { available: true, preview: true };
  return System.canAuthenticate();
}

export async function authenticate(title, subtitle) {
  markExternal();
  if (!isNative) return { ok: true };
  try {
    return await System.authenticate({ title, subtitle });
  } catch (e) {
    return { ok: false, error: e?.message };
  }
}

// --- printing (PDF) ----------------------------------------------------------------------------

export async function printHtml(html, name) {
  markExternal();
  if (isNative) return System.printHtml({ html, name });
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;inset-inline-start:-9999px;inline-size:800px;block-size:600px;border:0';
  document.body.append(frame);
  frame.srcdoc = html;
  await new Promise((r) => { frame.onload = r; });
  await frame.contentDocument.fonts?.ready;
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 1000);
  return { ok: true };
}

// --- files: save, open, folders -------------------------------------------------------------------

const CHUNK = 512 * 1024;

/** Let the user choose where to save a file (system "Save as"). Returns true if saved. */
export async function saveAs(blob, name, mime) {
  markExternal();
  if (!isNative) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return true;
  }
  const r = await System.createDocument({ name, mime });
  if (!r?.uri) return false;
  await writeBlob(r.uri, blob);
  return true;
}

async function writeBlob(uri, blob) {
  let off = 0;
  do {
    const end = Math.min(blob.size, off + CHUNK);
    const data = await blobToBase64(blob.slice(off, end));
    await System.writeChunk({ uri, data, append: off > 0, last: end >= blob.size });
    off = end;
  } while (off < blob.size);
}

/** A picked document that reads lazily, in chunks (Takeout exports can be very large). */
class NativeFile {
  constructor({ uri, name, size, mime }) {
    this.uri = uri;
    this.name = name || '';
    this.size = size;
    this.type = mime || '';
  }

  async sliceAsync(start, end) {
    const parts = [];
    for (let off = start; off < end; off += CHUNK * 4) {
      const len = Math.min(CHUNK * 4, end - off);
      const r = await System.readChunk({ uri: this.uri, offset: off, length: len });
      parts.push(base64ToBytes(r.data));
    }
    return new Blob(parts);
  }

  async text() {
    return (await this.sliceAsync(0, this.size)).text();
  }
}

/** Let the user pick a file. Returns a File (browser) or NativeFile (phone), or null. */
export async function pickFile(mimes = ['*/*']) {
  markExternal();
  if (!isNative) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = mimes.join(',');
      input.onchange = () => resolve(input.files[0] || null);
      input.oncancel = () => resolve(null);
      input.click();
    });
  }
  const r = await System.openDocument({ mimes });
  if (!r?.uri) return null;
  return new NativeFile(r);
}

/** Choose a folder the app may keep writing to (persisted permission). */
export async function pickFolder() {
  markExternal();
  if (!isNative) return null;
  const r = await System.pickFolder();
  return r?.uri ? { uri: r.uri, name: r.name } : null;
}

export async function folderWrite(treeUri, name, blob, mime) {
  if (!isNative) return false;
  const r = await System.createInFolder({ tree: treeUri, name, mime });
  await writeBlob(r.uri, blob);
  return true;
}

export async function folderList(treeUri) {
  if (!isNative) return [];
  const r = await System.listFolder({ tree: treeUri });
  return r.files || [];
}

export async function deleteDocument(uri) {
  if (isNative) await System.deleteDocument({ uri }).catch(() => {});
}

// --- reminders -----------------------------------------------------------------------------------

const webTimers = new Map();

export const reminders = {
  async status() {
    if (!isNative) {
      return { notifications: typeof Notification === 'undefined' ? 'denied' : Notification.permission === 'default' ? 'prompt' : Notification.permission, exact: true };
    }
    return Reminders.status();
  },

  async request() {
    markExternal();
    if (!isNative) {
      if (typeof Notification !== 'undefined') await Notification.requestPermission();
      return this.status();
    }
    return Reminders.request();
  },

  /** Replace the full set of scheduled alerts. items: [{ id, at, start, repeat, title, body }] */
  async sync(items, strings) {
    if (!isNative) {
      for (const t of webTimers.values()) clearTimeout(t);
      webTimers.clear();
      for (const it of items) {
        const delay = it.at - Date.now();
        if (delay > 0 && delay < 2 ** 31 - 1) {
          webTimers.set(it.id, setTimeout(() => {
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(it.title || 'سِجِلّ', { body: it.body });
          }, delay));
        }
      }
      return;
    }
    await Reminders.sync({ items, strings });
  },

  /** Done/Snooze taps from notifications, collected while the app was closed. */
  async takeEvents() {
    if (!isNative) return [];
    const r = await Reminders.takeEvents();
    return r.events || [];
  },

  onEvent(fn) {
    if (isNative) Reminders.addListener('reminderEvent', fn);
  },
};
