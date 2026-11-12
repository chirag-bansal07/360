import { solarJpeg } from '@/lib/solar';

export const dynamic = 'force-dynamic';

// The kept Google Solar API picture of a site (signed-in screens).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const jpeg = await solarJpeg(Number(u.searchParams.get('lat')), Number(u.searchParams.get('lng')));
  if (!jpeg) return new Response('not available', { status: 404 });
  return new Response(new Uint8Array(jpeg), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
}
