'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import Confirm from '@/components/Confirm';
import ShareDialog, { ShareIcon } from '@/components/ShareDialog';
import { api, fmtDate, fmtDateTime, fmt, fmt0 } from '@/lib/client';
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
  const [reports, setReports] = useState<any[] | null>(null);
  const [share, setShare] = useState<{ kind: 'view' | 'report'; url: string; name: string; designId?: string } | null>(null);
  const [delReport, setDelReport] = useState<any>(null);
  const loadReports = () => api(`/api/projects/${id}/reports`).then((r) => setReports(r.reports)).catch((e) => setErr(e.message));
  const load = () => api(`/api/projects/${id}`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); loadReports(); }, [id]);

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
  async function shareDesign(d: any) {
    try {
      const r = await api(`/api/designs/${d.id}/share`, 'POST');
      setErr(''); setShare({ kind: 'view', url: `${window.location.origin}/view/${r.token}`, name: d.name, designId: d.id });
    } catch (e: any) { setErr(e.message); }
  }
  async function stopShare() {
    try { await api(`/api/designs/${share!.designId}/share`, 'DELETE'); setShare(null); } catch (e: any) { setErr(e.message); setShare(null); }
  }
  async function removeReport() {
    try { await api(`/api/reports/${delReport.token}`, 'DELETE'); setDelReport(null); loadReports(); } catch (e: any) { setErr(e.message); setDelReport(null); }
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
                <div className="foot" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <Link href={`/designs/${d.id}`}><b>{d.name}</b><div className="muted small">{t.modules ? `${fmt(t.kwp)} kWp · ${t.modules} modules` : 'No panels yet'}</div></Link>
                  <div className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    <button className="icon-btn" title="Share the 3D model link" aria-label={`Share the 3D model link of ${d.name}`} onClick={() => shareDesign(d)}><ShareIcon /></button>
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

      <div className="card">
        <div className="card-head">Reports</div>
        {!reports ? <div className="card-body muted">Loading…</div> : reports.length === 0 ? (
          <div className="card-body empty">No reports yet. Open a design, press <b>Report (PDF)</b>, then <b>Download PDF</b> or <b>Share</b>. Every report made that way is listed here.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Design</th><th>Created</th><th>Plant size</th><th>Yearly generation</th><th /></tr></thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.token}>
                    <td><b>{r.designName}</b></td>
                    <td>{fmtDateTime(r.createdAt)}</td>
                    <td>{fmt(r.kwp)} kWp · {r.modules} modules</td>
                    <td>{fmt0(r.annualAc)} kWh</td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <a className="btn sm" href={`/report/${r.token}`} target="_blank" rel="noopener noreferrer">Open</a>
                        <button className="btn sm primary" onClick={() => setShare({ kind: 'report', url: `${window.location.origin}/report/${r.token}`, name: r.designName })}><ShareIcon /> Share PDF</button>
                        <button className="icon-btn danger" title="Delete report" aria-label={`Delete the report of ${r.designName}`} onClick={() => setDelReport(r)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {share && (share.kind === 'view'
        ? <ShareDialog title={`Share 3D model · ${share.name}`} url={share.url} text={`${p.name}: 3D solar plant layout`} note="Anyone with this link can open the 3D model and move around it. No sign-in is needed and nothing can be changed. The link always shows the design as it is now." onClose={() => setShare(null)} onOff={stopShare} />
        : <ShareDialog title={`Share report · ${share.name}`} url={share.url} text={`${p.name}: solar plant layout report`} note="Anyone with this link can open the report and save it as a PDF with its Download PDF button. No sign-in is needed. The report stays as it was when it was created." onClose={() => setShare(null)} />)}
      {delReport && <Confirm title="Delete report?" text={`The report of “${delReport.designName}” from ${fmtDateTime(delReport.createdAt)} will be deleted, and its link will stop working. This cannot be undone.`} action="Delete report" onYes={removeReport} onNo={() => setDelReport(null)} />}
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
