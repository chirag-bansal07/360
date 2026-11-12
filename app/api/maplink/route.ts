import { json, fail } from '@/lib/store';
import { parseLatLng, placeName, isGoogleMapsHost } from '@/lib/maplink';
import { findPlace } from '@/lib/geosearch';

export const dynamic = 'force-dynamic';

const NO_PIN = 'This link does not carry an exact position (links shared from the phone app often do not). In Google Maps, right-click the roof (or press and hold on the phone), copy the coordinates and paste them here.';

// Turns a pasted Google Maps link (long or short) or "lat, lng" text into coordinates.
// Coordinates are only ever read from the link itself. The Google page behind a link is never searched for numbers:
// it holds the map view Google guesses for whoever opens it (this server), not the place in the link.
// A link with only a place name is looked up by that name and offered as choices, never placed silently.
export async function POST(req: Request) {
  const { text } = await req.json();
  const t = String(text || '').trim();
  if (!t) return fail('Paste a Google Maps link first.');
  const direct = parseLatLng(t);
  if (direct && !direct.approx) return json(direct);
  if (!/^https:\/\//i.test(t)) return direct ? json(direct) : fail('That does not look like a Google Maps link or coordinates. Example: 29.37816, 77.03216');
  if (!isGoogleMapsHost(t)) return fail('Only Google Maps links are supported here.');
  let centre = direct, name = placeName(t);
  try {
    // Redirects are followed one at a time so every hop is checked: https only, Google Maps hosts only.
    let url = t;
    for (let hop = 0; hop < 6; hop++) {
      if (!/^https:\/\//i.test(url) || !isGoogleMapsHost(url)) break;
      const here = parseLatLng(url);
      if (here && !here.approx) return json(here);
      centre = centre || here;
      name = placeName(url) || name;
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' } });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!next) break;
      url = new URL(next, url).toString();
    }
  } catch {
    if (!centre && !name) return fail('Could not open that link. Check the internet connection, or paste the coordinates instead.', 502);
  }
  if (centre) return json(centre); // only the map view is known: the screen asks the user to check the pin
  if (!name) return fail(NO_PIN);
  try {
    const found = await findPlace(name);
    if (!found.results.length) return fail(`${NO_PIN} The place named in the link (“${name}”) was not found on the map either.`);
    return json({ name, ...found });
  } catch {
    return fail(NO_PIN, 502);
  }
}
