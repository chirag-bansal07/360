'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Shell from '@/components/Shell';
import { api, fmtDate, apiKeep, peek } from '@/lib/client';

export default function Dashboard() {
  const [list, setList] = useState<any[] | null>(() => peek('/api/projects')?.projects ?? null);
  const [err, setErr] = useState('');
  useEffect(() => { apiKeep('/api/projects').then((r) => setList(r.projects)).catch((e) => setErr(e.message)); }, []);
  const designs = (list || []).reduce((s, p) => s + p.designCount, 0);
  const commercial = (list || []).filter((p) => p.type === 'commercial').length;
  return (
    <Shell>
      <div className="page-head"><h1>Dashboard</h1><Link className="btn primary" href="/projects?new=1">+ Create new project</Link></div>
      {err && <div className="error">{err}</div>}
      <div className="tiles">
        <div className="tile t1"><b>{list ? list.length : '–'}</b><span>Total projects</span></div>
        <div className="tile t2"><b>{list ? designs : '–'}</b><span>Total designs</span></div>
        <div className="tile t3"><b>{list ? commercial : '–'}</b><span>Commercial projects</span></div>
        <div className="tile t4"><b>{list ? list.length - commercial : '–'}</b><span>Residential projects</span></div>
      </div>
      <div className="card">
        <div className="card-head">Recent projects<Link href="/projects" className="btn sm">View all</Link></div>
        {list && list.length === 0 ? (
          <div className="empty"><h3>No projects yet</h3>Create your first project to start laying out panels.</div>
        ) : (
          <table className="table"><tbody>
            {(list || []).slice(0, 6).map((p) => (
              <tr key={p.id} className="click" onClick={() => (location.href = `/projects/${p.id}`)}>
                <td style={{ width: 80 }}>{p.thumb ? <img className="thumb" src={p.thumb} alt="" /> : <div className="thumb" />}</td>
                <td><b>{p.name}</b><span className="badge">{p.number}</span><div className="muted small">{p.address}</div></td>
                <td>{p.clientName}</td>
                <td className="muted">{fmtDate(p.createdAt)}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
    </Shell>
  );
}
