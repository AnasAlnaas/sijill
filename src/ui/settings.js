// Settings: simple choices first; reliability tips and fonts under "Advanced".

import { h, fill } from './dom.js';
import { icon } from './icons.js';
import { pushLayer } from './layers.js';
import { toast, busy, menuSheet } from './overlays.js';
import { applyAppearance } from './theme.js';
import { rerender } from './app.js';
import { store } from '../state.js';
import { t } from '../i18n.js';
import { dateTime, date, num } from '../core/format.js';
import { isNative, deviceInfo, canAuthenticate, setSecureScreen, openSystemSettings, pickFile, pickFolder } from '../native.js';
import { permission, sync as syncReminders } from '../services/reminders.js';
import { exportAll, autoBackup, restoreFromFile, importKeep, listInternalBackups, readInternalBackup, applyBackup, backupErrorText } from '../services/backup.js';

let layer = null;

export function openSettings() {
  if (layer) return;
  const scroll = h('div', { class: 'layer-scroll' });
  const titleEl = h('span', { class: 'title' });
  const el = h('div', { class: 'layer settings', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'layer-top' },
      h('button', { class: 'icon-btn', 'aria-label': t('back'), onclick: () => close() }, icon('back')),
      titleEl),
    scroll);
  const pop = pushLayer(() => close());
  const close = () => {
    pop();
    store.removeEventListener('change', onChange);
    el.classList.add('closing');
    setTimeout(() => el.remove(), 140);
    layer = null;
  };
  const onChange = (e) => {
    if (e.detail?.settings) render();
  };
  store.addEventListener('change', onChange);
  layer = { el, close };
  document.body.append(el);

  const render = async () => {
    const y = scroll.scrollTop;
    titleEl.textContent = t('settings');
    el.setAttribute('aria-label', t('settings'));
    fill(scroll, await build());
    scroll.scrollTop = y;
  };
  render();
}

// --- building blocks ------------------------------------------------------------------------------

function set(key, value) {
  store.set(key, value);
  if (['lang', 'theme', 'accent', 'textScale', 'numerals', 'calendar', 'readingFont'].includes(key)) {
    applyAppearance(store.settings);
    rerender();
  }
}

function group(title, ...rows) {
  return h('section', { class: 'set-group' }, h('h2', null, title), h('div', { class: 'set-card' }, rows));
}

function row(label, control, help) {
  return h('div', { class: 'set-row' }, h('div', { class: 'label' }, label), help ? h('p', { class: 'help' }, help) : null, control);
}

function seg(options, value, onPick, label) {
  return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label },
    options.map(([v, text]) => h('button', {
      role: 'radio', 'aria-checked': String(v === value),
      onclick: () => onPick(v),
    }, icon('check', { size: 18 }), text)));
}

function switchRow(label, on, onToggle, help) {
  const sw = h('button', { class: 'switch-hit', role: 'switch', 'aria-checked': String(on), 'aria-label': label, onclick: () => onToggle(!on) },
    h('span', { class: 'switch', 'aria-checked': String(on) }));
  return h('div', { class: 'set-row inline' }, h('div', null, h('div', { class: 'label' }, label), help ? h('p', { class: 'help' }, help) : null), sw);
}

const ACCENTS = [
  ['none', 'accentNone', null],
  ['blue', 'accentBlue', '#7aacf5'],
  ['teal', 'accentTeal', '#1ebdb6'],
  ['saffron', 'accentSaffron', '#da9f4e'],
  ['red', 'accentRed', '#f18f87'],
];

// --- the page -------------------------------------------------------------------------------------

