import { json, getGoogleKey } from '@/lib/store';
import { pickImagery } from '@/lib/imagery';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  return json(await pickImagery(Number(u.searchParams.get('lat')), Number(u.searchParams.get('lng')), await getGoogleKey()));
}
