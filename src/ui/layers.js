// Everything that sits on top of the main screen (editor, settings, sheets, dialogs)
// registers here, so Android's back button and Escape close the topmost one first.

const stack = [];

export function pushLayer(close) {
  const entry = { close };
  stack.push(entry);
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Close the top layer. Returns false if there was nothing to close. */
export function back() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export function hasLayers() {
  return stack.length > 0;
}

export function closeAll() {
  while (stack.length) {
    const before = stack.length;
    stack[stack.length - 1].close();
    if (stack.length === before) stack.pop();
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.defaultPrevented) {
    if (back()) e.preventDefault();
  }
});
