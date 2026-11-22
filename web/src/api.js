const TOKEN_KEY = 'ctl.token';

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
};

export async function api(path, { method = 'GET', json, form } = {}) {
  if (import.meta.env.VITE_DEMO) {
    const { mockApi } = await import('./demo/mockApi.js');
    return mockApi(path, { method, json, form, token: getToken() });
  }
  const headers = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(`/api${path}`, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const displayName = (u) => u?.alias || `@${u?.username}`;

export function formatDate(d, withTime = false) {
  const date = new Date(d);
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleString(undefined, opts);
}

// Small deterministic random from an id, so the leaf pile looks the same every visit.
export function seeded(id, n) {
  let h = 2166136261;
  for (const ch of `${id}:${n}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

export const COMMON_TREES = [
  'Alder', 'Ash', 'Aspen', 'Beech', 'Birch', 'Cherry', 'Dogwood', 'Elm', 'Field maple', 'Ginkgo', 'Hawthorn',
  'Hazel', 'Hornbeam', 'Horse chestnut', 'Lime (linden)', 'London plane', 'Maple', 'Norway maple', 'Oak',
  'Poplar', 'Red oak', 'Rowan', 'Sweet chestnut', 'Sweetgum', 'Sycamore', 'Tulip tree', 'Walnut', 'Willow', 'Unknown',
];
