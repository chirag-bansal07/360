import { readDb, writeDb, json, fail } from '@/lib/store';
import { DEFAULT_LOSSES } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

export async function GET() {
  return json({ settings: readDb().settings });
}

export async function PUT(req: Request) {
  const b = await req.json();
  const db = readDb();
  const s = db.settings;
  if (b.company) {
    const logo = String(b.company.logo || '');
    if (logo.length > 700000) return fail('The logo file is too large. Use an image under 500 KB.');
    s.company = { name: String(b.company.name || '').trim() || 'Sunmount360', email: String(b.company.email || '').trim(), phone: String(b.company.phone || '').trim(), logo };
  }
  if (Array.isArray(b.customModules)) {
    const mods = [];
    for (const m of b.customModules) {
      const watt = Number(m.watt), length = Number(m.length), width = Number(m.width);
      if (!String(m.name || '').trim()) return fail('Every module needs a name.');
      if (!(watt > 0 && watt < 2000) || !(length > 0.3 && length < 4) || !(width > 0.3 && width < 4)) return fail(`Check the watt and size values of "${m.name}".`);
      mods.push({ id: String(m.id), name: String(m.name).trim(), watt, length: Math.max(length, width), width: Math.min(length, width) });
    }
    s.customModules = mods;
  }
  if (b.losses) {
    const out: any = { ...DEFAULT_LOSSES };
    for (const k of Object.keys(DEFAULT_LOSSES)) {
      const v = Number(b.losses[k]);
      if (!isFinite(v)) return fail('Loss values must be numbers.');
      out[k] = v;
    }
    if (out.inverterEff <= 50 || out.inverterEff > 100) return fail('Inverter efficiency must be between 50 and 100 %.');
    s.losses = out;
  }
  if (typeof b.googleMapsKey === 'string') s.googleMapsKey = b.googleMapsKey.trim();
  writeDb(db);
  return json({ settings: s });
}
