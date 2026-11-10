'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import CreateProject from '@/components/CreateProject';
import Confirm from '@/components/Confirm';
import { api, fmtDate } from '@/lib/client';

export default function Projects() {
  const router = useRouter();
  const [list, setList] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = () => api('/api/projects').then((r) => setList(r.projects)).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    if (new URLSearchParams(location.search).get('new')) setCreating(true);
  }, []);
  const shown = (list || []).filter((p) => `${p.name} ${p.clientName} ${p.address} ${p.number}`.toLowerCase().includes(q.trim().toLowerCase()));

  async function remove() {
    try { await api(`/api/projects/${del.id}`, 'DELETE'); setDel(null); load(); } catch (e: any) { setErr(e.message); setDel(null); }
  }

  return (
    <Shell>
      <div className="page-head">
        <h1>Projects</h1>
        <div className="row">
          <input className="input" style={{ width: 280 }} placeholder="Search by project, client or address" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn primary" onClick={() => setCreating(true)}>+ Create new project</button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="card">
        {list && list.length === 0 ? (
          <div className="empty"><h3>No projects yet</h3><p>A project is one site. Add its location, then lay out the panels.</p><button className="btn primary" onClick={() => setCreating(true)}>+ Create new project</button></div>
        ) : (
          <table className="table">
            <thead><tr><th colSpan={2}>Projects ({list ? shown.length : '…'})</th><th>Designs</th><th>Created on</th><th>Client name</th><th>Action</th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="click" onClick={() => router.push(`/projects/${p.id}`)}>
                  <td style={{ width: 80 }}>{p.thumb ? <img className="thumb" src={p.thumb} alt="" /> : <div className="thumb" />}</td>
                  <td><b>{p.name}</b><span className="badge">{p.number}</span><div className="muted small" style={{ fontStyle: 'italic' }}>{p.type}</div><div className="muted small">{p.address}</div></td>
                  <td>{p.designCount}</td>
                  <td>{fmtDate(p.createdAt)}</td>
                  <td>{p.clientName}</td>
                  <td><button className="icon-btn danger" title="Delete project" onClick={(e) => { e.stopPropagation(); setDel(p); }}>🗑</button></td>
                </tr>
              ))}
              {list && list.length > 0 && shown.length === 0 && <tr><td colSpan={6} className="empty">No project matches “{q}”.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {creating && <CreateProject onClose={() => setCreating(false)} />}
      {del && <Confirm title="Delete project?" text={`“${del.name}” and its ${del.designCount} design(s) will be deleted permanently. This cannot be undone.`} action="Delete project" onYes={remove} onNo={() => setDel(null)} />}
    </Shell>
  );
}
