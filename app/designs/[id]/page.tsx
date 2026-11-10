'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Shell from '@/components/Shell';
import { useDesign } from '@/lib/useDesign';
import { designTotals } from '@/lib/geometry';
import { fmt, fmt0, fmtDate, SHORT_MONTHS } from '@/lib/client';

export default function DesignSummary() {
  const { id } = useParams<{ id: string }>();
  const { design, project, mods, error, stale, calculate, calcBusy, calcError } = useDesign(id);
  if (!design || !project) return <Shell>{error ? <div className="error">{error} <Link href="/projects"><u>Back to projects</u></Link></div> : <p className="muted">Loading…</p>}</Shell>;
  const t = designTotals(design, mods), r = design.results;
  const max = r ? Math.max(...r.monthly.map((m) => m.ac), 1) : 1;
  return (
    <Shell>
      <div className="crumbs"><Link href="/projects">Projects</Link> / <Link href={`/projects/${project.id}`}>{project.name}</Link> / Design summary</div>
      <div className="page-head">
        <h1>{design.name}</h1>
        <div className="row">
          <Link className="btn" href={`/designs/${id}/view`}>3D view ↗</Link>
          <Link className="btn primary" href={`/designs/${id}/report`}>Report (PDF) ↗</Link>
        </div>
      </div>
      <div className="two-col">
        <div>
          <div className="card">
            <div className="card-head">Design information</div>
            <div className="card-body info" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
              <div><span>Nameplate DC size</span><b>{fmt(t.kwp)} kWp</b></div>
              <div><span>Total AC size</span><b>{fmt(t.acKw)} kW</b></div>
              <div><span>DC:AC ratio</span><b>{t.acKw ? fmt(t.ratio) : '-'}</b></div>
              <div><span>Modules</span><b>{t.modules}</b></div>
              <div><span>Performance ratio</span><b>{r ? `${fmt(r.pr)} %` : '-'}</b></div>
              <div><span>Specific generation</span><b>{r ? `${fmt(r.specific)} kWh/kWp/yr` : '-'}</b></div>
              <div><span>Last modified</span><b>{fmtDate(design.updatedAt)}</b></div>
              <div><span>Shadow-free time</span><b>{r ? `${fmt(r.shadeFreePct)} %` : '-'}</b></div>
              <div><span>Weather data</span><b>{r ? r.source : '-'}</b></div>
            </div>
          </div>
          <div className="card">
            <div className="card-head">Generation analysis
              <button className="btn sm" disabled={calcBusy || t.modules === 0} onClick={() => calculate()}>{calcBusy ? 'Calculating…' : r ? 'Recalculate' : 'Calculate generation'}</button>
            </div>
            <div className="card-body">
              {calcError && <div className="error">{calcError}</div>}
              {stale && <div className="note" style={{ marginBottom: 12 }}>The layout changed after these numbers were calculated. Press Recalculate to update them.</div>}
              {!r ? (
                <div className="empty">{t.modules === 0 ? <>No panels in this design yet. <Link href={`/designs/${id}/edit`}><u>Open the editor</u></Link> and add a panel block.</> : 'Press “Calculate generation” to estimate the yearly production.'}</div>
              ) : (
                <>
                  <div className="muted small">Total generation, first year</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{fmt(r.annualAc / 1000)} MWh</div>
                  <div className="bars">
                    {r.monthly.map((m, i) => (
                      <div className="bar" key={i} title={`${m.month}: ${fmt0(m.ac)} kWh`}><em>{fmt0(m.ac / 1000)}k</em><i style={{ height: `${(m.ac / max) * 82}%` }} /><span>{SHORT_MONTHS[i]}</span></div>
                    ))}
                  </div>
                  <div className="muted small" style={{ marginTop: 8 }}>AC energy per month (kWh)</div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="card">
          {design.thumb ? <img className="layout-pic" src={design.thumb} alt="Layout" /> : <div className="layout-pic" style={{ display: 'grid', placeItems: 'center' }}><span className="muted">No layout yet</span></div>}
          <Link href={`/designs/${id}/edit`} className="btn primary" style={{ width: '100%', justifyContent: 'center', borderRadius: 0, padding: 12 }}>Edit design</Link>
        </div>
      </div>
    </Shell>
  );
}
