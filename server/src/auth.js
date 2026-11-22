import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { q } from './db.js';

const scryptAsync = promisify(scrypt);
const SESSION_DAYS = 90;
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

// The recovery code replaces "forgot password" emails. It is shown once at sign-up,
// looks like LEAF-7K3Q-9XWD-2HPA, and is stored only as a hash.
export function newRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = [...randomBytes(12)].map((b) => alphabet[b % alphabet.length]).join('');
  return `LEAF-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
export const normaliseRecovery = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  await q(
    `insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))`,
    [sha(token), userId, SESSION_DAYS],
  );
  return token;
}

export const dropSession = (token) => q('delete from sessions where token_hash = $1', [sha(token)]);
export const dropAllSessions = (userId) => q('delete from sessions where user_id = $1', [userId]);

export async function userFromToken(token) {
  if (!token) return null;
  const { rows } = await q(
    'select u.* from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()',
    [sha(token)],
  );
  return rows[0] || null;
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
