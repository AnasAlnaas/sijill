// Start-up: open the database, apply the look, show the notes, and wire the app to Android
// (back button, background/foreground, shortcuts, notification taps).

import { App } from '@capacitor/app';
import { store } from './state.js';
import { isNative, deviceInfo, takeLaunchAction, onLaunchAction, setSecureScreen } from './native.js';
import { applyAppearance, setSystemFontScale, onSystemThemeChange } from './ui/theme.js';
import { mountApp, goTo, currentView, createNote, createVoiceNote } from './ui/app.js';
import { openEditor, closeEditor } from './ui/editor.js';
import { back, closeAll } from './ui/layers.js';
import { toast } from './ui/overlays.js';
import { keepCaretVisible } from './ui/dom.js';
import { lockNow, unlock, onPause, onResume } from './ui/lock.js';
import { initReminders, collectEvents } from './services/reminders.js';
import { autoBackup } from './services/backup.js';
import { t } from './i18n.js';

async function boot() {
  const info = await deviceInfo();
  setSystemFontScale(info.fontScale);
  if (new URLSearchParams(location.search).has('gray')) document.documentElement.classList.add('grayscale');

  try {
    await store.init();
  } catch (e) {
    document.getElementById('app').textContent = `Sijill could not open its database: ${e?.message || e}`;
    throw e;
  }
  applyAppearance(store.settings);
  onSystemThemeChange(() => applyAppearance(store.settings));

  if (store.settings.lock) {
    lockNow();
    unlock();
  }
  setSecureScreen(store.settings.lock && store.settings.secureScreen);

  mountApp(document.getElementById('app'));
  initReminders(store);
  collectEvents();

  store.addEventListener('change', (e) => {
    if (e.detail?.saveError) toast(t('saveFailed'), { error: true, duration: 8000 });
  });

  // Save at once whenever the app might be killed.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.flush();
  });
  window.addEventListener('pagehide', () => store.flush());

  if (isNative) {
    App.addListener('pause', () => {
      store.flush();
      onPause(store.settings);
    });
    App.addListener('resume', () => {
      onResume(store.settings);
      collectEvents();
      store.purgeOldTrash();
      setTimeout(() => autoBackup(store).catch(() => {}), 2500);
    });
    App.addListener('backButton', () => {
      if (back()) return;
      if (currentView().kind !== 'notes') goTo({ kind: 'notes' });
      else App.minimizeApp();
    });
  }

  handleLaunch(await takeLaunchAction());
  onLaunchAction(handleLaunch);
  trackKeyboard();
  setTimeout(() => autoBackup(store).catch(() => {}), 4000);
}

/** Shortcuts on the app icon, and taps on reminder notifications. */
function handleLaunch(a) {
  if (!a?.action) return;
  if (a.action === 'openNote' && a.noteId && store.get(a.noteId)) {
    closeAll();
    openEditor(a.noteId);
  } else if (a.action === 'voiceNote') {
    closeEditor();
    closeAll();
    createVoiceNote();
  } else if (a.action === 'newNote' || a.action === 'newChecklist') {
    closeEditor();
    closeAll();
    createNote(a.action === 'newChecklist' ? 'list' : 'note');
  }
}

// If the WebView doesn't shrink for the keyboard, lift the bottom bars above it ourselves.
function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${kb > 80 ? kb : 0}px`);
    // When the keyboard opens or closes, keep the line being typed in view.
    const a = document.activeElement;
    if (a?.tagName === 'TEXTAREA') requestAnimationFrame(() => keepCaretVisible(a));
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
}

boot();
