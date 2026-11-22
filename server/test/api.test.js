// Runs against a real Postgres: DATABASE_URL defaults to a local catchtheleaf_test database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@localhost:5432/catchtheleaf_test';
process.env.MEDIA_DIR = await mkdtemp(join(tmpdir(), 'ctl-media-'));
delete process.env.S3_BUCKET;
delete process.env.PLANTNET_API_KEY;

const { pool, q, migrate } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { allTimeScores, rankWealth } = await import('../src/scoring.js');

let app;
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
  '1f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex');

async function call(method, path, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let body;
  if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await app.request(path, { method, headers, body });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function signup(username, withCreds = true) {
  const json = { username, alias: username.toUpperCase() };
  if (withCreds) Object.assign(json, { email: `${username}@example.com`, password: 'autumnwind' });
  const r = await call('POST', '/api/auth/signup', { json });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

function leafForm(tree = 'Oak', caughtAt) {
  const f = new FormData();
  f.append('photo', new Blob([PNG], { type: 'image/png' }), 'p.png');
  f.append('cutout', new Blob([PNG], { type: 'image/png' }), 'c.png');
  f.append('tree_name', tree);
  f.append('caption', 'caught by the pond');
  f.append('colour', '#927b21');
  if (caughtAt) f.append('caught_at', caughtAt);
  return f;
}

before(async () => {
  await q('drop schema public cascade; create schema public;');
  await migrate();
  app = createApp();
});
after(() => pool.end());

test('scoring: season points = participants - place, counted double', () => {
  const s1 = [
    { user_id: 'a', first_at: '2025-09-02', last_at: '2025-10-01', leaves: 3 },
    { user_id: 'b', first_at: '2025-09-01', last_at: '2025-09-05', leaves: 1 },
  ];
  const [top, second] = allTimeScores(new Map([[1, s1]]));
  // 2 players: b is 1st, 2 - 1 = 1 point -> 2 x 1 + 1 leaf = 3; a is 2nd, 0 points -> 0 + 3 leaves = 3.
  // Tie goes to more season points.
  assert.deepEqual([top.user_id, top.score, second.user_id, second.score], ['b', 3, 'a', 3]);
  const thirty = Array.from({ length: 30 }, (_, i) => ({ user_id: `p${i}`, first_at: new Date(2025, 8, 1, 0, i).toISOString(), last_at: '2025-10-01', leaves: 0 }));
  const scores = allTimeScores(new Map([[1, thirty]]));
  assert.equal(scores.find((s) => s.user_id === 'p0').season_points, 29);
  assert.equal(scores.find((s) => s.user_id === 'p2').season_points, 27);
  assert.equal(rankWealth(s1)[0].user_id, 'a');
});

test('full flow: sign up, catch leaves, friends, groups, boards, recovery', async () => {
  const ana = await signup('ana');
  const ben = await signup('ben');
  const cal = await signup('cal', false); // username only: lives on this device
  assert.equal(cal.user.has_password, false);

  assert.equal((await call('POST', '/api/auth/signup', { json: { username: 'ANA' } })).status, 409);
  assert.equal((await call('POST', '/api/auth/signup', { json: { username: 'dee', email: 'dee@example.com' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/signup', { json: { username: 'dee', password: 'longenough' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/signup', { json: { username: 'dee', email: 'ANA@example.com', password: 'longenough' } })).status, 409);
  assert.equal((await call('POST', '/api/auth/login', { json: { login: 'ana', password: 'nope' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { json: { login: 'Ana', password: 'autumnwind' } })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { json: { login: 'ana@EXAMPLE.com', password: 'autumnwind' } })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { json: { login: 'cal', password: 'anything' } })).status, 401);

  // cal adds email + password later
  const credsRes = await call('PUT', '/api/me/credentials', { token: cal.token, json: { email: 'cal@example.com', new_password: 'calcalcal' } });
  assert.equal(credsRes.body.user.has_password, true);
  assert.equal((await call('POST', '/api/auth/login', { json: { login: 'cal', password: 'calcalcal' } })).status, 200);

  // ben's photo was taken first (photo time), even though he uploads after ana
  const early = new Date(Date.now() - 60 * 60_000).toISOString();
  await call('POST', '/api/leaves', { token: ana.token, form: leafForm() });
  const benLeaf = await call('POST', '/api/leaves', { token: ben.token, form: leafForm('Maple', early) });
  assert.equal(benLeaf.status, 201);
  assert.equal(benLeaf.body.leaf.caught_at_source, 'photo');
  assert.equal(new Date(benLeaf.body.leaf.caught_at).toISOString(), early);
  // a photo time in the future falls back to the upload time
  const future = await call('POST', '/api/leaves', { token: cal.token, form: leafForm('Oak', '2999-01-01T00:00:00Z') });
  assert.equal(future.body.leaf.caught_at_source, 'upload');
  const up = await call('POST', '/api/leaves', { token: ana.token, form: leafForm() });
  assert.equal(up.status, 201);

  // Uploading text pretending to be an image is refused
  const bad = new FormData();
  bad.append('photo', new Blob(['hello'], { type: 'image/png' }), 'x.png');
  bad.append('cutout', new Blob(['hello'], { type: 'image/png' }), 'x.png');
  bad.append('tree_name', 'Oak');
  assert.equal((await call('POST', '/api/leaves', { token: ana.token, form: bad })).status, 415);

  const season = await call('GET', '/api/leaderboards/season', { token: ana.token });
  // Outside 1 Sep - 30 Nov the leaves are kept but not counted
  if (up.body.counted) {
    assert.deepEqual(season.body.entries.map((e) => e.user.username), ['ben', 'ana', 'cal']);
    const wealth = await call('GET', '/api/leaderboards/wealth', { token: ana.token });
    assert.equal(wealth.body.entries[0].user.username, 'ana');
    assert.equal(wealth.body.entries[0].leaves, 2);
  }

  // friends: ana asks ben, ben accepts by asking back
  assert.equal((await call('POST', '/api/friends/ben', { token: ana.token })).body.relation, 'requested');
  assert.equal((await call('GET', '/api/friends/requests', { token: ben.token })).body.incoming[0].username, 'ana');
  assert.equal((await call('POST', '/api/friends/ana', { token: ben.token })).body.relation, 'friends');

  const friendsBoard = await call('GET', '/api/leaderboards/season?scope=friends', { token: ana.token });
  if (up.body.counted) assert.deepEqual(friendsBoard.body.entries.map((e) => [e.place, e.user.username]), [[1, 'ben'], [2, 'ana']]);

  // group with a non-friend is silently limited to friends
  const g = await call('POST', '/api/groups', { token: ana.token, json: { name: 'Park crew', member_ids: [ben.user.id, cal.user.id] } });
  const group = await call('GET', `/api/groups/${g.body.id}`, { token: ana.token });
  assert.deepEqual(group.body.members.map((m) => m.username).sort(), ['ana', 'ben']);
  assert.equal((await call('GET', `/api/leaderboards/alltime?scope=${g.body.id}`, { token: cal.token })).status, 404);
  assert.equal((await call('GET', `/api/leaderboards/alltime?scope=${g.body.id}`, { token: ben.token })).status, 200);

  // private profile hides the profile picture from non-friends, leaves stay visible
  const av = new FormData();
  av.append('avatar', new Blob([PNG], { type: 'image/png' }), 'a.png');
  await call('POST', '/api/me/avatar', { token: ana.token, form: av });
  await call('PATCH', '/api/me', { token: ana.token, json: { is_private: true } });
  const asCal = await call('GET', '/api/users/ana', { token: cal.token });
  assert.equal(asCal.body.user.avatar, null);
  assert.equal(asCal.body.leaves.length, 2);
  const calBoard = await call('GET', '/api/leaderboards/wealth', { token: cal.token });
  assert.equal(calBoard.body.entries.find((e) => e.user.username === 'ana').user.avatar, null);
  const asBen = await call('GET', '/api/users/ana', { token: ben.token });
  assert.ok(asBen.body.user.avatar);
  assert.equal(asBen.body.relation, 'friends');
  assert.ok((await call('GET', '/api/me', { token: ana.token })).body.user.avatar);

  // groups: anyone can leave; the owner leaving hands the group over
  await call('POST', `/api/groups/${g.body.id}/leave`, { token: ana.token });
  const handed = await call('GET', `/api/groups/${g.body.id}`, { token: ben.token });
  assert.equal(handed.body.is_owner, true);
  assert.deepEqual(handed.body.members.map((m) => m.username), ['ben']);
  await call('POST', `/api/groups/${g.body.id}/leave`, { token: ben.token });
  assert.equal((await call('GET', '/api/groups', { token: ben.token })).body.groups.length, 0);

  // only the owner edits a leaf
  const leafId = up.body.leaf.id;
  assert.equal((await call('PATCH', `/api/leaves/${leafId}`, { token: ben.token, json: { caption: 'mine now' } })).status, 404);
  const edited = await call('PATCH', `/api/leaves/${leafId}`, { token: ana.token, json: { tree_name: 'English oak' } });
  assert.equal(edited.body.leaf.tree_name, 'English oak');
  assert.equal(edited.body.leaf.tree_source, 'user');

  // forgotten password via an emailed link (mail isn't configured in tests, so grab the token directly)
  assert.equal((await call('POST', '/api/auth/forgot', { json: { email: 'nobody@example.com' } })).body.ok, true);
  const { createResetToken } = await import('../src/auth.js');
  const resetToken = await createResetToken(ana.user.id);
  assert.equal((await call('POST', '/api/auth/reset', { json: { token: 'bogus', new_password: 'newpassword' } })).status, 400);
  const rec = await call('POST', '/api/auth/reset', { json: { token: resetToken, new_password: 'newpassword' } });
  assert.equal(rec.status, 200);
  assert.equal((await call('POST', '/api/auth/reset', { json: { token: resetToken, new_password: 'again12345' } })).status, 400); // single use
  assert.equal((await call('GET', '/api/me', { token: ana.token })).status, 401); // other sessions are logged out
  assert.equal((await call('POST', '/api/auth/login', { json: { login: 'ana', password: 'newpassword' } })).status, 200);

  // identification without an API key degrades gracefully
  const idf = new FormData();
  idf.append('photo', new Blob([PNG], { type: 'image/png' }), 'p.png');
  assert.deepEqual((await call('POST', '/api/identify', { token: ben.token, form: idf })).body, { available: false, suggestions: [] });

  // delete account cleans up
  assert.equal((await call('DELETE', '/api/me', { token: rec.body.token, json: { current_password: 'newpassword' } })).status, 200);
  assert.equal((await call('GET', '/api/users/ana', { token: ben.token })).status, 404);
});
