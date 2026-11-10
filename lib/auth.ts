// Accounts for the hosted app: email + password, kept in the app's own database.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { cookies } from 'next/headers';
import { COOKIE, HOSTED, MAX_AGE, signSession, verifySession } from './session';
import { ensureSchema, sql } from './pg';
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

export async function startSession(userId: string) {
  (await cookies()).set(COOKIE, signSession(userId), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE });
}
export async function endSession() {
  (await cookies()).set(COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

// The signed-in user's id. Local mode has one built-in user.
export async function currentUserId(): Promise<string | null> {
  if (!HOSTED) return 'local';
  return verifySession((await cookies()).get(COOKIE)?.value);
}

export class AuthError extends Error {}
export async function requireUserId(): Promise<string> {
  const id = await currentUserId();
  if (!id) throw new AuthError('Please sign in.');
  return id;
}

// The first account can be created freely (the owner). After that a sign-up code is needed, if one is configured.
export async function signupState(): Promise<{ open: boolean; needsCode: boolean }> {
  await ensureSchema();
  const rows = (await sql()`select count(*)::int as n from users`) as any[];
  if (rows[0].n === 0) return { open: true, needsCode: false };
  return { open: !!process.env.SIGNUP_CODE, needsCode: true };
}
export function codeMatches(code: any): boolean {
  const want = Buffer.from(process.env.SIGNUP_CODE || ''), got = Buffer.from(String(code || ''));
  return want.length > 0 && want.length === got.length && timingSafeEqual(want, got);
}

export async function createUser(email: string, name: string, password: string): Promise<string | null> {
  await ensureSchema();
  const id = 'u' + uid() + uid();
  const pass = await hashPassword(password);
  const rows = (await sql()`insert into users (id, email, name, pass) values (${id}, ${email}, ${name}, ${pass}) on conflict (email) do nothing returning id`) as any[];
  return rows.length ? id : null;
}

// Checks a sign-in. Eight wrong passwords in a row lock the account for 15 minutes.
export async function login(email: string, password: string): Promise<{ id?: string; error?: string }> {
  await ensureSchema();
  const q = sql();
  const rows = (await q`select id, pass, failed, locked_until from users where email = ${email}`) as any[];
  const bad = { error: 'The email or password is not correct.' };
  if (!rows.length) { await hashPassword(password); return bad; } // same work either way
  const u = rows[0];
  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) return { error: 'Too many wrong attempts. Try again in 15 minutes.' };
  if (!(await checkPassword(password, u.pass))) {
    await q`update users set failed = failed + 1, locked_until = case when failed + 1 >= 8 then now() + interval '15 minutes' else null end where id = ${u.id}`;
    return bad;
  }
  await q`update users set failed = 0, locked_until = null where id = ${u.id}`;
  return { id: u.id };
}

export async function userInfo(id: string): Promise<{ email: string; name: string } | null> {
  await ensureSchema();
  const rows = (await sql()`select email, name from users where id = ${id}`) as any[];
  return rows[0] || null;
}
