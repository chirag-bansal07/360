import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, HOSTED, verifySession } from '@/lib/session';

// Guards every page and the data API.
//  - On this computer: requests must be addressed to a local host name (stops DNS-rebinding from other sites).
//  - Hosted: every page and API call needs a valid sign-in, except the sign-in page and its API.
//  - Always: changes (POST / PUT / DELETE) must come from the app's own pages (stops other sites from changing data).
// Extra local host names can be allowed with SUNMOUNT_HOSTS="name1,name2".
const LOCAL = ['localhost', '127.0.0.1', '[::1]'];
const extra = (process.env.SUNMOUNT_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
const hostName = (h: string) => h.toLowerCase().replace(/:\d+$/, '');
const deny = (msg: string, status = 403) => NextResponse.json({ error: msg }, { status });

export function proxy(req: NextRequest) {
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
    let user: string | null = null;
    try { user = verifySession(req.cookies.get(COOKIE)?.value); } catch { return deny('The server is not set up yet (missing session secret).', 500); }
    if (!user && !open) {
      if (isApi) return deny('Please sign in.', 401);
      return NextResponse.redirect(new URL('/login', req.url));
    }
    if (user && pathname === '/login') return NextResponse.redirect(new URL('/', req.url));
  } else if (pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