async function build() {
  const s = store.settings;
  const info = await deviceInfo();
  const notif = await permission.status().catch(() => ({ notifications: 'denied' }));

  const appearance = group(t('appearance'),
    row(t('language'), seg([['ar', 'العربية'], ['en', 'English']], s.lang, (v) => set('lang', v), t('language'))),
    row(t('theme'), seg([['system', t('themeSystem')], ['light', t('themeLight')], ['dark', t('themeDark')], ['black', t('themeBlack')]], s.theme, (v) => set('theme', v), t('theme'))),
    row(t('accent'), h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': t('accent') },
      ACCENTS.map(([v, key, color]) => h('button', {
        class: 'swatch', role: 'radio', 'aria-checked': String(s.accent === v),
        onclick: () => set('accent', v),
      }, h('span', { class: `dot${color ? '' : ' none'}`, style: color ? { background: color } : null }), h('span', null, t(key)), h('span', { class: 'tick' }, icon('check'))))), t('accentHelp')),
    textSizeRow(s));

  const dates = group(t('datesNumbers'),
    row(t('numerals'), seg([['arab', t('numeralsArab')], ['latn', t('numeralsLatn')]], s.numerals, (v) => set('numerals', v), t('numerals'))),
    row(t('calendar'), seg([['gregory', t('calGregory')], ['hijri', t('calHijri')], ['both', t('calBoth')]], s.calendar, (v) => set('calendar', v), t('calendar')),
      date(Date.now(), { year: 'always', weekday: true })));

  const auth = await canAuthenticate().catch(() => ({ available: false }));
  const privacy = group(t('privacy'),
    switchRow(t('appLock'), s.lock, async (on) => {
      if (on && !auth.available) {
        toast(t('lockUnavailable'), { error: true, duration: 8000 });
        return;
      }
      set('lock', on);
      await setSecureScreen(on && s.secureScreen);
    }, auth.available ? t('appLockHelp') : t('lockUnavailable')),
    s.lock ? row(t('lockAfter'), seg([[0, t('lockNow')], [60, t('lock1')], [300, t('lock5')]], s.lockAfter, (v) => set('lockAfter', v), t('lockAfter'))) : null,
    s.lock ? switchRow(t('secureScreen'), s.secureScreen, async (on) => {
      set('secureScreen', on);
      await setSecureScreen(on);
    }) : null);

  const notifOn = notif.notifications === 'granted';
  const reminders = group(t('remindersSection'),
    h('div', { class: 'set-row inline' },
      h('div', { class: 'label' }, notifOn ? t('notifStatusOn') : t('notifStatusOff')),
      notifOn ? icon('check') : h('button', {
        class: 'btn',
        onclick: async () => {
          const r = await permission.request();
          if (r.notifications !== 'granted') await openSystemSettings('notifications');
          syncReminders();
          openSettingsRefresh();
        },
      }, t('allow'))),
    row(t('snoozeLength'), seg([[10, t('minutes', { n: 10 })], [30, t('minutes', { n: 30 })], [60, t('hour')]], s.snoozeMinutes, (v) => set('snoozeMinutes', v), t('snoozeLength'))));

  const internal = await listInternalBackups();
  const backups = group(t('backups'),
    row(t('autoBackup'), h('div', { class: 'btns' },
      h('button', {
        class: 'btn',
        onclick: async () => {
          const b = busy(t('working'));
          try {
            await autoBackup(store, { force: true });
            toast(t('backupSaved'));
          } catch (e) {
            toast(backupErrorText(e), { error: true });
          } finally {
            b.done();
            openSettingsRefresh();
          }
        },
      }, icon('download'), t('backupNow'))),
    `${t('autoBackupHelp')} ${t('lastBackup', { when: s.lastBackupAt ? dateTime(s.lastBackupAt) : t('never') })}`),
    isNative ? row(t('backupFolder'), h('div', { class: 'btns' },
      h('button', {
        class: 'btn',
        onclick: async () => {
          const f = await pickFolder();
          if (!f) return;
          set('backupFolder', f);
          set('lastFolderBackupAt', 0);
          const b = busy(t('working'));
          try {
            await autoBackup(store);
            toast(t('backupSaved'));
          } catch (e) {
            toast(backupErrorText(e), { error: true });
          } finally {
            b.done();
          }
        },
      }, icon('folder'), t('chooseFolder'))), s.backupFolder ? `${s.backupFolder.name} — ${t('lastBackup', { when: s.lastFolderBackupAt ? dateTime(s.lastFolderBackupAt) : t('never') })}` : t('noFolder')) : null,
    row(t('exportAll'), h('div', { class: 'btns' },
      h('button', {
        class: 'btn',
        onclick: async () => {
          const b = busy(t('working'));
          try {
            if (await exportAll(store, (i, n) => b.update(null, i / n))) toast(t('exportSaved'));
          } catch (e) {
            toast(backupErrorText(e), { error: true });
          } finally {
            b.done();
          }
        },
      }, icon('upload'), t('exportAll'))), t('exportAllHelp')),
    row(t('restoreBackup'), h('div', { class: 'btns' },
      h('button', { class: 'btn', onclick: () => restore() }, icon('restore'), t('restoreBackup')),
      internal.length ? h('button', { class: 'btn quiet', onclick: () => restoreInternal(internal) }, t('restoreInternal')) : null), t('restoreHelp')),
    row(t('importKeep'), h('div', { class: 'btns' },
      h('button', { class: 'btn', onclick: () => keepImport() }, icon('inbox'), t('importKeep'))), t('importKeepHelp')));

  const advanced = group(t('advanced'),
    row(t('readingFont'), seg([['naskh', t('fontNaskh')], ['amiri', t('fontAmiri')]], s.readingFont || 'naskh', (v) => set('readingFont', v), t('readingFont')),
      h('span', { class: 'sample', style: { display: 'block' } }, t('sample'))),
    h('div', { class: 'set-row' },
      h('div', { class: 'label' }, t('reliability')),
      h('p', { class: 'help' }, t('reliabilityHelp')),
      h('ol', null, h('li', null, t('reliabilityStep1')), h('li', null, t('reliabilityStep2'))),
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: () => openSystemSettings('battery') }, icon('battery'), t('openBattery')),
        h('button', { class: 'btn', onclick: () => openSystemSettings('app') }, icon('external'), t('openAppSettings')))));

  const about = group(t('about'),
    h('div', { class: 'set-row' },
      h('div', { class: 'label' }, `${t('appName')} — ${t('version', { v: info.appVersion || '0.1.0' })}`),
      h('p', { class: 'help' }, t('aboutText')),
      h('p', { class: 'help' }, t('fontsLicence'))));

  return h('div', { class: 'settings-inner' }, appearance, dates, privacy, reminders, backups, advanced, about);
}

