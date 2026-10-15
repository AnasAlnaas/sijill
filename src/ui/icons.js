// Line icons drawn for سِجِلّ (24×24, 1.75 stroke), and the marker shapes.
// Icons whose meaning has a direction (back, indent, chevrons) carry class "dir" and are
// mirrored in right-to-left layouts by CSS.

const P = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  note: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h5M9 12.5h7M9 16h5"/>',
  checklist: '<path d="m4 7 2 2 3.5-3.5M4 15l2 2 3.5-3.5M13 8h7M13 16h7"/>',
  checklistAdd: '<path d="m3.5 6.5 2 2 3.5-3.5M12 7.5h8M3.5 14.5h6M17.5 12v8M13.5 16h8"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor"/>',
  book: '<path d="M4 5.5c2.5-1.3 5.5-1.3 8 .5 2.5-1.8 5.5-1.8 8-.5v13c-2.5-1.3-5.5-1.3-8 .5-2.5-1.8-5.5-1.8-8-.5zM12 6v13"/>',
  hourglass: '<path d="M7 3.5h10M7 20.5h10M8 3.5c0 4.5 8 4.5 8 8.5s-8 4-8 8.5M16 3.5c0 4.5-8 4.5-8 8.5s8 4 8 8.5"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  forward: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  more: '<circle cx="12" cy="5.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="18.5" r="1.3" fill="currentColor"/>',
  pin: '<path d="M9 3.5h6l-1 5 3.5 3.5v1.5h-11V12L10 8.5z"/><path d="M12 13.5V21"/>',
  pinFilled: '<path d="M9 3.5h6l-1 5 3.5 3.5v1.5h-11V12L10 8.5z" fill="currentColor"/><path d="M12 13.5V21"/>',
  archive: '<path d="M3.5 5h17v4h-17zM5 9v10.5h14V9M10 13h4"/>',
  unarchive: '<path d="M3.5 5h17v4h-17zM5 9v10.5h14V9M12 18v-6M9.5 14.5 12 12l2.5 2.5"/>',
  trash: '<path d="M4 6.5h16M9.5 6.5V4h5v2.5M6 6.5l1 14h10l1-14M10 10.5v6.5M14 10.5v6.5"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5h4"/>',
  bellAlert: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5h4M12 8v4M12 14.2v.3"/>',
  label: '<path d="M3.5 12.5V4h8.5l8.5 8.5-8 8z"/><circle cx="8" cy="8.5" r="1.4"/>',
  marker: '<circle cx="7.5" cy="7.5" r="3.5"/><path d="M16.5 4 20 10h-7z"/><rect x="4" y="13.5" width="7" height="7"/><path d="m16.5 13 3.5 3.5-3.5 3.5-3.5-3.5z"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5M12 8v4.5l3 2"/>',
  share: '<circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="m8.7 10.7 6.6-3.9M8.7 13.3l6.6 3.9"/>',
  pdf: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h5M9 14.5h1.5a1.5 1.5 0 0 0 0-3H9v5.5M13.5 11.5V17h1a2.7 2.7 0 0 0 0-5.5z"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 2.5-2 4.5 3.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronEnd: '<path d="m9 6 6 6-6 6"/>',
  grip: '<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>',
  indent: '<path d="M4 5h16M11 10h9M11 14h9M4 19h16M4 9.5 7.5 12 4 14.5"/>',
  outdent: '<path d="M4 5h16M11 10h9M11 14h9M4 19h16M7.5 9.5 4 12l3.5 2.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M4.5 19.5h15"/>',
  upload: '<path d="M12 16V5M7 9.5l5-5 5 5M4.5 19.5h15"/>',
  folder: '<path d="M3.5 6.5v12h17V8.5h-8.5l-2-2z"/>',
  inbox: '<path d="M3.5 13.5 6 5h12l2.5 8.5v6h-17zM3.5 13.5h5l1 2.5h5l1-2.5h5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V4.5H4.5V16H8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.4"/>',
  alert: '<path d="M12 3.5 21 19.5H3z"/><path d="M12 10v4.5M12 16.8v.4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5"/>',
  convert: '<path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 20l-4-4 4-4"/>',
  boxEmpty: '<rect x="4.5" y="4.5" width="15" height="15" rx="2"/>',
  boxChecked: '<rect x="4.5" y="4.5" width="15" height="15" rx="2" fill="currentColor"/><path d="m8 12.3 2.8 2.8L16.3 9" stroke="var(--box-check, #fff)" stroke-width="2.2"/>',
  battery: '<rect x="3.5" y="7" width="15" height="10" rx="1.5"/><path d="M20.5 10.5v3M7 10v4M10 10v4"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v5.5H4.5V7H10"/>',
};

const DIR = new Set(['back', 'forward', 'chevronEnd', 'indent', 'outdent', 'undo']);

export function icon(name, { size = 24, label } = {}) {
  const span = document.createElement('span');
  span.className = `icon${DIR.has(name) ? ' dir' : ''}`;
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
  if (label) {
    span.setAttribute('role', 'img');
    span.setAttribute('aria-label', label);
  }
  return span;
}

// Marker shapes, filled, on a 16×16 grid. Each is distinct by outline alone.
const M = {
  circle: '<circle cx="8" cy="8" r="6"/>',
  triangle: '<path d="M8 1.8 14.6 13.6H1.4z"/>',
  square: '<rect x="2.2" y="2.2" width="11.6" height="11.6"/>',
  diamond: '<path d="M8 1 15 8 8 15 1 8z"/>',
  star: '<path d="m8 1 2.1 4.6 5 .5-3.8 3.4 1.1 4.9L8 11.9l-4.4 2.5 1.1-4.9L.9 6.1l5-.5z"/>',
  hexagon: '<path d="M8 1.2 14 4.6v6.8L8 14.8 2 11.4V4.6z"/>',
  plus: '<path d="M5.8 1.5h4.4v4.3h4.3v4.4h-4.3v4.3H5.8v-4.3H1.5V5.8h4.3z"/>',
  ring: '<path fill-rule="evenodd" d="M8 1.8a6.2 6.2 0 1 1 0 12.4A6.2 6.2 0 0 1 8 1.8zm0 3a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z"/>',
  half: '<path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z"/><circle cx="8" cy="8" r="5.45" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  down: '<path d="M8 14.2 1.4 2.4h13.2z"/>',
  bar: '<rect x="1.2" y="5.4" width="13.6" height="5.2" rx=".6"/>',
};

export function markerIcon(shape, { size = 16, label } = {}) {
  const span = document.createElement('span');
  span.className = 'marker';
  if (!shape || !M[shape]) {
    span.classList.add('none');
    span.innerHTML = `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.2 2"/></svg>`;
  } else {
    span.style.setProperty('--m', `var(--m-${shape}, currentColor)`);
    span.innerHTML = `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${M[shape]}</svg>`;
  }
  if (label) {
    span.setAttribute('role', 'img');
    span.setAttribute('aria-label', label);
  }
  return span;
}

export const MARKER_PATHS = M;
