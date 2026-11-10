import { readDb, writeDb, json, fail } from '@/lib/store';
import { uid, newDesign } from '@/lib/catalog';
import { guessUtcOffset } from '@/lib/sun';
import type { Project } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = readDb();
  const projects = [...db.projects].reverse().map((p) => ({
    id: p.id, number: p.number, name: p.name, clientName: p.clientName, type: p.type,
    address: p.displayAddress || p.address, lat: p.lat, lng: p.lng, createdAt: p.createdAt,
    designCount: p.designs.length, thumb: p.designs.find((d) => d.thumb)?.thumb || '',
  }));
  return json({ projects });
}

export async function POST(req: Request) {
  const b = await req.json();
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!String(b.name || '').trim()) return fail('Project name is required.');
  if (!String(b.clientName || '').trim()) return fail('Client name is required.');
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return fail('Pick the project location first.');
  const db = readDb();
  const project: Project = {
    id: uid(), number: db.nextNumber++, name: String(b.name).trim(), clientName: String(b.clientName).trim(),
    phone: String(b.phone || '').trim(), email: String(b.email || '').trim(), address: String(b.address || '').trim(),
    displayAddress: String(b.displayAddress || b.address || '').trim(), type: b.type === 'residential' ? 'residential' : 'commercial',
    lat, lng, utcOffset: guessUtcOffset(lat, lng), createdAt: new Date().toISOString(), weather: null,
    designs: [newDesign('Design 1')],
  };
  db.projects.push(project);
  writeDb(db);
  return json({ project });
}
