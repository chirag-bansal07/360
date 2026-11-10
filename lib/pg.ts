// Hosted storage: Neon Postgres. Used only when the app runs on Vercel.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let client: NeonQueryFunction<false, false> | null = null;
let ready: Promise<void> | null = null;

export function sql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    client = neon(url);
  }
  return client;
}

// Creates the tables on first use.
export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const q = sql();
      await q`create table if not exists users (
        id text primary key, email text not null unique, name text not null default '', pass text not null,
        failed int not null default 0, locked_until timestamptz, created_at timestamptz not null default now())`;
      await q`alter table users add column if not exists sv int not null default 0`; // session version: raised on sign-out
      await q`create table if not exists workspaces (
        user_id text primary key references users(id) on delete cascade, data jsonb not null, updated_at timestamptz not null default now())`;
      await q`create table if not exists rate_limits (key text primary key, n int not null, reset_at timestamptz not null)`;
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

// Counts one attempt for a key. Returns false once more than `max` attempts were made inside the time window.
export async function allow(key: string, max: number, windowSeconds: number): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql()`
    insert into rate_limits (key, n, reset_at) values (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
    on conflict (key) do update set
      n = case when rate_limits.reset_at < now() then 1 else rate_limits.n + 1 end,
      reset_at = case when rate_limits.reset_at < now() then now() + make_interval(secs => ${windowSeconds}) else rate_limits.reset_at end
    returning n`) as any[];
  return rows[0].n <= max;
}

// Session version of a user, remembered for a short time so pages and map tiles do not query on every request.
const seen = new Map<string, { sv: number | null; at: number }>();
export async function sessionVersion(userId: string): Promise<number | null> {
  const hit = seen.get(userId);
  if (hit && Date.now() - hit.at < 30000) return hit.sv;
  await ensureSchema();
  const rows = (await sql()`select sv from users where id = ${userId}`) as any[];
  const sv = rows.length ? (rows[0].sv as number) : null;
  if (seen.size > 5000) seen.clear();
  seen.set(userId, { sv, at: Date.now() });
  return sv;
}
export const forgetSession = (userId: string) => { seen.delete(userId); };
