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

async function signup(username) {
  const r = await call('POST', '/api/auth/signup', { json: { username, password: 'autumnwind', alias: username.toUpperCase() } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

function leafForm(tree = 'Oak') {
  const f = new FormData();
  f.append('photo', new Blob([PNG], { type: 'image/png' }), 'p.png');
  f.append('cutout', new Blob([PNG], { type: 'image/png' }), 'c.png');
  f.append('tree_name', tree);
  f.append('caption', 'caught by the pond');
  f.append('colour', '#927b21');
  return f;
}

before(async () => {
  await q('drop schema public cascade; create schema public;');
  await migrate();
  app = createApp();
});
after(() => pool.end());

test('scoring: placement counts double, leaves single', () => {
  const s1 = [
    { user_id: 'a', first_at: '2025-09-02', last_at: '2025-10-01', leaves: 3 },
    { user_id: 'b', first_at: '2025-09-01', last_at: '2025-09-05', leaves: 1 },
  ];
  const [top, second] = allTimeScores(new Map([[1, s1]]));
  assert.equal(top.user_id, 'b'); // 2 points x2 + 1 leaf = 5
  assert.equal(top.score, 5);
  assert.equal(second.score, 2 * 1 + 3);
  assert.equal(rankWealth(s1)[0].user_id, 'a');
});

test('full flow: sign up, catch leaves, friends, groups, boards, recovery', async () => {
  const ana = await signup('ana');
  const ben = await signup('ben');
  const cal = await signup('cal');
  assert.match(ana.recovery_code, /^LEAF-/);

  assert.equal((await call('POST', '/api/auth/signup', { json: { username: 'ANA', password: 'whateverxx' } })).status, 409);
  assert.equal((await call('POST', '/api/auth/login', { json: { username: 'ana', password: 'nope' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { json: { username: 'Ana', password: 'autumnwind' } })).status, 200);

  // ben catches first, ana catches two
  assert.equal((await call('POST', '/api/leaves', { token: ben.token, form: leafForm('Maple') })).status, 201);
  await call('POST', '/api/leaves', { token: ana.token, form: leafForm() });
  const up = await call('POST', '/api/leaves', { token: ana.token, form: leafForm() });
  assert.equal(up.status, 201);
  await call('POST', '/api/leaves', { token: cal.token, form: leafForm() });

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

  // private profile hides leaves from non-friends
  await call('PATCH', '/api/me', { token: ana.token, json: { is_private: true } });
  const asCal = await call('GET', '/api/users/ana', { token: cal.token });
  assert.equal(asCal.body.visible, false);
  assert.equal(asCal.body.leaves.length, 0);
  const asBen = await call('GET', '/api/users/ana', { token: ben.token });
  assert.equal(asBen.body.leaves.length, 2);
  assert.equal(asBen.body.relation, 'friends');

  // only the owner edits a leaf
  const leafId = up.body.leaf.id;
  assert.equal((await call('PATCH', `/api/leaves/${leafId}`, { token: ben.token, json: { caption: 'mine now' } })).status, 404);
  const edited = await call('PATCH', `/api/leaves/${leafId}`, { token: ana.token, json: { tree_name: 'English oak' } });
  assert.equal(edited.body.leaf.tree_name, 'English oak');
  assert.equal(edited.body.leaf.tree_source, 'user');

  // forgotten password via recovery code
  assert.equal((await call('POST', '/api/auth/recover', { json: { username: 'ana', recovery_code: 'LEAF-XXXX-XXXX-XXXX', new_password: 'newpassword' } })).status, 401);
  const rec = await call('POST', '/api/auth/recover', { json: { username: 'ana', recovery_code: ana.recovery_code.toLowerCase(), new_password: 'newpassword' } });
  assert.equal(rec.status, 200);
  assert.notEqual(rec.body.recovery_code, ana.recovery_code);
  assert.equal((await call('GET', '/api/me', { token: ana.token })).status, 401); // old sessions are logged out
  assert.equal((await call('POST', '/api/auth/login', { json: { username: 'ana', password: 'newpassword' } })).status, 200);

  // identification without an API key degrades gracefully
  const idf = new FormData();
  idf.append('photo', new Blob([PNG], { type: 'image/png' }), 'p.png');
  assert.deepEqual((await call('POST', '/api/identify', { token: ben.token, form: idf })).body, { available: false, suggestions: [] });

  // delete account cleans up
  assert.equal((await call('DELETE', '/api/me', { token: rec.body.token, json: { current_password: 'newpassword' } })).status, 200);
  assert.equal((await call('GET', '/api/users/ana', { token: ben.token })).status, 404);
});
