// Cuts a leaf out of its background, in the browser, for free.
//
// How: colours along the photo's edge are taken to be "background". Pixels that differ enough
// from every background colour are "leaf". We keep the biggest blob near the middle, fill its
// holes, soften the edge and crop to it. This works well for a leaf laid on a plain surface
// (paper, a table, pavement) and poorly on a busy background such as a pile of other leaves.
// The upload screen tells people to use a plain surface, and lets them keep the photo if it fails.
// See docs/ARCHITECTURE.md for the ML options if this isn't good enough.

const ANALYSIS_MAX = 480;
const PHOTO_MAX = 1600;
const CUTOUT_MAX = 900;

function srgbToLab(r, g, b) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function kmeans(points, k, iters = 8) {
  const centres = [];
  for (let i = 0; i < k; i++) centres.push(points[Math.floor((i + 0.5) * points.length / k)].slice());
  for (let it = 0; it < iters; it++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const p of points) {
      let best = 0, bd = Infinity;
      centres.forEach((c, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = i; } });
      const s = sums[best]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    sums.forEach((s, i) => { if (s[3]) centres[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  return centres;
}

function otsu(values, bins = 128, max = 100) {
  const hist = new Array(bins).fill(0);
  for (const v of values) hist[Math.min(bins - 1, Math.floor((Math.min(v, max) / max) * bins))]++;
  const total = values.length;
  let sum = 0; hist.forEach((h, i) => { sum += i * h; });
  let sumB = 0, wB = 0, best = 0, threshold = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = i; }
  }
  return ((threshold + 0.5) / bins) * max;
}

function morph(mask, w, h, grow) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = grow ? 0 : 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      const m = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : mask[yy * w + xx];
      if (grow && m) v = 1;
      if (!grow && !m) v = 0;
    }
    out[y * w + x] = v;
  }
  return out;
}

function components(mask, w, h) {
  const label = new Int32Array(mask.length).fill(-1);
  const comps = [];
  const stack = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i] !== -1) continue;
    const id = comps.length;
    let size = 0, sx = 0, sy = 0;
    label[i] = id; stack.push(i);
    while (stack.length) {
      const p = stack.pop(); size++;
      const x = p % w, y = (p / w) | 0; sx += x; sy += y;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= mask.length) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        if (mask[q] && label[q] === -1) { label[q] = id; stack.push(q); }
      }
    }
    comps.push({ id, size, cx: sx / size, cy: sy / size });
  }
  return { label, comps };
}

function fillHoles(mask, w, h) {
  const outside = new Uint8Array(mask.length);
  const stack = [];
  const seed = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop(); const x = p % w;
    if (x > 0) seed(p - 1); if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w); if (p + w < mask.length) seed(p + w);
  }
  return mask.map((m, i) => (m || !outside[i] ? 1 : 0));
}

const toBlob = (canvas, type, quality) => new Promise((res) => canvas.toBlob(res, type, quality));

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

