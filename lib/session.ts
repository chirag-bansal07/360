// Signed login cookie. No database needed to check it, so the request guard (proxy.ts) can verify every request.
import { createHmac, timingSafeEqual } from 'crypto';

export const HOSTED = process.env.VERCEL === '1'; // on Vercel: database storage and login. On this computer: local file, no login.
export const COOKIE = 'sm_session';
export const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 32) throw new Error('SESSION_SECRET is not set');
  return s;
}
const mac = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url');

export function signSession(userId: string): string {
  const body = Buffer.from(JSON.stringify({ u: userId, e: Math.floor(Date.now() / 1000) + MAX_AGE })).toString('base64url');
  return `${body}.${mac(body)}`;
}

// Returns the user id, or null when the cookie is missing, altered or expired.
export function verifySession(token: string | undefined | null): string | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const a = Buffer.from(sig), b = Buffer.from(mac(body));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof p.u !== 'string' || typeof p.e !== 'number' || p.e < Date.now() / 1000) return null;
    return p.u;
  } catch {
    return null;
  }
}
