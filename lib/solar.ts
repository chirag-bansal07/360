// Google Solar API: a sharp aerial picture of about 200 m x 200 m around a site (10 cm grid).
// Google charges for every request, so each site is fetched once and kept: in the database when hosted,
// in data/solar on this computer. The picture is laid over the ordinary satellite tiles.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { HOSTED } from './session';
import { ensureSchema, sql } from './pg';

// sizeE/sizeN = picture size in metres. dx/dz = its centre, metres east/south of the site point.
// rot = degrees the picture's "up" is turned clockwise from true north. none = Google has no picture here.
// dark = Google's picture was taken in poor light; it is kept brightened, and is not used unless the project asks for it.
export type SolarPic = { sizeE: number; sizeN: number; dx: number; dz: number; rot: number; date: string; quality: string; none?: boolean; dark?: boolean };

export const NEW_SITES_PER_DAY = 40; // paid fetches one login may cause in a day, through its own screens and its shared links together

const DIR = path.join(process.cwd(), 'data', 'solar');
const keyOf = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;
const fileOf = (k: string) => path.join(DIR, k.replace(',', '_'));

async function cached(k: string, withPicture: boolean): Promise<{ meta: SolarPic; jpeg: Buffer | null } | null> {
  if (HOSTED) {
    await ensureSchema();
    const rows = (withPicture ? await sql()`select meta, jpeg from solar_pics where k = ${k}` : await sql()`select meta from solar_pics where k = ${k}`) as any[];
    if (!rows.length) return null;
    return { meta: rows[0].meta as SolarPic, jpeg: rows[0].jpeg ? Buffer.from(rows[0].jpeg, 'base64') : null };
  }
  try {
    const meta = JSON.parse(fs.readFileSync(fileOf(k) + '.json', 'utf8')) as SolarPic;
    return { meta, jpeg: withPicture && !meta.none ? fs.readFileSync(fileOf(k) + '.jpg') : null };
  } catch { return null; }
}

async function keep(k: string, meta: SolarPic, jpeg: Buffer | null) {
  if (HOSTED) {
    await ensureSchema();
    await sql()`insert into solar_pics (k, meta, jpeg) values (${k}, ${JSON.stringify(meta)}::jsonb, ${jpeg ? jpeg.toString('base64') : null})
      on conflict (k) do update set meta = excluded.meta, jpeg = excluded.jpeg, created_at = now()`;
    return;
  }
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (jpeg) fs.writeFileSync(fileOf(k) + '.jpg', jpeg);
    fs.writeFileSync(fileOf(k) + '.json', JSON.stringify(meta));
  } catch { /* no writable disk: works, but is fetched again next time */ }
}

// Where the picture sits, read from the GeoTIFF's own tags (it is drawn on a UTM grid).
function geoTags(buf: Buffer) {
  const mark = buf.toString('latin1', 0, 2), le = mark === 'II';
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)), u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const f64 = (o: number) => (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
  if ((mark !== 'II' && mark !== 'MM') || u16(2) !== 42) throw new Error('unexpected picture format');
  const ifd = u32(4), n = u16(ifd);
  const out: { width: number; height: number; scale: number[]; tie: number[]; epsg: number } = { width: 0, height: 0, scale: [], tie: [], epsg: 0 };
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const small = type === 3 ? u16(e + 8) : u32(e + 8), at = u32(e + 8);
    if (tag === 256) out.width = small;
    else if (tag === 257) out.height = small;
    else if (tag === 33550) out.scale = Array.from({ length: count }, (_, j) => f64(at + j * 8));
    else if (tag === 33922) out.tie = Array.from({ length: count }, (_, j) => f64(at + j * 8));
    else if (tag === 34264 && count >= 8) { out.scale = [Math.abs(f64(at)), Math.abs(f64(at + 40))]; out.tie = [0, 0, 0, f64(at + 24), f64(at + 56), 0]; } // position given as a matrix
    else if (tag === 34735) for (let j = 4; j + 3 < count; j += 4) if (u16(at + j * 2) === 3072) out.epsg = u16(at + (j + 3) * 2);
  }
  if (!out.width || out.scale.length < 2 || out.tie.length < 6 || !(out.epsg > 32600 && out.epsg < 32800)) throw new Error('picture has no position data');
  return out;
}

