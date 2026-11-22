import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { createApp } from './app.js';
import { migrate } from './db.js';

// One container serves the API and the built web app, so there is only one thing to deploy.
// Set STATIC_DIR to the web build (the Dockerfile does this).
const STATIC_DIR = process.env.STATIC_DIR || '../web/dist';
const port = Number(process.env.PORT || 8080);

await migrate();
const app = createApp();

app.use('/assets/*', serveStatic({ root: STATIC_DIR }));
app.use('/*', serveStatic({ root: STATIC_DIR }));
// Single-page app: any other path gets index.html.
app.get('*', async (c) => {
  try { return c.html(await readFile(`${STATIC_DIR}/index.html`, 'utf8')); } catch { return c.text('Web app not built yet. Run npm run build in web/.', 404); }
});

serve({ fetch: app.fetch, port }, () => console.log(`Catch the leaf! listening on :${port}`));
