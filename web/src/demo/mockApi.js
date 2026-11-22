// Preview mode: the whole API, in the browser, with sample players. Nothing leaves the page and
// everything resets on reload. Built only with VITE_DEMO=1 (npm run build:demo).
// Mirrors server/src/app.js closely enough to try every screen; the real rules live there.
import { rankFirstCatch, rankWealth, allTimeScores, withPlaces } from '../../../server/src/scoring.js';
import maple from './img/maple.png';
import redMaple from './img/red-maple.png';
import beech from './img/beech.png';
import oak from './img/oak.png';
import ginkgo from './img/ginkgo.png';
import birch from './img/birch.png';
import sweetgum from './img/sweetgum.png';
import avMila from './img/av-mila.jpg';
import avOscar from './img/av-oscar.jpg';
import avTheo from './img/av-theo.jpg';

const LEAF_IMG = {
  'Field maple': maple, 'Norway maple': redMaple, Beech: beech, Oak: oak, Ginkgo: ginkgo, Birch: birch, Sweetgum: sweetgum,
};
const SCI = {
  'Field maple': 'Acer campestre', 'Norway maple': 'Acer platanoides', Beech: 'Fagus sylvatica', Oak: 'Quercus robur',
  Ginkgo: 'Ginkgo biloba', Birch: 'Betula pendula', Sweetgum: 'Liquidambar styraciflua',
};

let n = 0;
const uid = () => `demo-${++n}-${Math.random().toString(36).slice(2, 8)}`;

const year = new Date().getFullYear();
const S = {
  users: [], sessions: new Map(), leaves: [], friendships: [], groups: [],
  seasons: [
    { id: 1, name: `Autumn ${year - 1}`, starts_at: new Date(`${year - 1}-09-01T00:00:00Z`), ends_at: new Date(`${year - 1}-12-01T00:00:00Z`) },
    { id: 2, name: `Autumn ${year}`, starts_at: new Date(`${year}-09-01T00:00:00Z`), ends_at: new Date(`${year}-12-01T00:00:00Z`) },
  ],
};

function addUser(username, alias, opts = {}) {
  const u = { id: uid(), username, alias, email: null, password: null, avatar: opts.avatar || null, is_private: Boolean(opts.private) };
  S.users.push(u);
  return u;
}
function addLeaf(user, tree, when, caption) {
  const img = LEAF_IMG[tree];
  const caught = new Date(when);
  S.leaves.push({
    id: uid(), user_id: user.id, season_id: seasonAt(caught)?.id ?? null, caught_at: caught.toISOString(), caught_at_source: 'photo',
    photo: img, cutout: img, colour: '#617257', tree_name: tree, tree_scientific: SCI[tree], tree_confidence: 0.8, tree_source: 'auto', caption,
  });
}
const befriend = (a, b, status = 'accepted') => S.friendships.push({ requester_id: a.id, addressee_id: b.id, status });

// ---- sample players ----
const mila = addUser('mila', 'Mila', { avatar: avMila });
const benji = addUser('benji', 'Benji');
const oscar = addUser('oscar.k', 'Oscar', { avatar: avOscar });
const juno = addUser('juno', null);
const theo = addUser('theo', 'Theo', { avatar: avTheo, private: true });
const ines = addUser('ines', 'Inès');
const y0 = year - 1;
addLeaf(oscar, 'Field maple', `${y0}-09-12T16:20:00Z`, 'First of the year, off a park bench');
addLeaf(mila, 'Beech', `${y0}-09-20T08:05:00Z`, 'On the way to work');
addLeaf(benji, 'Oak', `${y0}-10-02T13:40:00Z`, '');
addLeaf(mila, 'Ginkgo', `${y0}-10-15T11:00:00Z`, 'Gold rain');
addLeaf(mila, 'Field maple', `${y0}-10-28T17:30:00Z`, '');
addLeaf(juno, 'Birch', `${y0}-11-03T09:10:00Z`, 'Finally!');
addLeaf(mila, 'Norway maple', `${year}-09-08T07:45:00Z`, 'Snatched it right off the bus stop roof');
addLeaf(theo, 'Sweetgum', `${year}-09-14T18:00:00Z`, 'Dive catch, ruined my jeans');
addLeaf(benji, 'Field maple', `${year}-09-21T12:12:00Z`, 'Two-handed clap catch');
addLeaf(oscar, 'Oak', `${year}-10-01T10:30:00Z`, '');
addLeaf(mila, 'Beech', `${year}-10-04T15:00:00Z`, 'Windy one by the river');
addLeaf(benji, 'Ginkgo', `${year}-10-11T16:45:00Z`, 'The ginkgo tree on Rue Pascal never misses');
addLeaf(ines, 'Birch', `${year}-10-19T09:00:00Z`, 'My first ever!');
addLeaf(benji, 'Norway maple', `${year}-10-30T14:20:00Z`, '');
addLeaf(theo, 'Oak', `${year}-11-02T13:05:00Z`, '');
addLeaf(benji, 'Beech', `${year}-11-09T08:30:00Z`, 'Caught it with my hat');
befriend(mila, juno);
befriend(benji, oscar);
befriend(theo, mila);

