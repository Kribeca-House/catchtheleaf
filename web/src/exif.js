// Reads when a photo was taken from its EXIF data (JPEG). The phone re-encodes photos before upload,
// which drops EXIF, so this must run on the original file first.
// Returns a Date or null.

const DATE_TAGS = { 0x9003: 'original', 0x9004: 'digitized', 0x0132: 'modified' };
const OFFSET_TAGS = { 0x9011: 'original', 0x9012: 'digitized', 0x9010: 'modified' };

export async function photoTakenAt(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return null; // not a JPEG (HEIC is converted to JPEG by phone browsers)
    let p = 2;
    while (p + 4 < v.byteLength) {
      const marker = v.getUint16(p);
      const len = v.getUint16(p + 2);
      if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966) return readExif(v, p + 10);
      if ((marker & 0xff00) !== 0xff00) return null;
      p += 2 + len;
    }
  } catch { /* unreadable: fall through */ }
  return null;
}

function readExif(v, tiff) {
  const little = v.getUint16(tiff) === 0x4949;
  const u16 = (o) => v.getUint16(tiff + o, little);
  const u32 = (o) => v.getUint32(tiff + o, little);
  const ascii = (o, n) => {
    let s = '';
    for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(tiff + o + i));
    return s;
  };
  const dates = {}, offsets = {};
  const readIfd = (off, depth = 0) => {
    if (!off || depth > 2 || tiff + off + 2 > v.byteLength) return;
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (tiff + e + 12 > v.byteLength) return;
      const tag = u16(e), count = u32(e + 4);
      const valueOff = count > 4 ? u32(e + 8) : e + 8;
      if (tag === 0x8769) readIfd(u32(e + 8), depth + 1); // Exif sub-IFD
      else if (DATE_TAGS[tag] && count >= 19) dates[DATE_TAGS[tag]] = ascii(valueOff, count);
      else if (OFFSET_TAGS[tag] && count >= 6) offsets[OFFSET_TAGS[tag]] = ascii(valueOff, count);
    }
  };
  readIfd(u32(4));
  for (const kind of ['original', 'digitized', 'modified']) {
    const d = dates[kind];
    const m = d && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(d);
    if (!m) continue;
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    // With a time zone offset (newer phones) the time is exact; without one it's the phone's local time.
    const off = offsets[kind] && /^[+-]\d{2}:\d{2}$/.test(offsets[kind]) ? offsets[kind] : '';
    const date = new Date(iso + off);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}
