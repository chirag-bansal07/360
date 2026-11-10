// Google Map Tiles API (satellite). Used only when the user has saved their own API key in Settings.
let cached: { key: string; session: string; expires: number } | null = null;

export async function googleSession(key: string): Promise<string> {
  if (cached && cached.key === key && cached.expires > Date.now() + 60000) return cached.session;
  const res = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapType: 'satellite', language: 'en-US', region: 'IN' }), signal: AbortSignal.timeout(15000),
  });
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !j.session) throw new Error(j?.error?.message || `Google answered ${res.status}`);
  cached = { key, session: j.session, expires: Number(j.expiry) * 1000 || Date.now() + 3600000 };
  return j.session;
}

export const googleTileUrl = (key: string, session: string, z: number, x: number, y: number) =>
  `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${session}&key=${encodeURIComponent(key)}`;
