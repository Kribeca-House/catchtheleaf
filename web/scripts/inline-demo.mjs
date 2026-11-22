// Turns dist-demo/ into one self-contained page: dist-demo/catch-the-leaf-preview.html
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist-demo';
const assets = readdirSync(join(dir, 'assets'));
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dir, 'assets', f), 'utf8')).join('\n');
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dir, 'assets', f), 'utf8')).join('\n');

// Escape non-ASCII so the page reads the same whatever charset it is served with.
const ascii = (t) => t.replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

const page = `<title>Catch the leaf!</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=El+Messiri:wght@500;600;700&display=swap">
<style>${css}</style>
<div id="root"></div>
<script type="module">${ascii(js).replace(/<\/script/gi, '<\\/script')}</script>
`;
writeFileSync(join(dir, 'catch-the-leaf-preview.html'), page);
console.log(`wrote ${join(dir, 'catch-the-leaf-preview.html')} (${Math.round(page.length / 1024)} KB)`);
