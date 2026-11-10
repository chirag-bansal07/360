'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [me, setMe] = useState<{ hosted: boolean; user: { email: string; name: string } | null } | null>(null);
  useEffect(() => { fetch('/api/auth/me').then((r) => r.json()).then(setMe).catch(() => {}); }, []);
  const signOut = async () => { await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); window.location.href = '/login'; };
  const on = (p: string) => (p === '/' ? path === '/' : path.startsWith(p));
  return (
    <div className="shell">
      <aside className="side">
        <Link href="/" className="brand"><span className="brand-mark" /><span>Sunmount<small>360</small></span></Link>
        <nav className="nav">
          <Link href="/" className={on('/') ? 'on' : ''}><Icon d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z" />Dashboard</Link>
          <Link href="/projects" className={on('/projects') || on('/designs') ? 'on' : ''}><Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />Projects</Link>
          <Link href="/settings" className={on('/settings') ? 'on' : ''}><Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.8-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.8H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.8-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.8 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.8h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />Settings</Link>
        </nav>
        <div className="side-foot">Solar plant layout planner<br />
          {me?.hosted
            ? <>{me.user ? <span style={{ wordBreak: 'break-all' }}>{me.user.name || me.user.email}</span> : null}<br /><a href="#" onClick={(e) => { e.preventDefault(); signOut(); }}>Sign out</a></>
            : 'Data is saved on this computer.'}
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
