// Attachments (images and other files) live as plain files in the app's private storage;
// notes only hold { id, name, type, size }. In the browser preview they live in IndexedDB.

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { isNative, blobToBase64, base64ToBytes } from '../native.js';
import { uid } from '../core/model.js';
import { extFor } from '../core/backup.js';

const urls = new Map();

function pathOf(att) {
  return `attachments/${att.id}.${extFor(att)}`;
}

// --- browser preview storage ----------------------------------------------------------------

let idb = null;
function webDb() {
  if (!idb) {
    idb = new Promise((resolve, reject) => {
      const r = indexedDB.open('sijill-files', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return idb;
}

async function webPut(id, blob) {
  const db = await webDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(blob, id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function webGet(id) {
  const db = await webDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction('files').objectStore('files').get(id);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

// --- public ------------------------------------------------------------------------------------

/** Store a file and return its attachment record. */
export async function saveFile(blob, name, type, id = uid()) {
  const att = { id, name: name || 'file', type: type || blob.type || 'application/octet-stream', size: blob.size };
  if (isNative) {
    await Filesystem.writeFile({ path: pathOf(att), data: await blobToBase64(blob), directory: Directory.Data, recursive: true });
  } else {
    await webPut(att.id, blob);
  }
  return att;
}

/** A URL the WebView can show (img src). */
export async function fileUrl(att) {
  if (urls.has(att.id)) return urls.get(att.id);
  let url = null;
  try {
    if (isNative) {
      const { uri } = await Filesystem.getUri({ path: pathOf(att), directory: Directory.Data });
      url = Capacitor.convertFileSrc(uri);
    } else {
      const blob = await webGet(att.id);
      url = blob ? URL.createObjectURL(blob) : null;
    }
  } catch {
    url = null;
  }
  if (url) urls.set(att.id, url);
  return url;
}

export async function fileBlob(att) {
  try {
    if (isNative) {
      const r = await Filesystem.readFile({ path: pathOf(att), directory: Directory.Data });
      return new Blob([base64ToBytes(r.data)], { type: att.type });
    }
    return await webGet(att.id);
  } catch {
    return null;
  }
}

export async function hasFile(att) {
  if (!isNative) return Boolean(await webGet(att.id));
  try {
    await Filesystem.stat({ path: pathOf(att), directory: Directory.Data });
    return true;
  } catch {
    return false;
  }
}

/** Shrink big photos so notes stay light; keeps small images and non-images as they are. */
export async function prepareImage(file, maxSide = 2000) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 600 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 3 * 1024 * 1024) return file;
    const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
    return out.size < file.size ? new File([out], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}
