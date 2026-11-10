import { NextResponse, type NextRequest } from 'next/server';

// Guards the data API. The app is meant to run on this computer only:
//  - requests must be addressed to a local host name (stops DNS-rebinding from other sites),
//  - changes (POST / PUT / DELETE) must come from the app's own pages (stops other sites from changing data).
// Extra host names can be allowed with SUNMOUNT_HOSTS="name1,name2".
const LOCAL = ['localhost', '127.0.0.1', '[::1]'];
const extra = (process.env.SUNMOUNT_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
const hostName = (h: string) => h.toLowerCase().replace(/:\d+$/, '');
const deny = (msg: string) => NextResponse.json({ error: msg }, { status: 403 });

export function proxy(req: NextRequest) {
  const host = req.headers.get('host') || '';
  if (![...LOCAL, ...extra].includes(hostName(host))) return deny('This address is not allowed.');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin');
    if (origin) {
      let o = '';
      try { o = new URL(origin).host.toLowerCase(); } catch { /* not a valid origin */ }
      if (o !== host.toLowerCase()) return deny('Request from another site was blocked.');
    }
    const site = req.headers.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') return deny('Request from another site was blocked.');
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