function textSizeRow(s) {
  const steps = [0.85, 1, 1.15, 1.3, 1.5];
  const idx = Math.max(0, steps.findIndex((x) => Math.abs(x - (s.textScale || 1)) < 0.01));
  const range = h('input', { type: 'range', min: '0', max: String(steps.length - 1), step: '1', value: String(idx), 'aria-label': t('textSize') });
  range.addEventListener('change', () => set('textScale', steps[Number(range.value)]));
  return row(t('textSize'), h('div', null, h('div', { style: { display: 'flex', alignItems: 'center', gap: '.75rem' } },
    h('span', { 'aria-hidden': 'true', style: { fontSize: '.85rem' } }, 'أ A'), range, h('span', { 'aria-hidden': 'true', style: { fontSize: '1.4rem' } }, 'أ A')),
  h('p', { class: 'sample' }, t('sample'))), t('textSizeHelp'));
}

function openSettingsRefresh() {
  store.emit({ settings: ['refresh'] });
}

async function restore() {
  const file = await pickFile(['application/zip', 'application/json', 'application/octet-stream']);
  if (!file) return;
  const b = busy(t('working'));
  try {
    const r = await restoreFromFile(store, file);
    toast(t('restoreDone', { added: r.added, replaced: r.replaced }), { duration: 8000 });
  } catch (e) {
    toast(backupErrorText(e), { error: true, duration: 8000 });
  } finally {
    b.done();
  }
}

function restoreInternal(list) {
  menuSheet(t('restoreInternal'), list.map((f) => ({
    icon: 'history',
    label: f.name.replace(/^sijill-|\.json$/g, '').replace(/\d/g, (d) => num(d)),
    onClick: async () => {
      const b = busy(t('working'));
      try {
        const r = await applyBackup(store, await readInternalBackup(f.name));
        toast(t('restoreDone', { added: r.added, replaced: r.replaced }), { duration: 8000 });
      } catch (e) {
        toast(backupErrorText(e), { error: true });
      } finally {
        b.done();
      }
    },
  })));
}

async function keepImport() {
  const file = await pickFile(['application/zip', 'application/x-zip-compressed', 'application/octet-stream']);
  if (!file) return;
  const b = busy(t('working'));
  try {
    const r = await importKeep(store, file, (done, total) => b.update(t('importing', { done, total }), total ? done / total : null));
    if (!r.imported && !r.duplicates) toast(t('notKeep'), { error: true, duration: 8000 });
    else toast(`${t('importDone', { imported: r.imported, duplicates: r.duplicates })}${r.missingFiles ? ` ${t('importMissing', { n: r.missingFiles })}` : ''}`, { duration: 10000 });
  } catch (e) {
    toast(backupErrorText(e), { error: true, duration: 8000 });
  } finally {
    b.done();
  }
}
