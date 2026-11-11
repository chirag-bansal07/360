import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, HOSTED, verifySession } from '@/lib/session';
import { sessionVersion } from '@/lib/pg';

// Guards every page and the data API.
//  - On this computer: requests must be addressed to a local host name (stops DNS-rebinding from other sites).
//  - Hosted: every page and API call needs a valid sign-in, except the sign-in page and its API.
//  - Always: changes (POST / PUT / DELETE) must come from the app's own pages (stops other sites from changing data).
// Extra local host names can be allowed with SUNCRAFT_HOSTS="name1,name2".
const LOCAL = ['localhost', '127.0.0.1', '[::1]'];
const extra = (process.env.SUNCRAFT_HOSTS || process.env.SUNMOUNT_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
const hostName = (h: string) => h.toLowerCase().replace(/:\d+$/, '');
const deny = (msg: string, status = 403) => NextResponse.json({ error: msg }, { status });

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');
  const host = req.headers.get('host') || '';

  if (!HOSTED && ![...LOCAL, ...extra].includes(hostName(host))) return deny('This address is not allowed.');

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

  if (HOSTED) {
    const open = pathname === '/login' || pathname.startsWith('/api/auth/');
    let signedIn = false;
    try {
      const s = verifySession(req.cookies.get(COOKIE)?.value);
      // the cookie must also carry the user's current session version (signing out raises it)
      if (s) signedIn = (await sessionVersion(s.userId, pathname.startsWith('/api/tile/'))) === s.version;
    } catch {
      return deny('The server is not ready (session check failed). Try again shortly.', 503);
    }
    if (!signedIn && !open) {
      if (isApi) return deny('Please sign in.', 401);
      return NextResponse.redirect(new URL('/login', req.url));
    }
    if (signedIn && pathname === '/login') return NextResponse.redirect(new URL('/', req.url));
    if (!signedIn && req.cookies.has(COOKIE) && open) {
      // a stale cookie must not reach the handlers behind the open paths
      const headers = new Headers(req.headers);
      headers.delete('cookie');
      const res = NextResponse.next({ request: { headers } });
      res.cookies.set(COOKIE, '', { path: '/', maxAge: 0 });
      return res;
    }
  } else if (pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
