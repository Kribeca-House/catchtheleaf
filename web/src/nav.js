// Navigation. The app routes on the URL hash (#/u/mila, #/catch, ...).
// The preview build keeps routes in memory instead, because the page it is published in
// doesn't allow #/paths in its address.
const DEMO = Boolean(import.meta.env.VITE_DEMO);
const listeners = new Set();
const stack = ['/'];

export function currentPath() {
  return DEMO ? stack[stack.length - 1] : (window.location.hash.replace(/^#/, '') || '/');
}
function notify() { listeners.forEach((fn) => fn(currentPath())); }

export function go(path) {
  if (DEMO) { stack.push(path); notify(); window.scrollTo(0, 0); } else window.location.hash = path;
}
export function back() {
  if (DEMO) { if (stack.length > 1) stack.pop(); notify(); } else window.history.back();
}
export function subscribe(fn) {
  listeners.add(fn);
  const on = () => fn(currentPath());
  if (!DEMO) window.addEventListener('hashchange', on);
  return () => { listeners.delete(fn); window.removeEventListener('hashchange', on); };
}

if (DEMO) {
  // Links stay plain <a href="#/..."> in the code; in the preview, route them in memory.
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#/"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    go(a.getAttribute('href').slice(1));
  });
}
