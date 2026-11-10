import { json, fail } from '@/lib/store';
import { HOSTED } from '@/lib/session';
import { allow } from '@/lib/pg';
import { cleanEmail, codeMatches, createUser, currentUserId, endSession, login, LOGIN_FAILED, signupOpen, startSession, userInfo, validEmail } from '@/lib/auth';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ action: string }> };

// Vercel sets these headers itself, so the address cannot be faked by the caller.
const clientIp = (req: Request) => (req.headers.get('x-real-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || 'unknown').trim();

// GET /api/auth/me : who is signed in, and whether new accounts can be created.
export async function GET(_req: Request, ctx: Ctx) {
  const { action } = await ctx.params;
  if (action !== 'me') return fail('Not found.', 404);
  if (!HOSTED) return json({ hosted: false, user: null });
  const id = await currentUserId();
  const user = id ? await userInfo(id) : null;
  return json({ hosted: true, user, signupOpen: user ? false : signupOpen() });
}

// POST /api/auth/login | signup | logout
export async function POST(req: Request, ctx: Ctx) {
  const { action } = await ctx.params;
  if (!HOSTED) return fail('Sign-in is only used on the hosted app.', 404);
  if (action === 'logout') { await endSession(); return json({ ok: true }); }
  if (action !== 'login' && action !== 'signup') return fail('Not found.', 404);

  // at most 20 sign-in or sign-up attempts per address in 10 minutes
  if (!(await allow(`auth:${clientIp(req)}`, 20, 600))) return fail('Too many attempts from this connection. Wait 10 minutes and try again.', 429);

  const b = await req.json().catch(() => ({}));
  const email = cleanEmail(b.email), password = String(b.password || '');

  if (action === 'login') {
    if (!validEmail(email) || !password || password.length > 200) return fail('Enter your email and password.');
    const r = await login(email, password);
    if (!r) return fail(LOGIN_FAILED, 401);
    await startSession(r.id, r.version);
    return json({ ok: true });
  }

  if (!signupOpen()) return fail('New accounts are closed. Ask the owner of this app for access.', 403);
  if (!codeMatches(b.code)) return fail('The sign-up code is not correct.', 403);
  const name = String(b.name || '').trim().slice(0, 80);
  if (!validEmail(email)) return fail('Enter a valid email address.');
  if (password.length < 10 || password.length > 200) return fail('Use a password of at least 10 characters.');
  const id = await createUser(email, name, password);
  if (!id) return fail('An account with this email already exists. Sign in instead.', 409);
  await startSession(id, 0);
  return json({ ok: true });
}