export async function loadBitmap(file) {
  // imageOrientation applies the phone's EXIF rotation.
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

export async function resizeToJpeg(file, max, quality = 0.85, square = false) {
  const bmp = await loadBitmap(file);
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
  if (square) { const s = Math.min(sw, sh); sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s; }
  const scale = Math.min(1, max / Math.max(sw, sh));
  const c = canvasOf(sw * scale, sh * scale);
  c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return toBlob(c, 'image/jpeg', quality);
}

export async function cutOutLeaf(file) {
  const bmp = await loadBitmap(file);
  const W = bmp.width, H = bmp.height;

  // Evidence photo, downsized.
  const ps = Math.min(1, PHOTO_MAX / Math.max(W, H));
  const photoCanvas = canvasOf(W * ps, H * ps);
  photoCanvas.getContext('2d').drawImage(bmp, 0, 0, photoCanvas.width, photoCanvas.height);
  const photo = await toBlob(photoCanvas, 'image/jpeg', 0.85);

  // Small copy for analysis.
  const as = Math.min(1, ANALYSIS_MAX / Math.max(W, H));
  const a = canvasOf(W * as, H * as);
  const actx = a.getContext('2d', { willReadFrequently: true });
  actx.drawImage(bmp, 0, 0, a.width, a.height);
  const w = a.width, h = a.height;
  const px = actx.getImageData(0, 0, w, h).data;
  const lab = new Array(w * h);
  for (let i = 0; i < w * h; i++) lab[i] = srgbToLab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);

  // Background colours from a band along the edges.
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const border = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x < band || y < band || x >= w - band || y >= h - band) border.push(lab[y * w + x]);
  }
  const bg = kmeans(border, 4);
  const dist = lab.map((p) => Math.sqrt(Math.min(...bg.map((c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2))));
  const threshold = Math.max(otsu(dist), 14);

  let mask = Uint8Array.from(dist, (d) => (d > threshold ? 1 : 0));
  mask = morph(morph(mask, w, h, false), w, h, true); // open: drop specks

  // Keep the biggest blob, favouring blobs near the middle of the photo.
  const { label, comps } = components(mask, w, h);
  if (!comps.length) return { ok: false, photo };
  const diag = Math.hypot(w, h) / 2;
  const scoreOf = (c) => c.size * (1 - 0.6 * Math.hypot(c.cx - w / 2, c.cy - h / 2) / diag);
  const best = comps.reduce((m, c) => (scoreOf(c) > scoreOf(m) ? c : m));
  mask = fillHoles(Uint8Array.from(label, (l) => (l === best.id ? 1 : 0)), w, h);

  let n = 0, r = 0, g = 0, b = 0, minX = w, minY = h, maxX = 0, maxY = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    n++; r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2];
    const x = i % w, y = (i / w) | 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const coverage = n / mask.length;
  const touchesAllEdges = minX === 0 && minY === 0 && maxX === w - 1 && maxY === h - 1;
  const ok = coverage > 0.015 && coverage < 0.85 && !touchesAllEdges;
  const colour = '#' + [r, g, b].map((v) => Math.round(v / Math.max(n, 1)).toString(16).padStart(2, '0')).join('');
  if (!ok) return { ok: false, photo, colour };

  // Mask as a small alpha image, scaled up smoothly onto the crop.
  const maskCanvas = canvasOf(w, h);
  const mctx = maskCanvas.getContext('2d');
  const mdata = mctx.createImageData(w, h);
  for (let i = 0; i < mask.length; i++) { mdata.data[i * 4 + 3] = mask[i] ? 255 : 0; }
  mctx.putImageData(mdata, 0, 0);

  const pad = 2;
  const cx0 = Math.max(0, minX - pad), cy0 = Math.max(0, minY - pad);
  const cx1 = Math.min(w, maxX + 1 + pad), cy1 = Math.min(h, maxY + 1 + pad);
  const srcX = cx0 / as, srcY = cy0 / as, srcW = (cx1 - cx0) / as, srcH = (cy1 - cy0) / as;
  const os = Math.min(1, CUTOUT_MAX / Math.max(srcW, srcH));
  const out = canvasOf(srcW * os, srcH * os);
  const octx = out.getContext('2d');
  octx.drawImage(bmp, srcX, srcY, srcW, srcH, 0, 0, out.width, out.height);
  // Scale the blocky mask up smoothly and feather it, so the edge isn't a staircase.
  const soft = canvasOf(out.width, out.height);
  const sctx = soft.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.filter = `blur(${Math.max(1.5, (out.width / (cx1 - cx0)) * 0.9)}px)`;
  sctx.drawImage(maskCanvas, cx0, cy0, cx1 - cx0, cy1 - cy0, 0, 0, out.width, out.height);
  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(soft, 0, 0);
  const cutout = await toBlob(out, 'image/png');

  return { ok: true, photo, cutout, colour, coverage };
}

// Fallback when the cut-out fails: keep the photo, cropped to a soft rounded square.
export async function photoAsCutout(file) {
  const bmp = await loadBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const size = Math.min(CUTOUT_MAX, s);
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.18);
  ctx.clip();
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return toBlob(c, 'image/png');
}
