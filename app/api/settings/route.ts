import { readDb, writeDb, json, fail, getGoogleKey, setGoogleKey } from '@/lib/store';
import { isAdmin } from '@/lib/auth';
import { DEFAULT_LOSSES } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

// The Google key is write-only: pages learn only whether one is saved.
// Only the admin can see that a key exists or change it. Company logins get no key information at all.
async function masked(s: any) {
  const admin = await isAdmin();
  return { ...s, googleMapsKey: '', canSetKey: admin, hasGoogleKey: admin ? !!(await getGoogleKey()) : false };
}

export async function GET() {
  return json({ settings: await masked((await readDb()).settings) });
}

export async function PUT(req: Request) {
  const b = await req.json();
  const db = (await readDb());
  const s = db.settings;
  if (b.company) {
    const logo = String(b.company.logo || '');
    if (logo.length > 700000) return fail('The logo file is too large. Use an image under 500 KB.');
    s.company = { name: String(b.company.name || '').trim() || 'SunCraft3D', email: String(b.company.email || '').trim(), phone: String(b.company.phone || '').trim(), logo };
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
  await writeDb(db);
  const newKey = typeof b.googleMapsKey === 'string' ? b.googleMapsKey.trim() : '';
  if (b.removeGoogleKey === true || newKey) {
    if (!(await isAdmin())) return fail('Only the admin can change the Google Maps key.', 403);
    if (newKey.length > 200) return fail('That does not look like a Google Maps key.');
    await setGoogleKey(b.removeGoogleKey === true ? '' : newKey);
  }
  return json({ settings: await masked((await readDb()).settings) });
}
