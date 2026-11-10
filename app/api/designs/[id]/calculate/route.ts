import { readDb, writeDb, findDesign, json, fail } from '@/lib/store';
import { allModules } from '@/lib/catalog';
import { designTotals } from '@/lib/geometry';
import { simulate } from '@/lib/energy';
import type { Weather } from '@/lib/types';

export const dynamic = 'force-dynamic';

const KEYS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

async function fetchWeather(lat: number, lng: number): Promise<Weather> {
  const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DIFF,T2M&community=RE&longitude=${lng.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Weather service answered ${res.status}`);
  const p = (await res.json())?.properties?.parameter;
  const pick = (name: string) => KEYS.map((k) => Number(p?.[name]?.[k]));
  const ghi = pick('ALLSKY_SFC_SW_DWN'), temp = pick('T2M');
  let dhi = pick('ALLSKY_SFC_SW_DIFF');
  if (ghi.some((v) => !isFinite(v) || v <= 0)) throw new Error('Weather service has no irradiance data for this location');
  dhi = dhi.map((v, i) => (isFinite(v) && v > 0 ? v : ghi[i] * 0.4));
  return { source: 'NASA POWER climatology', fetchedAt: new Date().toISOString(), ghi, dhi, temp: temp.map((t) => (isFinite(t) && t > -90 ? t : 25)) };
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = (await readDb());
  const hit = findDesign(db, id);
  if (!hit) return fail('Design not found.', 404);
  const { project, design } = hit;
  const mods = allModules(db.settings);
  if (designTotals(design, mods).modules === 0) return fail('Add at least one panel block before calculating generation.');
  if (!project.weather) {
    try {
      project.weather = await fetchWeather(project.lat, project.lng);
    } catch (e: any) {
      return fail(`Could not download weather data (${e?.message || 'no connection'}). Check the internet connection and try again.`, 502);
    }
  }
  const results = { ...simulate(project.lat, design, mods, project.weather, db.settings.losses), calculatedAt: new Date().toISOString() };
  // the design may have been saved again while weather was downloading
  const fresh = (await readDb());
  const again = findDesign(fresh, id);
  if (!again) return fail('Design not found.', 404);
  again.project.weather = project.weather;
  again.design.results = results;
  await writeDb(fresh);
  return json({ results });
}
