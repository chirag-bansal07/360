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
      await q`create table if not exists workspaces (
        user_id text primary key references users(id) on delete cascade, data jsonb not null, updated_at timestamptz not null default now())`;
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}
