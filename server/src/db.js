import pg from 'pg';

// One pool per container instance. Scaleway Serverless SQL Database speaks plain Postgres,
// so DATABASE_URL is all we need. Keep the pool small: serverless instances are many and short-lived.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/catchtheleaf',
  max: Number(process.env.DB_POOL_MAX || 4),
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

export const q = (text, params) => pool.query(text, params);

const SCHEMA = `
create table if not exists users (
  id            uuid primary key,
  username      text not null,
  alias         text,
  email         text,          -- optional; set together with a password
  password_hash text,          -- optional; an account without one lives on the device that made it
  avatar_key    text,
  is_private    boolean not null default false,
  created_at    timestamptz not null default now()
);
create unique index if not exists users_username_lower on users (lower(username));
-- upgrades for databases made by the first version
alter table users add column if not exists email text;
alter table users alter column password_hash drop not null;
alter table users drop column if exists recovery_hash;
create unique index if not exists users_email_lower on users (lower(email)) where email is not null;

create table if not exists password_resets (
  token_hash text primary key,
  user_id    uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used       boolean not null default false
);

create table if not exists sessions (
  token_hash text primary key,
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists seasons (
  id        serial primary key,
  name      text not null,
  starts_at timestamptz not null,
  ends_at   timestamptz not null -- exclusive
);

create table if not exists leaves (
  id                 uuid primary key,
  user_id            uuid not null references users(id) on delete cascade,
  season_id          int references seasons(id),
  caught_at          timestamptz not null default now(), -- when the photo was taken (from the photo's EXIF)
  caught_at_source   text not null default 'upload',      -- 'photo' = EXIF time, 'upload' = no photo time found
  photo_key          text not null,
  cutout_key         text not null,
  colour             text not null default '#617257',
  tree_name          text not null,
  tree_scientific    text,
  tree_confidence    real,
  tree_source        text not null default 'user', -- 'auto' = accepted suggestion, 'user' = typed/edited
  caption            text not null default '',
  created_at         timestamptz not null default now()
);
alter table leaves add column if not exists caught_at_source text not null default 'upload';
create index if not exists leaves_season_user on leaves (season_id, user_id, caught_at);
create index if not exists leaves_user on leaves (user_id, caught_at desc);

-- One row per pair of people. status 'pending' until the addressee accepts.
create table if not exists friendships (
  requester_id uuid not null references users(id) on delete cascade,
  addressee_id uuid not null references users(id) on delete cascade,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create table if not exists groups (
  id         uuid primary key,
  name       text not null,
  owner_id   uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id  uuid not null references users(id) on delete cascade,
  primary key (group_id, user_id)
);

-- Likes and comments on the back of a leaf card.
create table if not exists leaf_likes (
  leaf_id    uuid not null references leaves(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (leaf_id, user_id)
);
create table if not exists leaf_comments (
  id         uuid primary key,
  leaf_id    uuid not null references leaves(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists leaf_comments_leaf on leaf_comments (leaf_id, created_at);
`;

export async function migrate() {
  await q(SCHEMA);
  await ensureCurrentSeason();
}

// A season is autumn, 1 Sep to 30 Nov (end exclusive = 1 Dec), the same for everyone.
// Override with SEASON_START=MM-DD and SEASON_END=MM-DD, or edit rows in the seasons table.
export function seasonBounds(year) {
  const start = process.env.SEASON_START || '09-01';
  const end = process.env.SEASON_END || '12-01';
  return {
    name: `Autumn ${year}`,
    starts_at: new Date(`${year}-${start}T00:00:00Z`),
    ends_at: new Date(`${year}-${end}T00:00:00Z`),
  };
}

export async function ensureCurrentSeason(now = new Date()) {
  const b = seasonBounds(now.getUTCFullYear());
  const { rows } = await q('select id from seasons where name = $1', [b.name]);
  if (!rows.length) {
    await q('insert into seasons (name, starts_at, ends_at) values ($1, $2, $3)', [b.name, b.starts_at, b.ends_at]);
  }
}

export async function seasonAt(date) {
  const { rows } = await q('select * from seasons where starts_at <= $1 and ends_at > $1 limit 1', [date]);
  return rows[0] || null;
}

// The season shown by default: the one running now, otherwise the most recent one.
export async function currentOrLastSeason(now = new Date()) {
  return (await seasonAt(now)) ||
    (await q('select * from seasons where starts_at <= $1 order by starts_at desc limit 1', [now])).rows[0] || null;
}
