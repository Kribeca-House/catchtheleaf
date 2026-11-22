import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { q, seasonAt, currentOrLastSeason, ensureCurrentSeason } from './db.js';
import * as auth from './auth.js';
import * as storage from './storage.js';
import { rankFirstCatch, rankWealth, allTimeScores, withPlaces } from './scoring.js';
import { identifyLeaf } from './identify.js';

const USERNAME_RE = /^[a-z0-9_.]{3,24}$/i;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// ---------- helpers ----------

function sniffImage(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { type: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { type: 'image/png', ext: 'png' };
  if (bytes.slice(8, 12).toString() === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

async function saveImage(file, folder) {
  if (!file || typeof file === 'string') fail(400, 'Missing image');
  if (file.size > MAX_IMAGE_BYTES) fail(413, 'Image is too big (6 MB max)');
  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) fail(415, 'Only JPEG, PNG or WebP images');
  const key = `${folder}/${randomUUID()}.${kind.ext}`;
  await storage.put(key, bytes, kind.type);
  return key;
}

const publicUser = (u) => ({
  id: u.id, username: u.username, alias: u.alias || null,
  avatar: storage.url(u.avatar_key), is_private: u.is_private,
});

const publicLeaf = (l) => ({
  id: l.id, user_id: l.user_id, season_id: l.season_id, caught_at: l.caught_at,
  photo: storage.url(l.photo_key), cutout: storage.url(l.cutout_key), colour: l.colour,
  tree_name: l.tree_name, tree_scientific: l.tree_scientific, tree_confidence: l.tree_confidence,
  tree_source: l.tree_source, caption: l.caption,
});

async function friendIds(userId) {
  const { rows } = await q(
    `select case when requester_id = $1 then addressee_id else requester_id end as id
       from friendships where status = 'accepted' and (requester_id = $1 or addressee_id = $1)`,
    [userId],
  );
  return rows.map((r) => r.id);
}

async function relation(meId, otherId) {
  if (meId === otherId) return 'self';
  const { rows } = await q(
    `select * from friendships where (requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1)`,
    [meId, otherId],
  );
  const f = rows[0];
  if (!f) return 'none';
  if (f.status === 'accepted') return 'friends';
  return f.requester_id === meId ? 'requested' : 'incoming';
}

async function userByName(username) {
  const { rows } = await q('select * from users where lower(username) = lower($1)', [username]);
  return rows[0] || fail(404, 'No such player');
}

// Private profiles still appear on leaderboards, but only friends see their leaves and friends list.
const canSeeDetails = (rel, user) => !user.is_private || rel === 'self' || rel === 'friends';

async function seasonStats(seasonId, userIds) {
  const { rows } = await q(
    `select user_id, min(caught_at) as first_at, max(caught_at) as last_at, count(*)::int as leaves
       from leaves where season_id = $1 ${userIds ? 'and user_id = any($2)' : ''} group by user_id`,
    userIds ? [seasonId, userIds] : [seasonId],
  );
  return rows;
}

// ---------- app ----------

export function createApp() {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  // Attach the signed-in user, if any.
  app.use('/api/*', async (c, next) => {
    const header = c.req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    c.set('token', token);
    c.set('me', await auth.userFromToken(token));
    await next();
  });
  const me = (c) => c.get('me') || fail(401, 'Please log in');

  app.get('/api/health', (c) => c.json({ ok: true }));

  // ----- accounts -----

  app.post('/api/auth/signup', async (c) => {
    const { username, password, alias } = await c.req.json();
    if (!USERNAME_RE.test(username || '')) fail(400, 'Username: 3 to 24 letters, numbers, dots or underscores');
    if (!password || password.length < 8) fail(400, 'Password needs at least 8 characters');
    const taken = await q('select 1 from users where lower(username) = lower($1)', [username]);
    if (taken.rows.length) fail(409, 'That username is taken');
    const recovery = auth.newRecoveryCode();
    const id = randomUUID();
    await q(
      'insert into users (id, username, alias, password_hash, recovery_hash) values ($1, $2, $3, $4, $5)',
      [id, username, (alias || '').trim().slice(0, 40) || null, await auth.hashSecret(password),
        await auth.hashSecret(auth.normaliseRecovery(recovery))],
    );
    const token = await auth.createSession(id);
    const { rows } = await q('select * from users where id = $1', [id]);
    return c.json({ token, user: publicUser(rows[0]), recovery_code: recovery }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const { username, password } = await c.req.json();
    const key = `login:${String(username).toLowerCase()}`;
    if (auth.tooManyFailures(key)) fail(429, 'Too many tries. Wait 15 minutes.');
    const { rows } = await q('select * from users where lower(username) = lower($1)', [username || '']);
    const u = rows[0];
    if (!u || !(await auth.verifySecret(password || '', u.password_hash))) {
      auth.noteFailure(key);
      fail(401, 'Wrong username or password');
    }
    auth.clearFailures(key);
    return c.json({ token: await auth.createSession(u.id), user: publicUser(u) });
  });

  // Forgotten password: username + recovery code sets a new password and issues a new code.
  app.post('/api/auth/recover', async (c) => {
    const { username, recovery_code, new_password } = await c.req.json();
    const key = `recover:${String(username).toLowerCase()}`;
    if (auth.tooManyFailures(key)) fail(429, 'Too many tries. Wait 15 minutes.');
    if (!new_password || new_password.length < 8) fail(400, 'Password needs at least 8 characters');
    const { rows } = await q('select * from users where lower(username) = lower($1)', [username || '']);
    const u = rows[0];
    if (!u || !(await auth.verifySecret(auth.normaliseRecovery(recovery_code), u.recovery_hash))) {
      auth.noteFailure(key);
      fail(401, 'That recovery code does not match');
    }
    auth.clearFailures(key);
    const recovery = auth.newRecoveryCode();
    await q('update users set password_hash = $2, recovery_hash = $3 where id = $1',
      [u.id, await auth.hashSecret(new_password), await auth.hashSecret(auth.normaliseRecovery(recovery))]);
    await auth.dropAllSessions(u.id);
    return c.json({ token: await auth.createSession(u.id), user: publicUser(u), recovery_code: recovery });
  });

  app.post('/api/auth/logout', async (c) => {
    if (c.get('token')) await auth.dropSession(c.get('token'));
    return c.json({ ok: true });
  });

  app.get('/api/me', (c) => c.json({ user: publicUser(me(c)) }));

  app.patch('/api/me', async (c) => {
    const u = me(c);
    const body = await c.req.json();
    const alias = body.alias === undefined ? u.alias : (String(body.alias).trim().slice(0, 40) || null);
    const isPrivate = body.is_private === undefined ? u.is_private : Boolean(body.is_private);
    const { rows } = await q('update users set alias = $2, is_private = $3 where id = $1 returning *', [u.id, alias, isPrivate]);
    return c.json({ user: publicUser(rows[0]) });
  });

  app.post('/api/me/avatar', async (c) => {
    const u = me(c);
    const body = await c.req.parseBody();
    const key = await saveImage(body.avatar, 'avatars');
    await q('update users set avatar_key = $2 where id = $1', [u.id, key]);
    await storage.removeObject(u.avatar_key);
    return c.json({ avatar: storage.url(key) });
  });

  app.post('/api/me/password', async (c) => {
    const u = me(c);
    const { current_password, new_password } = await c.req.json();
    if (!(await auth.verifySecret(current_password || '', u.password_hash))) fail(401, 'Current password is wrong');
    if (!new_password || new_password.length < 8) fail(400, 'Password needs at least 8 characters');
    await q('update users set password_hash = $2 where id = $1', [u.id, await auth.hashSecret(new_password)]);
    return c.json({ ok: true });
  });

  app.post('/api/me/recovery-code', async (c) => {
    const u = me(c);
    const { current_password } = await c.req.json();
    if (!(await auth.verifySecret(current_password || '', u.password_hash))) fail(401, 'Current password is wrong');
    const recovery = auth.newRecoveryCode();
    await q('update users set recovery_hash = $2 where id = $1', [u.id, await auth.hashSecret(auth.normaliseRecovery(recovery))]);
    return c.json({ recovery_code: recovery });
  });

  app.delete('/api/me', async (c) => {
    const u = me(c);
    const { current_password } = await c.req.json();
    if (!(await auth.verifySecret(current_password || '', u.password_hash))) fail(401, 'Current password is wrong');
    const { rows } = await q('select photo_key, cutout_key from leaves where user_id = $1', [u.id]);
    await q('delete from users where id = $1', [u.id]);
    await Promise.all([u.avatar_key, ...rows.flatMap((r) => [r.photo_key, r.cutout_key])].map(storage.removeObject));
    return c.json({ ok: true });
  });

  // ----- players & friends -----

  app.get('/api/users', async (c) => {
    me(c);
    const term = (c.req.query('q') || '').trim();
    if (term.length < 2) return c.json({ users: [] });
    const like = `%${term.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    const { rows } = await q(
      `select * from users where username ilike $1 or alias ilike $1 order by lower(username) limit 25`, [like]);
    return c.json({ users: rows.map(publicUser) });
  });

  app.get('/api/users/:username', async (c) => {
    const viewer = me(c);
    const u = await userByName(c.req.param('username'));
    const rel = await relation(viewer.id, u.id);
    const visible = canSeeDetails(rel, u);
    const season = await currentOrLastSeason();
    const [{ rows: [counts] }, friends, leaves] = await Promise.all([
      q(`select count(*)::int as total, count(*) filter (where season_id = $2)::int as this_season
           from leaves where user_id = $1`, [u.id, season?.id ?? null]),
      friendIds(u.id),
      visible ? q('select * from leaves where user_id = $1 order by caught_at desc', [u.id]) : { rows: [] },
    ]);
    return c.json({
      user: publicUser(u), relation: rel, visible,
      stats: { leaves_total: counts.total, leaves_this_season: counts.this_season, friends: friends.length },
      leaves: leaves.rows.map(publicLeaf),
    });
  });

  app.get('/api/users/:username/friends', async (c) => {
    const viewer = me(c);
    const u = await userByName(c.req.param('username'));
    const rel = await relation(viewer.id, u.id);
    if (!canSeeDetails(rel, u)) return c.json({ friends: [], visible: false });
    const ids = await friendIds(u.id);
    const { rows } = await q('select * from users where id = any($1) order by lower(username)', [ids]);
    return c.json({ friends: rows.map(publicUser), visible: true });
  });

  app.get('/api/friends/requests', async (c) => {
    const u = me(c);
    const { rows } = await q(
      `select u.*, f.requester_id = $1 as outgoing from friendships f
         join users u on u.id = case when f.requester_id = $1 then f.addressee_id else f.requester_id end
        where f.status = 'pending' and (f.requester_id = $1 or f.addressee_id = $1) order by f.created_at desc`,
      [u.id]);
    return c.json({
      incoming: rows.filter((r) => !r.outgoing).map(publicUser),
      outgoing: rows.filter((r) => r.outgoing).map(publicUser),
    });
  });

  // Send a request, or accept one if they already asked you.
  app.post('/api/friends/:username', async (c) => {
    const u = me(c);
    const other = await userByName(c.req.param('username'));
    const rel = await relation(u.id, other.id);
    if (rel === 'self') fail(400, "You can't befriend yourself (but we appreciate the self-love)");
    if (rel === 'incoming') {
      await q(`update friendships set status = 'accepted' where requester_id = $2 and addressee_id = $1`, [u.id, other.id]);
      return c.json({ relation: 'friends' });
    }
    if (rel === 'none') await q('insert into friendships (requester_id, addressee_id) values ($1, $2)', [u.id, other.id]);
    return c.json({ relation: rel === 'none' ? 'requested' : rel });
  });

  // Unfriend, cancel a request, or decline one. Also removes them from groups you own.
  app.delete('/api/friends/:username', async (c) => {
    const u = me(c);
    const other = await userByName(c.req.param('username'));
    await q(`delete from friendships where (requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1)`,
      [u.id, other.id]);
    await q(`delete from group_members gm using groups g where gm.group_id = g.id and
             ((g.owner_id = $1 and gm.user_id = $2) or (g.owner_id = $2 and gm.user_id = $1))`, [u.id, other.id]);
    return c.json({ relation: 'none' });
  });

  // ----- groups (a saved filter of friends for the leaderboards) -----

  async function groupForMember(groupId, userId) {
    const { rows } = await q(
      `select g.* from groups g join group_members m on m.group_id = g.id where g.id = $1 and m.user_id = $2`,
      [groupId, userId]);
    return rows[0] || fail(404, 'No such group');
  }

  async function groupMembers(groupId) {
    const { rows } = await q(
      `select u.* from group_members m join users u on u.id = m.user_id where m.group_id = $1 order by lower(u.username)`, [groupId]);
    return rows;
  }

  app.get('/api/groups', async (c) => {
    const u = me(c);
    const { rows } = await q(
      `select g.*, (select count(*)::int from group_members where group_id = g.id) as size
         from groups g join group_members m on m.group_id = g.id where m.user_id = $1 order by g.created_at`, [u.id]);
    return c.json({ groups: rows.map((g) => ({ id: g.id, name: g.name, size: g.size, is_owner: g.owner_id === u.id })) });
  });

  app.get('/api/groups/:id', async (c) => {
    const u = me(c);
    const g = await groupForMember(c.req.param('id'), u.id);
    return c.json({ id: g.id, name: g.name, is_owner: g.owner_id === u.id, members: (await groupMembers(g.id)).map(publicUser) });
  });

  // Owner picks members from their friends. GUESS: only the owner edits, members can leave.
  async function validMemberIds(ownerId, ids) {
    const friends = new Set(await friendIds(ownerId));
    return [...new Set([ownerId, ...(ids || []).filter((id) => friends.has(id))])];
  }

  app.post('/api/groups', async (c) => {
    const u = me(c);
    const { name, member_ids } = await c.req.json();
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) fail(400, 'Give the group a name');
    const id = randomUUID();
    await q('insert into groups (id, name, owner_id) values ($1, $2, $3)', [id, clean, u.id]);
    for (const uid of await validMemberIds(u.id, member_ids)) {
      await q('insert into group_members (group_id, user_id) values ($1, $2)', [id, uid]);
    }
    return c.json({ id, name: clean }, 201);
  });

  app.put('/api/groups/:id', async (c) => {
    const u = me(c);
    const g = await groupForMember(c.req.param('id'), u.id);
    if (g.owner_id !== u.id) fail(403, 'Only the group owner can edit it');
    const { name, member_ids } = await c.req.json();
    const clean = String(name || g.name).trim().slice(0, 40);
    await q('update groups set name = $2 where id = $1', [g.id, clean]);
    await q('delete from group_members where group_id = $1', [g.id]);
    for (const uid of await validMemberIds(u.id, member_ids)) {
      await q('insert into group_members (group_id, user_id) values ($1, $2)', [g.id, uid]);
    }
    return c.json({ ok: true });
  });

  // Owner deletes the group; anyone else leaves it.
  app.delete('/api/groups/:id', async (c) => {
    const u = me(c);
    const g = await groupForMember(c.req.param('id'), u.id);
    if (g.owner_id === u.id) await q('delete from groups where id = $1', [g.id]);
    else await q('delete from group_members where group_id = $1 and user_id = $2', [g.id, u.id]);
    return c.json({ ok: true });
  });

  // ----- leaderboards -----

  app.get('/api/seasons', async (c) => {
    me(c);
    await ensureCurrentSeason();
    const { rows } = await q('select * from seasons order by starts_at desc');
    const current = await currentOrLastSeason();
    return c.json({ seasons: rows, current_id: current?.id ?? null });
  });

  // board: season | wealth | alltime;  scope: all | friends | <group id>
  app.get('/api/leaderboards/:board', async (c) => {
    const u = me(c);
    const board = c.req.param('board');
    const scope = c.req.query('scope') || 'all';
    let keep = null;
    if (scope === 'friends') keep = new Set([u.id, ...(await friendIds(u.id))]);
    else if (scope !== 'all') keep = new Set((await groupMembers((await groupForMember(scope, u.id)).id)).map((m) => m.id));

    let ranked;
    let season = null;
    if (board === 'alltime') {
      const { rows } = await q(
        `select season_id, user_id, min(caught_at) as first_at, max(caught_at) as last_at, count(*)::int as leaves
           from leaves where season_id is not null group by season_id, user_id`);
      const bySeason = new Map();
      for (const r of rows) bySeason.set(r.season_id, [...(bySeason.get(r.season_id) || []), r]);
      ranked = allTimeScores(bySeason);
    } else if (board === 'season' || board === 'wealth') {
      season = c.req.query('season')
        ? (await q('select * from seasons where id = $1', [Number(c.req.query('season'))])).rows[0]
        : await currentOrLastSeason();
      if (!season) return c.json({ entries: [], season: null });
      const rows = await seasonStats(season.id);
      ranked = board === 'season' ? rankFirstCatch(rows) : rankWealth(rows);
    } else fail(404, 'Unknown board');

    const entries = withPlaces(ranked, keep);
    const ids = entries.map((e) => e.user_id);
    const { rows: users } = await q('select * from users where id = any($1)', [ids]);
    const byId = new Map(users.map((x) => [x.id, publicUser(x)]));
    return c.json({
      season,
      entries: entries.map((e) => ({ ...e, user: byId.get(e.user_id), is_me: e.user_id === u.id })),
    });
  });

  // ----- leaves -----

  app.post('/api/identify', async (c) => {
    me(c);
    const body = await c.req.parseBody();
    if (!body.photo || typeof body.photo === 'string') fail(400, 'Missing photo');
    if (body.photo.size > MAX_IMAGE_BYTES) fail(413, 'Image is too big');
    return c.json(await identifyLeaf(body.photo));
  });

  app.post('/api/leaves', async (c) => {
    const u = me(c);
    const body = await c.req.parseBody();
    const treeName = String(body.tree_name || '').trim().slice(0, 60);
    if (!treeName) fail(400, 'Which tree is it from? Type "Unknown" if you are not sure.');
    const colour = /^#[0-9a-f]{6}$/i.test(body.colour || '') ? body.colour : '#617257';
    // The catch time is the server's clock at upload, so nobody can backdate a catch (see ARCHITECTURE.md).
    const now = new Date();
    await ensureCurrentSeason(now);
    const season = await seasonAt(now);
    const photoKey = await saveImage(body.photo, `leaves/${u.id}`);
    const cutoutKey = await saveImage(body.cutout, `leaves/${u.id}`);
    const id = randomUUID();
    const conf = Number(body.tree_confidence);
    const { rows } = await q(
      `insert into leaves (id, user_id, season_id, caught_at, photo_key, cutout_key, colour, tree_name, tree_scientific,
                           tree_confidence, tree_source, caption)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [id, u.id, season?.id ?? null, now, photoKey, cutoutKey, colour, treeName,
        String(body.tree_scientific || '').slice(0, 80) || null, Number.isFinite(conf) ? conf : null,
        body.tree_source === 'auto' ? 'auto' : 'user', String(body.caption || '').slice(0, 280)],
    );
    return c.json({ leaf: publicLeaf(rows[0]), counted: Boolean(season) }, 201);
  });

  app.patch('/api/leaves/:id', async (c) => {
    const u = me(c);
    const { tree_name, caption } = await c.req.json();
    const { rows } = await q(
      `update leaves set tree_name = coalesce(nullif(trim($3), ''), tree_name),
                         tree_source = case when $3::text is null then tree_source else 'user' end,
                         caption = coalesce($4, caption)
        where id = $1 and user_id = $2 returning *`,
      [c.req.param('id'), u.id, tree_name == null ? null : String(tree_name).slice(0, 60),
        caption == null ? null : String(caption).slice(0, 280)]);
    return c.json({ leaf: publicLeaf(rows[0] || fail(404, 'No such leaf')) });
  });

  app.delete('/api/leaves/:id', async (c) => {
    const u = me(c);
    const { rows } = await q('delete from leaves where id = $1 and user_id = $2 returning *', [c.req.param('id'), u.id]);
    const l = rows[0] || fail(404, 'No such leaf');
    await Promise.all([storage.removeObject(l.photo_key), storage.removeObject(l.cutout_key)]);
    return c.json({ ok: true });
  });

  // Local development only: media served from disk. In production the bucket serves images.
  app.get('/media/*', async (c) => {
    const key = decodeURIComponent(c.req.path.slice('/media/'.length));
    const bytes = await storage.readLocal(key);
    if (!bytes) return c.notFound();
    const kind = sniffImage(bytes);
    return c.body(bytes, 200, { 'content-type': kind?.type || 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' });
  });

  return app;
}
