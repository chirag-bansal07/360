// Accounts for the hosted app: email + password, kept in the app's own database.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { cookies } from 'next/headers';
import { COOKIE, HOSTED, MAX_AGE, signSession, verifySession } from './session';
import { ensureSchema, forgetSession, sql } from './pg';
import { uid } from './catalog';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `s1$${salt.toString('base64url')}$${(await scrypt(pw, salt, 64)).toString('base64url')}`;
}
export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [v, salt, hash] = stored.split('$');
  if (v !== 's1' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = await scrypt(pw, Buffer.from(salt, 'base64url'), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

export const cleanEmail = (e: any) => String(e || '').trim().toLowerCase();
export const validEmail = (e: string) => e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function startSession(userId: string, version: number) {
  (await cookies()).set(COOKIE, signSession(userId, version), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE });
}
// Signing out raises the session version, which cancels the cookie on every device.
export async function endSession() {
  const jar = await cookies();
  const s = verifySession(jar.get(COOKIE)?.value);
  if (s) {
    await ensureSchema();
    await sql()`update users set sv = sv + 1 where id = ${s.userId} and sv = ${s.version}`;
    forgetSession(s.userId);
  }
  jar.set(COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

// The signed-in user's id. Local mode has one built-in user.
// The request guard (proxy.ts) has already checked the session version against the database.
export async function currentUserId(): Promise<string | null> {
  if (!HOSTED) return 'local';
  return verifySession((await cookies()).get(COOKIE)?.value)?.userId || null;
}

export class AuthError extends Error {}
export async function requireUserId(): Promise<string> {
  const id = await currentUserId();
  if (!id) throw new AuthError('Please sign in.');
  return id;
}

// Every new account needs the sign-up code (SIGNUP_CODE, at least 12 characters). Without one, sign-up is closed.
const signupCode = () => { const c = process.env.SIGNUP_CODE || ''; return c.length >= 12 ? c : ''; };
export const signupOpen = () => !!signupCode();
export function codeMatches(code: any): boolean {
  const want = Buffer.from(signupCode()), got = Buffer.from(String(code || ''));
  return want.length > 0 && want.length === got.length && timingSafeEqual(want, got);
}

export async function createUser(email: string, name: string, password: string): Promise<string | null> {
  await ensureSchema();
  const id = 'u' + uid() + uid();
  const pass = await hashPassword(password);
  // Every sign-up is a company login. The admin role is never granted here; it is only set directly in the database.
  const rows = (await sql()`insert into users (id, email, name, pass, role) values (${id}, ${email}, ${name}, ${pass}, 'company') on conflict (email) do nothing returning id`) as any[];
  return rows.length ? id : null;
}

// Checks a sign-in. The attempt is counted and the lock is checked in one database statement, so parallel
// guesses cannot slip past the limit: eight wrong passwords in a row lock the account for 15 minutes.
// Unknown email, wrong password and locked account all give the same answer.
export const LOGIN_FAILED = 'The email or password is not correct. After several wrong attempts an account is paused for 15 minutes.';
export async function login(email: string, password: string): Promise<{ id: string; version: number } | null> {
  await ensureSchema();
  const q = sql();
  const rows = (await q`
    update users set
      failed = case when locked_until is not null then 1 else failed + 1 end,
      locked_until = case when (case when locked_until is not null then 1 else failed + 1 end) >= 8 then now() + interval '15 minutes' else null end
    where email = ${email} and (locked_until is null or locked_until < now())
    returning id, pass, sv`) as any[];
  if (!rows.length) { await hashPassword(password); return null; } // unknown or locked: same work, same answer
  const u = rows[0];
  if (!(await checkPassword(password, u.pass))) return null;
  await q`update users set failed = 0, locked_until = null where id = ${u.id}`;
  return { id: u.id, version: u.sv };
}

export async function userInfo(id: string): Promise<{ email: string; name: string; role: 'admin' | 'company' } | null> {
  await ensureSchema();
  const rows = (await sql()`select email, name, role from users where id = ${id}`) as any[];
  return rows[0] || null;
}

// Whether a login may use the Google Solar API aerial picture. It is off unless switched on for that login
// (users.solar in the database). Everyone else gets Google map tiles only. On a local computer: SUNCRAFT_SOLAR=1.
export async function solarAllowed(userId?: string | null): Promise<boolean> {
  if (!HOSTED) return process.env.SUNCRAFT_SOLAR === '1';
  const id = userId || (await currentUserId());
  if (!id) return false;
  await ensureSchema();
  const rows = (await sql()`select solar from users where id = ${id}`) as any[];
  return rows[0]?.solar === true;
}

// The admin runs the app. On a local computer the single user is the admin.
export async function isAdmin(): Promise<boolean> {
  if (!HOSTED) return true;
  const id = await currentUserId();
  return !!id && (await userInfo(id))?.role === 'admin';
}
