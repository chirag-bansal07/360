import { json, getGoogleKey } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Tells the map screens whether Google imagery is available. The key itself never leaves the server.
export async function GET() {
  return json({ google: !!(await getGoogleKey()) });
}
