// Signed login cookie. The signature is checked without the database; the request guard (proxy.ts)
// also compares the session version with the database, so signing out cancels every existing cookie.
import { createHmac, timingSafeEqual } from 'crypto';

export const HOSTED = process.env.VERCEL === '1'; // on Vercel: database storage and login. On this computer: local file, no login.
export const COOKIE = 'sm_session';
export const MAX_AGE = 60 * 60 * 24 * 14; // 14 days

function secret(): string {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 32) throw new Error('SESSION_SECRET is not set');
  return s;
}
const mac = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url');

export function signSession(userId: string, version: number): string {
  const body = Buffer.from(JSON.stringify({ u: userId, v: version, e: Math.floor(Date.now() / 1000) + MAX_AGE })).toString('base64url');
  return `${body}.${mac(body)}`;
}

// Returns the user id and session version, or null when the cookie is missing, altered or expired.
export function verifySession(token: string | undefined | null): { userId: string; version: number } | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const a = Buffer.from(sig), b = Buffer.from(mac(body));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof p.u !== 'string' || typeof p.v !== 'number' || typeof p.e !== 'number' || p.e < Date.now() / 1000) return null;
    return { userId: p.u, version: p.v };
  } catch {
    return null;
  }
}
