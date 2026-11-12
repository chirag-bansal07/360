'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import Confirm from '@/components/Confirm';
import { api, fmtDate, fmt } from '@/lib/client';
import { allModules } from '@/lib/catalog';
import { designTotals } from '@/lib/geometry';

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api(`/api/projects/${id}`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);

  if (!data) return <Shell>{err ? <div className="error">{err} <Link href="/projects"><u>Back to projects</u></Link></div> : <p className="muted">Loading…</p>}</Shell>;
  const p = data.project, mods = allModules(data.settings);

  async function saveEdit() {
    try { await api(`/api/projects/${id}`, 'PATCH', edit); setEdit(null); setErr(''); load(); } catch (e: any) { setErr(e.message); }
  }
  async function addDesign(copyFrom?: string) {
    setBusy(true);
    try {
      const r = await api(`/api/projects/${id}/designs`, 'POST', copyFrom ? { copyFrom } : {});
      if (copyFrom) load(); else router.push(`/designs/${r.design.id}/edit`);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  async function removeDesign() {
    try { await api(`/api/designs/${del.id}`, 'DELETE'); setDel(null); load(); } catch (e: any) { setErr(e.message); setDel(null); }
  }

  return (
    <Shell>
      <div className="crumbs"><Link href="/projects">Projects</Link> / Project summary</div>
      <div className="page-head"><h1>{p.name}<span className="badge">{p.number}</span></h1></div>
      {err && <div className="error">{err}</div>}

      <div className="card">
        <div className="card-head">Project information<button className="btn sm" onClick={() => setEdit({ name: p.name, clientName: p.clientName, phone: p.phone, email: p.email, displayAddress: p.displayAddress, type: p.type })}>✎ Edit</button></div>
        <div className="card-body info">
          <div><span>Project name</span><b>{p.name}</b></div>
          <div><span>Client name</span><b>{p.clientName}</b></div>
          <div><span>Contact number</span><b>{p.phone || '-'}</b></div>
          <div><span>Email</span><b>{p.email || '-'}</b></div>
          <div><span>Project address</span><b>{p.address || '-'}</b></div>
          <div><span>Display address</span><b>{p.displayAddress || '-'}</b></div>
          <div><span>Location</span><b>{p.noMap ? `No map (shed dimensions). Sun and weather: ${p.address || 'central India'}` : `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}</b></div>
          <div><span>Created on</span><b>{fmtDate(p.createdAt)} · {p.type}</b></div>
          <div><span>Weather data</span><b>{p.weather ? p.weather.source : 'Downloaded at first calculation'}</b></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">Designs</div>
        <div className="card-body design-cards">
          {p.designs.map((d: any) => {
            const t = designTotals(d, mods);
            return (
              <div className="design-card" key={d.id}>
                <Link href={`/designs/${d.id}`}><div className="pic" style={d.thumb ? { backgroundImage: `url(${d.thumb})` } : undefined}>{!d.thumb && 'Empty design'}</div></Link>
                <div className="foot">
                  <Link href={`/designs/${d.id}`}><b>{d.name}</b><div className="muted small">{t.modules ? `${fmt(t.kwp)} kWp · ${t.modules} modules` : 'No panels yet'}</div></Link>
                  <div className="row" style={{ gap: 4 }}>
                    <Link className="icon-btn" title="Edit design" href={`/designs/${d.id}/edit`}>✎</Link>
                    <button className="icon-btn" title="Duplicate design" disabled={busy} onClick={() => addDesign(d.id)}>⧉</button>
                    <button className="icon-btn danger" title="Delete design" onClick={() => setDel(d)}>🗑</button>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="design-card add" onClick={() => !busy && addDesign()}><div style={{ textAlign: 'center' }}><div style={{ fontSize: 34, lineHeight: 1 }}>⊕</div>Add new design</div></div>
        </div>
      </div>

      {edit && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setEdit(null)}>
          <div className="modal" style={{ width: 'min(560px,100%)' }}>
            <div className="modal-head">Edit project information</div>
            <div className="modal-body">
              {[['name', 'Project name'], ['clientName', 'Client name'], ['phone', 'Client number'], ['email', 'Email'], ['displayAddress', 'Display address']].map(([k, label]) => (
                <div className="field" key={k}><label>{label}</label><input className="input" value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></div>
              ))}
              <div className="field"><label>Project type</label>
                <div className="seg">{['residential', 'commercial'].map((t) => <button key={t} className={edit.type === t ? 'on' : ''} onClick={() => setEdit({ ...edit, type: t })}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
              </div>
              <p className="muted small">The location cannot be changed after creation, because the panel layout is tied to it. Create a new project for a different site.</p>
            </div>
            <div className="modal-foot"><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={saveEdit}>Save</button></div>
          </div>
        </div>
      )}
      {del && <Confirm title="Delete design?" text={`“${del.name}” will be deleted permanently. This cannot be undone.`} action="Delete design" onYes={removeDesign} onNo={() => setDel(null)} />}
    </Shell>
  );
}
