# Catch the leaf! Architecture

Status: second version, with Rebeca's answers to the first round of questions (22 Nov 2026).
Points marked (confirmed) are Rebeca's decisions; the rest are defaults that are easy to change.

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
 Scaleway Transactional Email ── password-reset links (only for accounts with an email)
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
| Transactional Email | Pay per email, I didn't check the rate | Only password resets, so a handful a month. |
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

- `users`: username (unique, case-insensitive), optional alias, optional email + scrypt password hash
  (both or neither), avatar, private flag.
- `sessions`: hashed bearer tokens, 400 days, extended whenever used.
- `password_resets`: hashed one-hour, single-use reset tokens.
- `seasons`: start/end. One season per year, 1 Sep to 30 Nov (UTC), the same for everyone (confirmed).
  Change with `SEASON_START` / `SEASON_END` or edit the rows.
- `leaves`: owner, season, catch time and where it came from (`photo` or `upload`), photo + cut-out
  keys, leaf colour, tree name / scientific name / confidence / source, caption.
- `friendships`: one row per pair, `pending` until accepted.
- `groups`, `group_members`: a named subset of your friends, used to filter the boards.

## The three boards

1. **First catch (this season).** Ranked by the time of each player's first leaf this season,
   earliest first (confirmed).
2. **Leaf wealth (this season).** Most leaves; a tie goes to whoever reached that number first.
3. **All time** (Rebeca's rule). For each season, season points = active leaf catchers that season −
   your place, so 1st of 30 gets 29 and 3rd gets 27. Score = Σ (2 × season points + leaves that
   season): season points count double compared with leaves. Ties go to more season points.

Filters: Everyone, Friends (you + your friends) or one of your groups. Places are renumbered inside the
filter, so a friends board starts at #1. All-time scores are computed globally and then filtered.

The boards are computed on request from the leaves table. That's fine to thousands of players; past
that, cache them for a minute or store season results when a season ends.

## Accounts

- Sign up with a username and an optional alias. **Email and password are optional, but go together:**
  set both or neither.
- **Without email + password** the account lives on the phone that made it. Its session lasts 400 days
  and is extended whenever the app is used, so it doesn't lapse while someone plays. Logging out or
  clearing the browser loses it, and the app warns about that. Settings offers "Add email and password"
  at any time.
- **With email + password** you can log in anywhere with username or email. "Forgot password?" emails a
  one-hour, single-use link (Scaleway Transactional Email); using it logs out other devices. The answer
  is the same whether or not the email exists, so it can't be used to discover accounts.
- Failed logins are throttled per username or email (8 tries per 15 minutes). This is per container
  instance, so it slows guessing rather than stopping it; a shared limit would need a DB table.

## Privacy

- A **private profile hides its profile picture** from everyone except its friends: on leaderboards,
  in search, in lists and on the profile. Leaves, name and friends list stay visible (confirmed).
- Image URLs are random and unlisted but not secret: anyone with a link can open it.
- Photos are re-encoded on the phone before upload, which drops EXIF data such as GPS location. The
  photo's date is read first and sent on its own.
- Emails are never shown to other players.
- Deleting an account deletes its leaves, photos and friendships; groups it owned pass to another member.

## Catch time and trust

The catch time is **when the photo was taken** (confirmed): read on the phone from the photo's EXIF
`DateTimeOriginal`, with its time zone when the phone records one. If the photo has no date, the file's
date is used when it's clearly older than now, otherwise the upload time. A time in the future is
ignored. The catch screen shows which time will be used. The leaf counts in the season its catch time
falls in.

Players are trusted (confirmed): there's no flagging or witness step. The original photo is kept and
shown on the card, and uploads must be real JPEG/PNG/WebP images under 6 MB.

## Groups

A group is a named set of the owner's friends, used to filter the boards. The owner adds and removes
people (no invite to accept) and can delete it. **Anyone can leave**; when the owner leaves, another
member becomes the owner, and an empty group is deleted.

## Look

Headings use El Messiri (Google Fonts). Body text uses Helvetica Neue, which is built into iPhones and
Macs; it can't be served as a web font without a licence, so Android and Windows fall back to
Helvetica or Arial. A leaf card shows the cut-out on the front; the back shows the original photo, the tree, the date, the caption, likes and comments (anyone signed in can like and comment; you can delete your own comments and any comment on your own leaf).

## Deploying on Scaleway

See `README.md` for the steps. In short: build the Docker image, push it to Scaleway Container
Registry, create a Serverless Container from it with the environment variables in `.env.example`,
create a Serverless SQL Database and an Object Storage bucket (public-read objects; no CORS needed,
the app only displays the images).
