'use client';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import SceneView, { SceneHandle } from '@/components/SceneView';
import { useDesign } from '@/lib/useDesign';
import { api, fmt, fmt0, SHORT_MONTHS } from '@/lib/client';
import { designTotals } from '@/lib/geometry';
import { clockToSolar, dayOfYear, sunVector } from '@/lib/sun';
import type { ColorMode } from '@/lib/engine';

const clockLabel = (h: number) => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };

// The 3D view. With "share" it is the read-only view behind a shared link: no editing and no way into the rest of the app.
export default function ViewerScreen({ id, share }: { id?: string; share?: string }) {
  const { design, setDesign, project, settings, mods, error, stale, calculate, calcBusy, calcError } = useDesign(id, share);
  const scene = useRef<SceneHandle>(null);
  const [view, setView] = useState<'2d' | '3d'>('3d');
  const [shade, setShade] = useState(true);
  const [month, setMonth] = useState(5);
  const [hour, setHour] = useState(12);
  const [mode, setMode] = useState<ColorMode>('normal');
  const [editing, setEditing] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [changed, setChanged] = useState(0);
  const queue = useRef<Promise<any>>(Promise.resolve());

  const sun = useMemo(() => {
    if (!shade || !project || mode !== 'normal') return null;
    const n = dayOfYear(month, 21);
    return sunVector(project.lat, n, clockToSolar(hour, n, project.lng, project.utcOffset));
  }, [shade, month, hour, project, mode]);

  const events = useMemo(() => ({
    onTogglePanel: (bid: string, key: string, action: 'remove' | 'add') => {
      setDesign((d) => {
        if (!d) return d;
        const blocks = d.blocks.map((b) => (b.id !== bid ? b : { ...b, removed: action === 'remove' ? [...b.removed.filter((k) => k !== key), key] : b.removed.filter((k) => k !== key) }));
        queue.current = queue.current.then(() => api(`/api/designs/${id}`, 'PUT', { blocks })).then(() => setSaveErr('')).catch((e) => setSaveErr(e.message));
        return { ...d, blocks };
      });
      setChanged((n) => n + 1);
    },
  }), [id, setDesign]);

  if (!design || !project) return <div className="viewer" style={{ display: 'grid', placeItems: 'center', gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }}>{error ? <div className="error">{error}{!share && <> <Link href="/projects"><u>Back to projects</u></Link></>}</div> : 'Loading 3D view…'}</div>;
  const t = designTotals(design, mods), r = design.results;
  const quick = (m: number, h: number) => { setShade(true); setMode('normal'); setMonth(m); setHour(h); };

  return (
    <div className="viewer">
      <div className="viewer-top">
        {!share && <Link className="btn sm" href={`/designs/${id}`}>← Design summary</Link>}
        {settings?.company.logo ? <img className="top-logo" src={settings.company.logo} alt={settings.company.name} /> : <b>{settings?.company.name || 'SunCraft3D'}</b>}
        <span className="grow" />
        <div className="seg"><button className={view === '2d' ? 'on' : ''} onClick={() => setView('2d')}>Top view</button><button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>3D</button></div>
        <button className="btn sm" onClick={() => scene.current?.engine()?.fit()}>Fit to layout</button>
        {!share && <><Link className="btn sm" href={`/designs/${id}/edit`}>Open editor</Link>
        <Link className="btn sm primary" href={`/designs/${id}/report`}>Report (PDF)</Link></>}
      </div>
      <div className="ed-canvas">
        <SceneView ref={scene} lat={project.lat} lng={project.lng} plain={project.noMap} share={share} interactive={false} design={design} mods={mods} results={r}
          view={view} tool={editing ? 'panels' : 'select'} sun={sun} colorMode={mode} events={events} />
        <div className="hint">{editing ? 'Click a panel to remove it · click a faded slot to add a panel · changes save by themselves' : view === '3d' ? 'Drag to rotate · right-drag to pan · scroll to zoom' : 'Drag to pan · scroll to zoom'}</div>
      </div>
      <div className="viewer-side">
        <h2>{project.name}</h2>
        <div>{design.name}</div>
        <div className="muted small">{project.displayAddress || project.address}</div>
        <div className="vtiles">
          <div><span>Annual production</span><b>{r ? `${fmt0(r.annualAc)} kWh` : '-'}</b></div>
          <div><span>System size</span><b>{fmt(t.kwp)} kWp</b></div>
          <div><span>Modules</span><b>{t.modules}</b></div>
          <div><span>Performance ratio</span><b>{r ? `${fmt(r.pr)} %` : '-'}</b></div>
        </div>
        {!share && (stale || !r) && t.modules > 0 && (
          <div className="note" style={{ marginBottom: 10 }}>{r ? 'The layout changed, so the production figures are out of date.' : 'Production is not calculated yet.'}
            <button className="btn sm primary" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }} disabled={calcBusy} onClick={() => calculate(() => queue.current)}>{calcBusy ? 'Calculating…' : r ? 'Recalculate now' : 'Calculate generation'}</button>
          </div>
        )}
        {calcError && <div className="error">{calcError}</div>}

        {!share && <div className="vsec">
          <label className="switch">Add / remove panels by clicking<input type="checkbox" checked={editing} onChange={(e) => { setEditing(e.target.checked); if (e.target.checked) setMode('normal'); }} /></label>
          {editing && <div className="muted small">Click any panel on the shed to take it out. Removed places stay visible as faded slots; click one to put the panel back.{changed > 0 && <> <b>{changed}</b> change{changed > 1 ? 's' : ''} saved.</>}</div>}
          {saveErr && <div className="error" style={{ marginTop: 8 }}>Could not save: {saveErr}</div>}
        </div>}

        <div className="vsec">
          <label className="switch">Shading effects<input type="checkbox" checked={shade && mode === 'normal'} onChange={(e) => { setShade(e.target.checked); setMode('normal'); }} /></label>
          <div className="muted" style={{ fontWeight: 600, margin: '8px 0 4px' }}>Sun path simulation</div>
          <div className="kv"><span className="muted">Date</span><b>21 {SHORT_MONTHS[month]}</b></div>
          <input className="slider" type="range" min={0} max={11} value={month} onChange={(e) => quick(+e.target.value, hour)} />
          <div className="kv"><span className="muted">Time</span><b>{clockLabel(hour)}</b></div>
          <input className="slider" type="range" min={5} max={19} step={0.25} value={hour} onChange={(e) => quick(month, +e.target.value)} />
          <div className="muted" style={{ fontWeight: 600, marginTop: 10 }}>Quick view</div>
          <div className="quick">
            <button className="btn sm" onClick={() => quick(5, 9)}>Jun 21 | 9:00 AM</button><button className="btn sm" onClick={() => quick(5, 16)}>Jun 21 | 4:00 PM</button>
            <button className="btn sm" onClick={() => quick(11, 9)}>Dec 21 | 9:00 AM</button><button className="btn sm" onClick={() => quick(11, 16)}>Dec 21 | 4:00 PM</button>
          </div>
        </div>

        <div className="vsec">
          <label className="switch">Solar access map<input type="checkbox" disabled={!r} checked={mode === 'access'} onChange={(e) => { setMode(e.target.checked ? 'access' : 'normal'); setEditing(false); }} /></label>
          {mode === 'access' && <div className="legend">More shade<i style={{ background: 'linear-gradient(90deg,#d6363e,#f0c83c,#84cc46)' }} />Shadow free</div>}
          <label className="switch">Irradiance map<input type="checkbox" disabled={!r} checked={mode === 'irradiance'} onChange={(e) => { setMode(e.target.checked ? 'irradiance' : 'normal'); setEditing(false); }} /></label>
          {mode === 'irradiance' && <div className="legend">Lower<i style={{ background: 'linear-gradient(90deg,#962878,#f06e28,#f6ee28)' }} />Higher</div>}
          {!r && <div className="muted small">{share ? 'These maps are not available for this design yet.' : 'Calculate generation to see these maps.'}</div>}
          {r && stale && mode !== 'normal' && <div className="muted small">These colours are from the last calculation.</div>}
        </div>
        <div className="vsec muted small">Design by {settings?.company.name || 'SunCraft3D'}</div>
      </div>
    </div>
  );
}
