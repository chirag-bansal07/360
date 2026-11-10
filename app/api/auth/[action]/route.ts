import { json, fail } from '@/lib/store';
import { HOSTED } from '@/lib/session';
import { cleanEmail, codeMatches, createUser, currentUserId, endSession, login, signupState, startSession, userInfo, validEmail } from '@/lib/auth';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ action: string }> };

// GET /api/auth/me : who is signed in, and whether new accounts can be created.
export async function GET(_req: Request, ctx: Ctx) {
  const { action } = await ctx.params;
  if (action !== 'me') return fail('Not found.', 404);
  if (!HOSTED) return json({ hosted: false, user: null });
  const id = await currentUserId();
  const user = id ? await userInfo(id) : null;
  return json({ hosted: true, user, signup: user ? null : await signupState() });
}

// POST /api/auth/login | signup | logout
export async function POST(req: Request, ctx: Ctx) {
  const { action } = await ctx.params;
  if (!HOSTED) return fail('Sign-in is only used on the hosted app.', 404);
  if (action === 'logout') { await endSession(); return json({ ok: true }); }

  const b = await req.json().catch(() => ({}));
  const email = cleanEmail(b.email), password = String(b.password || '');

  if (action === 'login') {
    if (!validEmail(email) || !password) return fail('Enter your email and password.');
    const r = await login(email, password);
    if (!r.id) return fail(r.error || 'Could not sign in.', 401);
    await startSession(r.id);
    return json({ ok: true });
  }

  if (action === 'signup') {
    const state = await signupState();
    if (!state.open) return fail('New accounts are closed. Ask the owner of this app for access.', 403);
    if (state.needsCode && !codeMatches(b.code)) return fail('The sign-up code is not correct.', 403);
    const name = String(b.name || '').trim().slice(0, 80);
    if (!validEmail(email)) return fail('Enter a valid email address.');
    if (password.length < 10 || password.length > 200) return fail('Use a password of at least 10 characters.');
    const id = await createUser(email, name, password);
    if (!id) return fail('An account with this email already exists. Sign in instead.', 409);
    await startSession(id);
    return json({ ok: true });
  }
  return fail('Not found.', 404);
}
