import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { q } from './db.js';

const scryptAsync = promisify(scrypt);
// Long, sliding sessions: an account without email + password only exists on the device holding
// its session, so that session must not quietly expire while the person still plays.
const SESSION_DAYS = 400;
const PARAMS = { N: 16384, r: 8, p: 1 };

export async function hashSecret(secret) {
  const salt = randomBytes(16);
  const key = await scryptAsync(secret, salt, 64, PARAMS);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifySecret(secret, stored) {
  const [, saltB64, keyB64] = String(stored).split('$');
  if (!saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(secret, Buffer.from(saltB64, 'base64'), expected.length, PARAMS);
  return timingSafeEqual(key, expected);
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

// Password reset by email: a one-hour, single-use link.
export async function createResetToken(userId) {
  const token = randomBytes(32).toString('base64url');
  await q(`insert into password_resets (token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 hour')`, [sha(token), userId]);
  return token;
}
export async function useResetToken(token) {
  const { rows } = await q(
    `update password_resets set used = true where token_hash = $1 and not used and expires_at > now() returning user_id`,
    [sha(String(token || ''))]);
  return rows[0]?.user_id || null;
}

export async function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  await q(
    `insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))`,
    [sha(token), userId, SESSION_DAYS],
  );
  return token;
}

export const dropSession = (token) => q('delete from sessions where token_hash = $1', [sha(token)]);
export const dropOtherSessions = (userId, keepToken) =>
  q('delete from sessions where user_id = $1 and token_hash <> $2', [userId, sha(String(keepToken || ''))]);

export async function userFromToken(token) {
  if (!token) return null;
  const { rows } = await q(
    `select u.*, s.expires_at < now() + interval '300 days' as needs_refresh
       from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()`,
    [sha(token)],
  );
  const u = rows[0];
  if (u?.needs_refresh) {
    await q('update sessions set expires_at = now() + make_interval(days => $2) where token_hash = $1', [sha(token), SESSION_DAYS]);
  }
  return u || null;
}

// Per-instance throttle on failed logins and recoveries. Serverless instances don't share memory,
// so this slows guessing rather than stopping it outright (see docs/ARCHITECTURE.md).
const failures = new Map();
const WINDOW = 15 * 60_000;
export function tooManyFailures(key) {
  const f = failures.get(key);
  return Boolean(f && f.count >= 8 && Date.now() - f.first < WINDOW);
}
export function noteFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW) failures.set(key, { count: 1, first: Date.now() });
  else f.count += 1;
}
export const clearFailures = (key) => failures.delete(key);
