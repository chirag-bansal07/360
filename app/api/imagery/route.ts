import { json, getGoogleKey, readDb } from '@/lib/store';
import { pickImagery } from '@/lib/imagery';
import { HOSTED } from '@/lib/session';
import { requireUserId } from '@/lib/auth';
import { allow } from '@/lib/pg';

export const dynamic = 'force-dynamic';

const NEW_SITES_PER_DAY = 40; // paid Google Solar API fetches one login may cause in a day

export async function GET(req: Request) {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get('lat')), lng = Number(u.searchParams.get('lng'));
  // A new aerial picture is bought only for the site of one of the caller's own projects, and only so many a day.
  const mayFetch = async () => {
    if (!isFinite(lat) || !isFinite(lng)) return false;
    const mine = (await readDb()).projects.some((p) => !p.noMap && p.lat.toFixed(5) === lat.toFixed(5) && p.lng.toFixed(5) === lng.toFixed(5));
    if (!mine) return false;
    return HOSTED ? allow(`solar:${await requireUserId()}`, NEW_SITES_PER_DAY, 86400) : true;
  };
  return json(await pickImagery(lat, lng, await getGoogleKey(), mayFetch));
}
