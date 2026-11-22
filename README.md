# Catch the leaf!

Leaderboards for the real-life autumn game: catch a falling leaf, photograph it, climb the boards.

- **Leaderboard:** First catch this season, Leaf wealth this season, All time. Filter by everyone,
  friends, or your own groups.
- **Profile:** your leaves as cut-outs scattered on the page. Tap one and it flips to show its mirrored
  silhouette in khaki green, with the tree, the date and the caption.
- **Catch a leaf:** take a photo, the leaf is cut out on the phone, the tree is guessed (Pl@ntNet), you
  fix it if you know better and add a caption.
- **Friends:** requests, search, see anyone's friends, make and leave groups.
- **Accounts:** a username is all you need. Email + password are optional (both or neither) and allow
  logging in elsewhere and resetting the password by email.

How it's built and why: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run it locally

Needs Node 22+ and Docker (for Postgres).

```sh
docker compose up -d db                 # Postgres on localhost:5432
cd server && npm install && npm run dev # API on http://localhost:8080
cd web && npm install && npm run dev    # app on http://localhost:5173 (proxies /api to :8080)
```

To try the camera on your phone, open the Vite "Network" URL on the same Wi-Fi. Phones only allow the
camera on `https` or `localhost`, so for a full phone test use `npm run build` in `web/` and a tunnel,
or deploy.

Password-reset emails are printed in the server log until the `TEM_*` variables are set.

Optional: put a free [Pl@ntNet API key](https://my.plantnet.org) in `PLANTNET_API_KEY` to get tree
guesses. Without it you type the tree.

Or everything in Docker: `docker compose up --build`, then open http://localhost:8080.

## Clickable preview

`cd web && npm run build:demo` makes `web/dist-demo/catch-the-leaf-preview.html`: the whole app in one
page with sample players and no server (`web/src/demo/mockApi.js`). Nothing is saved.

## Tests

```sh
cd server && npm test   # needs Postgres; uses the catchtheleaf_test database
```

Create the test database once: `docker compose exec db createdb -U postgres catchtheleaf_test`.

## Deploy to Scaleway

1. **Database:** create a Serverless SQL Database. Copy its connection string into `DATABASE_URL` and set
   `DATABASE_SSL=true`.
2. **Bucket:** create an Object Storage bucket (e.g. `catch-the-leaf-media` in `fr-par`). Create an API key
   with Object Storage access for `S3_ACCESS_KEY` / `S3_SECRET_KEY`. Add a CORS rule allowing `GET` from
   your app's domain (the leaf card uses the cut-out as a CSS mask, which needs CORS).
3. **Image:** create a Container Registry namespace, then:
   ```sh
   docker build -t rg.fr-par.scw.cloud/<namespace>/catch-the-leaf:latest .
   docker login rg.fr-par.scw.cloud -u nologin --password-stdin <<< "$SCW_SECRET_KEY"
   docker push rg.fr-par.scw.cloud/<namespace>/catch-the-leaf:latest
   ```
   Or let GitHub do it: `.github/workflows/deploy.yml` builds and pushes on every push to `main` once
   the repository secrets it lists are set.
4. **Container:** create a Serverless Container from that image, port 8080, 512 MB memory, min scale 0,
   max scale 2 to start. Add the variables from `.env.example` (secrets as secret variables).
5. **Email (for password resets):** in Transactional Email, verify your sending domain, then set
   `TEM_SECRET_KEY`, `TEM_PROJECT_ID`, `MAIL_FROM` and `APP_URL` on the container.
6. Open the container's URL, or attach your own domain.

## Layout

```
server/   Node API (Hono). src/app.js has every route, src/scoring.js the board maths.
web/      React app (Vite). src/cutout.js is the leaf cut-out.
docs/     Architecture, costs, open questions.
```
