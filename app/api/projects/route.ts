import { solarAllowed } from '@/lib/auth';
import { readDb, writeDb, json, fail } from '@/lib/store';
import { uid, newDesign } from '@/lib/catalog';
import { guessUtcOffset } from '@/lib/sun';
import type { Project, Shed } from '@/lib/types';

const num = (v: any, min: number, max: number, dflt: number) => { const n = Number(v); return isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt; };

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = (await readDb());
  const projects = [...db.projects].reverse().map((p) => ({
    id: p.id, number: p.number, name: p.name, clientName: p.clientName, type: p.type,
    address: p.displayAddress || p.address, lat: p.lat, lng: p.lng, createdAt: p.createdAt,
    designCount: p.designs.length, thumb: p.designs.find((d) => d.thumb)?.thumb || '',
  }));
  return json({ projects });
}

export async function POST(req: Request) {
  const b = await req.json();
  const noMap = b.noMap === true;
  let lat = Number(b.lat), lng = Number(b.lng);
  const placed = b.lat != null && b.lng != null && isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (noMap && !placed) { lat = 22.5; lng = 79; } // no town given: central India stands in for sun and weather
  if (!String(b.name || '').trim()) return fail('Project name is required.');
  if (!String(b.clientName || '').trim()) return fail('Client name is required.');
  if (!noMap && !placed) return fail('Pick the project location first.');
  const design = newDesign('Design 1');
  if (noMap) {
    // one shed or several: they stand in a row from west to east, "gap" metres apart, the row centred on the site point
    const list: any[] = Array.isArray(b.sheds) ? b.sheds : [b.shed];
    if (!list.length || list.length > 20) return fail('Enter between 1 and 20 sheds.');
    const ok = (v: any) => Number(v) >= 1 && Number(v) <= 1000;
    const bad = list.findIndex((s) => !ok(s?.length) || !ok(s?.width));
    if (bad >= 0) return fail(`Enter the length and width of shed ${bad + 1} in metres (1 to 1000).`);
    const gap = list.length > 1 ? num(b.gap, 0, 200, 3) : 0, r = (v: number) => Math.round(v * 100) / 100;
    let x = -(list.reduce((s, q) => s + Number(q.length), 0) + gap * (list.length - 1)) / 2;
    design.sheds = list.map((q, i) => {
      const L = Number(q.length), W = Number(q.width), tilt = num(q.tilt, 0, 60, 0), x0 = r(x), x1 = r(x + L);
      x += L + gap;
      // a rectangle: length runs east-west, width north-south
      const shed: Shed = { id: uid(), name: `Shed ${i + 1}`, points: [[x0, -W / 2], [x1, -W / 2], [x1, W / 2], [x0, W / 2]], height: num(q.height, 0, 80, 6), setback: num(q.setback, 0, 10, 0.3) };
      if (tilt > 0) { shed.tilt = tilt; shed.slopeAz = num(q.slopeAz, 0, 359.99, 180); }
      return shed;
    });
  }
  const db = (await readDb());
  const project: Project = {
    id: uid(), number: db.nextNumber++, name: String(b.name).trim(), clientName: String(b.clientName).trim(),
    phone: String(b.phone || '').trim(), email: String(b.email || '').trim(), address: String(b.address || '').trim(),
    displayAddress: String(b.displayAddress || b.address || '').trim(), type: b.type === 'residential' ? 'residential' : 'commercial',
    lat, lng, utcOffset: guessUtcOffset(lat, lng), createdAt: new Date().toISOString(), weather: null,
    ...(noMap ? { noMap: true } : {}),
    ...((await solarAllowed()) ? { imagery: 'auto' as const } : {}),
    designs: [design],
  };
  db.projects.push(project);
  await writeDb(db);
  return json({ project });
}
