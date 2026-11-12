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
    const L = Number(b.shed?.length), W = Number(b.shed?.width);
    if (!(L >= 1 && L <= 1000) || !(W >= 1 && W <= 1000)) return fail('Enter the shed length and width in metres (1 to 1000).');
    const tilt = num(b.shed?.tilt, 0, 60, 0);
    // a rectangle around the centre: length runs east-west, width north-south
    const shed: Shed = { id: uid(), name: 'Shed 1', points: [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]], height: num(b.shed?.height, 0, 80, 6), setback: num(b.shed?.setback, 0, 10, 0.3) };
    if (tilt > 0) { shed.tilt = tilt; shed.slopeAz = num(b.shed?.slopeAz, 0, 359.99, 180); }
    design.sheds = [shed];
  }
  const db = (await readDb());
  const project: Project = {
    id: uid(), number: db.nextNumber++, name: String(b.name).trim(), clientName: String(b.clientName).trim(),
    phone: String(b.phone || '').trim(), email: String(b.email || '').trim(), address: String(b.address || '').trim(),
    displayAddress: String(b.displayAddress || b.address || '').trim(), type: b.type === 'residential' ? 'residential' : 'commercial',
    lat, lng, utcOffset: guessUtcOffset(lat, lng), createdAt: new Date().toISOString(), weather: null,
    ...(noMap ? { noMap: true } : {}),
    designs: [design],
  };
  db.projects.push(project);
  await writeDb(db);
  return json({ project });
}
