import { json, getGoogleKey } from '@/lib/store';
import { guard } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Tells the map screens whether Google imagery is available. The key itself never leaves the server.
export const GET = guard(async function GET() {
  return json({ google: !!(await getGoogleKey()) });
});