// Latitude/longitude to UTM metres in a given zone (WGS84).
function toUtm(lat: number, lng: number, zone: number, south: boolean) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const p = (lat * Math.PI) / 180, dl = ((lng - (zone * 6 - 183)) * Math.PI) / 180;
  const s = Math.sin(p), c = Math.cos(p), T = Math.tan(p) ** 2, C = ep2 * c * c, A = dl * c, N = a / Math.sqrt(1 - e2 * s * s);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * p - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * p)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * p) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * p));
  return {
    e: 500000 + k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120),
    n: k0 * (M + N * Math.tan(p) * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720)) + (south ? 10000000 : 0),
    turn: dl * s, // radians the grid's north is turned clockwise from true north
  };
}

async function fetchFromGoogle(lat: number, lng: number, key: string): Promise<{ meta: SolarPic; jpeg: Buffer | null }> {
  const head = { 'X-Goog-Api-Key': key };
  const res = await fetch(`https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=100&view=IMAGERY_LAYERS&requiredQuality=BASE&pixelSizeMeters=0.1`, { headers: head, signal: AbortSignal.timeout(25000) });
  const j = (await res.json().catch(() => ({}))) as any;
  if (res.status === 404) return { meta: { sizeE: 0, sizeN: 0, dx: 0, dz: 0, rot: 0, date: '', quality: '', none: true }, jpeg: null };
  if (!res.ok || !j.rgbUrl) throw new Error(j?.error?.message || `Google Solar API answered ${res.status}`);
  const tif = await fetch(j.rgbUrl, { headers: head, signal: AbortSignal.timeout(40000) });
  if (!tif.ok) throw new Error(`Google Solar API picture answered ${tif.status}`);
  const buf = Buffer.from(await tif.arrayBuffer()), g = geoTags(buf);
  const south = g.epsg > 32700, site = toUtm(lat, lng, g.epsg % 100, south);
  const sizeE = g.width * g.scale[0], sizeN = g.height * g.scale[1];
  const de = g.tie[3] - g.tie[0] * g.scale[0] + sizeE / 2 - site.e, dn = g.tie[4] + g.tie[1] * g.scale[1] - sizeN / 2 - site.n; // picture centre from the site, on the grid
  const cs = Math.cos(site.turn), sn = Math.sin(site.turn);
  const d = j.imageryDate || {};
  const meta: SolarPic = {
    sizeE, sizeN, dx: de * cs + dn * sn, dz: -(-de * sn + dn * cs), rot: (site.turn * 180) / Math.PI,
    date: d.year ? `${d.year}-${String(d.month || 1).padStart(2, '0')}-${String(d.day || 1).padStart(2, '0')}` : '', quality: String(j.imageryQuality || ''),
  };
  const ch = (await sharp(buf, { limitInputPixels: false }).stats()).channels;
  meta.dark = 0.3 * ch[0].mean + 0.59 * ch[1].mean + 0.11 * ch[2].mean < 60;
  let pic = sharp(buf, { limitInputPixels: false }).removeAlpha();
  if (meta.dark) pic = pic.normalise({ lower: 1, upper: 99.5 }).gamma(1.6);
  return { meta, jpeg: await pic.jpeg({ quality: 88 }).toBuffer() };
}

const failed = new Map<string, number>(); // sites where Google just failed: not tried again (and not counted again) for ten minutes
const running = new Map<string, Promise<{ meta: SolarPic; jpeg: Buffer | null }>>(); // one paid request per site, even when several screens ask at once

// The picture's position and date. The first call for a site fetches it from Google (a few seconds) and keeps it.
// That first fetch costs money, so it only happens when mayFetch agrees: the caller checks that the site is a real
// project of the person asking, and that they are inside their daily limit. Without mayFetch only kept pictures are used.
export async function solarInfo(lat: number, lng: number, key: string, mayFetch?: () => Promise<boolean>): Promise<SolarPic | null> {
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const k = keyOf(lat, lng);
  const hit = await cached(k, false);
  if (hit) return hit.meta.none ? null : hit.meta;
  if (!key || !mayFetch) return null;
  let job = running.get(k);
  if (!job) {
    if ((failed.get(k) || 0) > Date.now() || !(await mayFetch())) return null;
    job = fetchFromGoogle(lat, lng, key).then(async (r) => { await keep(k, r.meta, r.jpeg); return r; }).catch((e) => { if (failed.size > 2000) failed.clear(); failed.set(k, Date.now() + 600000); throw e; }).finally(() => running.delete(k));
    running.set(k, job);
  }
  const r = await job;
  return r.meta.none ? null : r.meta;
}

// The kept picture itself. Never calls Google: solarInfo has to have run for the site first.
export async function solarJpeg(lat: number, lng: number): Promise<Buffer | null> {
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return (await cached(keyOf(lat, lng), true))?.jpeg || null;
}
