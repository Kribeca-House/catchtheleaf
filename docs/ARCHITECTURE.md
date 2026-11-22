# Catch the leaf! Architecture

Status: first version. Anything marked **GUESS** is a decision made without Rebeca's answer yet.

## Goal

A phone-first leaderboard app for the real-life game: catch a falling autumn leaf, photograph it,
and climb three boards. Hosting must be cheap on Scaleway.

## Shape

```
 phone browser (installable web app, PWA)
   │  React, built with Vite. Leaf cut-out runs on the phone (free, no server work).
   ▼
 Scaleway Serverless Container  ── one Node.js container: API (Hono) + the built web app
   │                         │        scales to zero when nobody is playing
   ▼                         ▼
 Scaleway Serverless SQL DB    Scaleway Object Storage (S3)
 (PostgreSQL, scales to zero)  photos + cut-outs, served straight from the bucket
                               ▲
                               └ Pl@ntNet API identifies the tree (free plan)
```

Why this shape:

- **One container, scale to zero.** Nobody plays at 3 am or in July. Serverless Containers bill per
  second of use and have a monthly free allowance, so a hobby-sized game costs about nothing.
- **Postgres, not a VM.** Serverless SQL Database also scales to zero and needs no admin.
  Locally it's ordinary Postgres (docker compose).
- **Images never touch the container after upload.** The bucket serves them, so browsing profiles
  doesn't wake or bill the container.
- **Heavy image work happens on the phone.** Resizing, the cut-out and the leaf colour are computed in
  the browser before upload, so the server needs no image libraries and stays tiny.
- **A web app, not app-store apps.** No store fees or review, one codebase, camera works through the
  browser, and it can be added to the home screen. It can be wrapped as a native app later (Capacitor)
  if you want it in the stores.

## Costs (Scaleway prices read on 22 Nov 2026, before tax)

| Piece | Price | What that means here |
| --- | --- | --- |
| Serverless Containers | €0.000002 per GB-s and €0.00001 per vCPU-s, first 400,000 GB-s and 200,000 vCPU-s free each month | At 512 MB / 0.28 vCPU, scaling to zero: free for a friends-sized game. Kept always-on (no cold starts): roughly €7/month. |
| Serverless SQL Database | Pay per use, scales to zero | I couldn't read the exact rate on the pricing page. At this data size expect a few euros a month at most; check before launch. |
| Object Storage | Per GB stored plus egress | Not on the page I read. Each leaf is about 0.5 MB (photo + cut-out), so 10,000 leaves is about 5 GB: cents per month. |
| Pl@ntNet API | Free plan: 500 identifications a day, commercial use allowed | Enough for hundreds of players. Above that a Pro contract costs from €1,000/year, so the app degrades to "type the tree yourself" when the daily limit is hit. |

Cold start: when the container has scaled to zero, the first request takes a second or two.
Setting the minimum scale to 1 removes that for about €7/month.

## Leaf cut-out (background removal)

Built: **on-phone colour segmentation** (`web/src/cutout.js`). It samples the colours around the photo's
edge as "background", keeps the blob in the middle that differs from them, fills holes and feathers the
edge. Free, instant, private, works offline. It needs the leaf on a plain surface (paper, table,
pavement); it fails on a pile of other leaves or grass. When it fails the person can retake the photo or
keep the photo as a rounded square.

If that isn't good enough, options in order of cost:

1. **Small ML model in the browser** (e.g. U²-Net-p via onnxruntime-web, ~5 MB download, Apache-2.0).
   Still free to host; slower on old phones.
2. **`@imgly/background-removal` in the browser.** Very good results, but AGPL-3.0 licensed and a
   ~40 MB+ model download on first use.
3. **Server-side `rembg`** in a Scaleway Serverless Job. Good results, needs a 1 to 2 GB container, a
   few cents per thousand leaves, slower cold start.
4. **A paid API** (remove.bg and similar): about €0.20 per image. Not cheap at scale.

## Tree identification

The phone sends the downsized photo to `/api/identify`, which calls Pl@ntNet with `organs=leaf` and
returns up to five guesses with confidence. The top guess is pre-filled; the person can tap another
guess or type their own. We store whether the final name came from the guess (`auto`) or the person
(`user`). Without `PLANTNET_API_KEY`, or when the daily quota is used up, the app asks them to type it.

## Data

`server/src/db.js` creates the tables on start (no migration tool yet):

- `users`: username (unique, case-insensitive), optional alias, scrypt password hash, hashed recovery
  code, avatar, private flag.
- `sessions`: hashed bearer tokens, 90 days.
- `seasons`: start/end. **GUESS:** one season per year, 1 Sep to 30 Nov (UTC), northern hemisphere.
  Change with `SEASON_START` / `SEASON_END` or edit the rows.
- `leaves`: owner, season, catch time, photo + cut-out keys, leaf colour, tree name / scientific name /
  confidence / source, caption.
- `friendships`: one row per pair, `pending` until accepted.
- `groups`, `group_members`: a named subset of your friends, used to filter the boards.

## The three boards

1. **First catch (this season).** **GUESS:** ranked by the time of each player's first leaf this
   season, earliest first.
2. **Leaf wealth (this season).** Most leaves; a tie goes to whoever reached that number first.
3. **All time.** **GUESS:** for each season, season points = number of players that season − your
   place + 1 (1st of 10 gets 10). Score = Σ (2 × season points + leaves that season), so a season place
   counts double compared with a leaf.

Filters: Everyone, Friends (you + your friends) or one of your groups. Places are renumbered inside the
filter, so a friends board starts at #1. All-time scores are computed globally and then filtered.

The boards are computed on request from the leaves table. That's fine to thousands of players; past
that, cache them for a minute or store season results when a season ends.

## Accounts without email

- Sign up with username + password (8+ characters) and an optional alias.
- **Forgotten password:** a recovery code (`LEAF-XXXX-XXXX-XXXX`) is shown once at sign-up. Username +
  code sets a new password, logs out every other device and issues a new code. Settings can issue a new
  code. If someone loses both, only an admin can help (no admin screen yet).
- Failed logins are throttled per username (8 tries per 15 minutes). This is per container instance,
  so it slows guessing rather than stopping it; a shared limit would need Redis or a DB table.

## Privacy

- Profiles are public by default. **GUESS:** a private profile still appears on leaderboards
  (name, alias, picture, score), but only friends see its leaves and friends list.
- Image URLs are random and unlisted but not secret: anyone with a link can open it. Making photos of
  private profiles truly private needs signed URLs (a small change).
- Photos are re-encoded on the phone before upload, which drops EXIF data such as GPS location.
- Deleting an account deletes its leaves, photos, friendships and groups.

## Cheating and evidence

What's in: the catch time is the server's clock at upload, so nobody can backdate a catch; the photo is
kept as evidence ("Original photo" on the card); uploads must be real JPEG/PNG/WebP under 6 MB.

What's not (open question): a photo doesn't prove the leaf was caught mid-air. Options: friends can
flag a leaf; a leaf needs a "witness" friend to confirm it; a daily cap; duplicate-photo detection
(perceptual hash) so the same leaf can't be uploaded twice.

## Deploying on Scaleway

See `README.md` for the steps. In short: build the Docker image, push it to Scaleway Container
Registry, create a Serverless Container from it with the environment variables in `.env.example`,
create a Serverless SQL Database and an Object Storage bucket (public-read objects, CORS allowing your
app's domain so the card's leaf silhouette mask can load).