// ---- helpers mirroring the server ----
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const lower = (s) => String(s || '').toLowerCase();

function seasonAt(date) { return S.seasons.find((s) => s.starts_at <= date && s.ends_at > date) || null; }
function currentOrLastSeason() {
  const now = new Date();
  return seasonAt(now) || [...S.seasons].filter((s) => s.starts_at <= now).sort((a, b) => b.starts_at - a.starts_at)[0] || null;
}
function friendIds(id) {
  return S.friendships.filter((f) => f.status === 'accepted' && (f.requester_id === id || f.addressee_id === id))
    .map((f) => (f.requester_id === id ? f.addressee_id : f.requester_id));
}
const circleOf = (id) => new Set([id, ...friendIds(id)]);
const publicUser = (u, circle) => ({
  id: u.id, username: u.username, alias: u.alias || null, is_private: u.is_private,
  avatar: u.is_private && !circle?.has(u.id) ? null : u.avatar,
});
const selfUser = (u) => ({ ...publicUser(u, new Set([u.id])), email: u.email, has_password: Boolean(u.password) });
function relation(meId, otherId) {
  if (meId === otherId) return 'self';
  const f = S.friendships.find((x) => (x.requester_id === meId && x.addressee_id === otherId) || (x.requester_id === otherId && x.addressee_id === meId));
  if (!f) return 'none';
  if (f.status === 'accepted') return 'friends';
  return f.requester_id === meId ? 'requested' : 'incoming';
}
const userByName = (name) => S.users.find((u) => lower(u.username) === lower(name)) || fail(404, 'No such player');
function stats(rows) {
  const by = new Map();
  for (const l of rows) {
    const r = by.get(l.user_id) || { user_id: l.user_id, first_at: l.caught_at, last_at: l.caught_at, leaves: 0 };
    if (l.caught_at < r.first_at) r.first_at = l.caught_at;
    if (l.caught_at > r.last_at) r.last_at = l.caught_at;
    r.leaves += 1;
    by.set(l.user_id, r);
  }
  return [...by.values()];
}
const groupFor = (id, userId) => S.groups.find((g) => g.id === id && g.members.includes(userId)) || fail(404, 'No such group');
function leaveGroup(g, userId) {
  g.members = g.members.filter((m) => m !== userId);
  if (g.owner_id !== userId) return;
  if (g.members.length) g.owner_id = g.members[0];
  else S.groups = S.groups.filter((x) => x !== g);
}
const readFile = (blob) => (blob instanceof Blob ? URL.createObjectURL(blob) : null);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- routes ----
export async function mockApi(path, { method = 'GET', json, form, token } = {}) {
  await wait(120); // feel like a network
  const url = new URL(path, 'http://demo');
  const p = url.pathname;
  const body = json || {};
  const me = S.users.find((u) => u.id === S.sessions.get(token)) || null;
  const need = () => me || fail(401, 'Please log in');
  const seg = p.split('/').filter(Boolean);

  if (p === '/auth/signup' && method === 'POST') {
    const { username, alias, email, password } = body;
    if (!/^[a-z0-9_.]{3,24}$/i.test(username || '')) fail(400, 'Username: 3 to 24 letters, numbers, dots or underscores');
    if (S.users.some((u) => lower(u.username) === lower(username))) fail(409, 'That username is taken');
    if (Boolean(email) !== Boolean(password)) fail(400, 'Set both an email and a password, or neither');
    if (password && password.length < 8) fail(400, 'Password needs at least 8 characters');
    const u = addUser(username, (alias || '').trim() || null);
    if (email) { u.email = email; u.password = password; }
    // so there's something to accept in the preview
    befriend(benji, u, 'pending');
    const t = uid(); S.sessions.set(t, u.id);
    return { token: t, user: selfUser(u) };
  }
  if (p === '/auth/login' && method === 'POST') {
    const u = S.users.find((x) => lower(x.username) === lower(body.login) || (x.email && lower(x.email) === lower(body.login)));
    if (u && !u.password) fail(401, 'This account has no password, so it only works on the phone that created it');
    if (!u || u.password !== body.password) fail(401, 'Wrong username, email or password');
    const t = uid(); S.sessions.set(t, u.id);
    return { token: t, user: selfUser(u) };
  }
  if (p === '/auth/forgot') return { ok: true };
  if (p === '/auth/reset') fail(400, 'Reset links are emailed in the real app. The preview has no email.');
  if (p === '/auth/logout') { S.sessions.delete(token); return { ok: true }; }

  const u = need();
  if (p === '/me' && method === 'GET') return { user: selfUser(u) };
  if (p === '/me' && method === 'PATCH') {
    if (body.alias !== undefined) u.alias = String(body.alias).trim() || null;
    if (body.is_private !== undefined) u.is_private = Boolean(body.is_private);
    return { user: selfUser(u) };
  }
  if (p === '/me' && method === 'DELETE') {
    if (u.password && body.current_password !== u.password) fail(401, 'Current password is wrong');
    S.groups.filter((g) => g.members.includes(u.id)).forEach((g) => leaveGroup(g, u.id));
    S.users = S.users.filter((x) => x !== u);
    S.leaves = S.leaves.filter((l) => l.user_id !== u.id);
    S.friendships = S.friendships.filter((f) => f.requester_id !== u.id && f.addressee_id !== u.id);
    return { ok: true };
  }
  if (p === '/me/avatar') { u.avatar = readFile(form.get('avatar')); return { avatar: u.avatar }; }
  if (p === '/me/credentials') {
    if (u.password && body.current_password !== u.password) fail(401, 'Current password is wrong');
    const email = String(body.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "That email doesn't look right");
    if (!u.password && !body.new_password) fail(400, 'Set both an email and a password');
    if (body.new_password && body.new_password.length < 8) fail(400, 'Password needs at least 8 characters');
    u.email = email; if (body.new_password) u.password = body.new_password;
    return { user: selfUser(u) };
  }

  if (p === '/users') {
    const term = lower(url.searchParams.get('q')).trim();
    if (term.length < 2) return { users: [] };
    const c = circleOf(u.id);
    return { users: S.users.filter((x) => lower(x.username).includes(term) || lower(x.alias).includes(term)).map((x) => publicUser(x, c)) };
  }
  if (seg[0] === 'users' && seg.length === 2) {
    const other = userByName(decodeURIComponent(seg[1]));
    const rel = relation(u.id, other.id);
    const season = currentOrLastSeason();
    const leaves = S.leaves.filter((l) => l.user_id === other.id).sort((a, b) => (a.caught_at < b.caught_at ? 1 : -1));
    return {
      user: publicUser(other, new Set([u.id, ...(rel === 'friends' ? [other.id] : [])])), relation: rel,
      stats: { leaves_total: leaves.length, leaves_this_season: leaves.filter((l) => l.season_id === season?.id).length, friends: friendIds(other.id).length },
      leaves,
    };
  }
  if (seg[0] === 'users' && seg[2] === 'friends') {
    const other = userByName(decodeURIComponent(seg[1]));
    const ids = new Set(friendIds(other.id));
    const c = circleOf(u.id);
    return { friends: S.users.filter((x) => ids.has(x.id)).map((x) => publicUser(x, c)) };
  }
  if (p === '/friends/requests') {
    const pend = S.friendships.filter((f) => f.status === 'pending' && (f.requester_id === u.id || f.addressee_id === u.id));
    const find = (id) => publicUser(S.users.find((x) => x.id === id));
    return {
      incoming: pend.filter((f) => f.addressee_id === u.id).map((f) => find(f.requester_id)).filter((x) => x.id),
      outgoing: pend.filter((f) => f.requester_id === u.id).map((f) => find(f.addressee_id)).filter((x) => x.id),
    };
  }
  if (seg[0] === 'friends' && seg[1]) {
    const other = userByName(decodeURIComponent(seg[1]));
    const rel = relation(u.id, other.id);
    if (method === 'POST') {
      if (rel === 'self') fail(400, "You can't befriend yourself");
      if (rel === 'incoming') { S.friendships.find((f) => f.requester_id === other.id && f.addressee_id === u.id).status = 'accepted'; return { relation: 'friends' }; }
      if (rel === 'none') befriend(u, other, 'pending');
      return { relation: rel === 'none' ? 'requested' : rel };
    }
    S.friendships = S.friendships.filter((f) => !((f.requester_id === u.id && f.addressee_id === other.id) || (f.requester_id === other.id && f.addressee_id === u.id)));
    S.groups.forEach((g) => {
      if (g.owner_id === u.id) g.members = g.members.filter((m) => m !== other.id);
      if (g.owner_id === other.id) g.members = g.members.filter((m) => m !== u.id);
    });
    return { relation: 'none' };
  }

  if (p === '/groups' && method === 'GET') {
    return { groups: S.groups.filter((g) => g.members.includes(u.id)).map((g) => ({ id: g.id, name: g.name, size: g.members.length, is_owner: g.owner_id === u.id })) };
  }
  if (p === '/groups' && method === 'POST') {
    const name = String(body.name || '').trim();
    if (!name) fail(400, 'Give the group a name');
    const friends = new Set(friendIds(u.id));
    const g = { id: uid(), name, owner_id: u.id, members: [...new Set([u.id, ...(body.member_ids || []).filter((id) => friends.has(id))])] };
    S.groups.push(g);
    return { id: g.id, name };
  }
  if (seg[0] === 'groups' && seg[1]) {
    const g = groupFor(seg[1], u.id);
    if (seg[2] === 'leave') { leaveGroup(g, u.id); return { ok: true }; }
    if (method === 'GET') {
      const c = circleOf(u.id);
      return { id: g.id, name: g.name, is_owner: g.owner_id === u.id, members: S.users.filter((x) => g.members.includes(x.id)).map((x) => publicUser(x, c)) };
    }
    if (g.owner_id !== u.id) fail(403, 'Only the group owner can change it');
    if (method === 'DELETE') { S.groups = S.groups.filter((x) => x !== g); return { ok: true }; }
    const allowed = new Set([...friendIds(u.id), ...g.members]);
    g.name = String(body.name || g.name).trim();
    g.members = [...new Set([u.id, ...(body.member_ids || []).filter((id) => allowed.has(id))])];
    return { ok: true };
  }

  if (seg[0] === 'leaderboards') {
    const board = seg[1];
    const scope = url.searchParams.get('scope') || 'all';
    let keep = null;
    if (scope === 'friends') keep = circleOf(u.id);
    else if (scope !== 'all') keep = new Set(groupFor(scope, u.id).members);
    let ranked; let season = null;
    if (board === 'alltime') {
      const bySeason = new Map();
      for (const s of S.seasons) bySeason.set(s.id, stats(S.leaves.filter((l) => l.season_id === s.id)));
      ranked = allTimeScores(bySeason);
    } else {
      season = currentOrLastSeason();
      const rows = stats(S.leaves.filter((l) => l.season_id === season?.id));
      ranked = board === 'season' ? rankFirstCatch(rows) : rankWealth(rows);
    }
    const c = circleOf(u.id);
    const entries = withPlaces(ranked, keep).map((e) => ({ ...e, user: publicUser(S.users.find((x) => x.id === e.user_id), c), is_me: e.user_id === u.id }))
      .filter((e) => e.user.id);
    return { season, entries };
  }

  if (p === '/identify') {
    await wait(700);
    return {
      available: true, demo: true,
      suggestions: [
        { name: 'Field maple', scientific: 'Acer campestre', score: 0.64 },
        { name: 'Sycamore', scientific: 'Acer pseudoplatanus', score: 0.19 },
        { name: 'Norway maple', scientific: 'Acer platanoides', score: 0.07 },
      ],
    };
  }
  if (p === '/leaves' && method === 'POST') {
    const tree = String(form.get('tree_name') || '').trim();
    if (!tree) fail(400, 'Which tree is it from? Type "Unknown" if you are not sure.');
    const now = new Date();
    const t = form.get('caught_at') ? new Date(form.get('caught_at')) : null;
    const ok = t && !Number.isNaN(t.getTime()) && t <= new Date(now.getTime() + 600_000);
    const caught = ok ? t : now;
    const season = seasonAt(caught);
    const leaf = {
      id: uid(), user_id: u.id, season_id: season?.id ?? null, caught_at: caught.toISOString(), caught_at_source: ok ? 'photo' : 'upload',
      photo: readFile(form.get('photo')), cutout: readFile(form.get('cutout')), colour: form.get('colour') || '#617257',
      tree_name: tree, tree_scientific: form.get('tree_scientific') || null, tree_confidence: Number(form.get('tree_confidence')) || null,
      tree_source: form.get('tree_source') === 'auto' ? 'auto' : 'user', caption: String(form.get('caption') || ''),
    };
    S.leaves.push(leaf);
    return { leaf, counted: Boolean(season) };
  }
  if (seg[0] === 'leaves' && seg[1]) {
    const leaf = S.leaves.find((l) => l.id === seg[1] && l.user_id === u.id) || fail(404, 'No such leaf');
    if (method === 'DELETE') { S.leaves = S.leaves.filter((l) => l !== leaf); return { ok: true }; }
    if (body.tree_name) { leaf.tree_name = String(body.tree_name).trim(); leaf.tree_source = 'user'; }
    if (body.caption !== undefined) leaf.caption = String(body.caption);
    return { leaf };
  }
  fail(404, 'Not found');
}

export { HttpError };
