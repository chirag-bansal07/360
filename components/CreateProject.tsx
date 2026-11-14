'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import LocationPicker from './LocationPicker';
import { api } from '@/lib/client';
import { parseLatLng } from '@/lib/maplink';

export default function CreateProject({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<'map' | 'shed'>('map'); // shed = no map: the project starts from typed shed dimensions
  // the sheds of a no-map project stand in a row from west to east, "gap" metres apart
  const [sheds, setSheds] = useState([{ length: '40', width: '20', height: '6', tilt: '0', slopeAz: 180, setback: '0.3' }]);
  const [at, setAt] = useState(0); // the shed being edited
  const [gap, setGap] = useState('3');
  const shed = sheds[Math.min(at, sheds.length - 1)];
  const sh = (k: string, v: string | number) => setSheds((l) => l.map((x, i) => (i === at ? { ...x, [k]: v } : x)));
  const addShed = () => { if (sheds.length >= 20) return; setSheds((l) => [...l, { ...l[l.length - 1] }]); setAt(sheds.length); };
  const dropShed = () => { setSheds((l) => l.filter((_, i) => i !== at)); setAt((i) => Math.max(0, Math.min(i, sheds.length - 2))); };
  const [loc, setLoc] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [matches, setMatches] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [f, setF] = useState({ name: '', clientName: '', phone: '', email: '', address: '', displayAddress: '', type: 'commercial' });
  const [matchNote, setMatchNote] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  // answers already received in this window: pressing Find again on the same text asks the server nothing
  const seen = useRef(new Map<string, any>());
  const once = async (key: string, ask: () => Promise<any>) => {
    if (!seen.current.has(key)) seen.current.set(key, await ask());
    return seen.current.get(key);
  };

  async function place(lat: number, lng: number, label?: string) {
    setPos({ lat, lng }); setMatches([]); setMatchNote(''); setErr('');
    let address = label || '';
    if (!address) {
      try { address = (await once(`at:${lat.toFixed(5)},${lng.toFixed(5)}`, () => api(`/api/geocode?lat=${lat}&lng=${lng}`))).address || ''; } catch { /* address stays as typed */ }
    }
    if (address) setF((s) => ({ ...s, address, displayAddress: s.displayAddress || address }));
  }

  async function find() {
    if (busy) return; // a search is already running
    const t = loc.trim();
    if (!t) { setErr(mode === 'shed' ? 'Type the nearest town or city, or leave it empty.' : 'Paste a Google Maps link, coordinates, or type a place name.'); return; }
    setErr(''); setMatches([]); setMatchNote('');
    const direct = parseLatLng(t);
    setBusy('find');
    if (direct && !direct.approx) { await place(direct.lat, direct.lng); setBusy(''); return; }
    try {
      if (/^https?:\/\//i.test(t)) {
        const r = await once(`link:${t}`, () => api('/api/maplink', 'POST', { text: t }));
        if (r.results) { // the link names a place but has no position: offer the map matches, never guess
          setMatches(r.results);
          setMatchNote(`This link has no exact position in it, only the name “${r.name}”. ${r.match === 'exact' ? 'These are the map matches for that name' : r.match === 'near' ? 'The exact place is not on the map; these are the nearest areas found' : 'Nothing in India has this name; these matches are in other countries'}: pick one, then drag the pin onto the roof. For an exact pin, copy the coordinates from Google Maps instead.`);
        } else {
          await place(r.lat, r.lng);
          if (r.approx) setMatchNote('This link gives the centre of the map view, not an exact pin. Check the pin and drag it onto the roof.');
        }
      } else {
        const r = await once(`q:${t.toLowerCase()}`, () => api(`/api/geocode?q=${encodeURIComponent(t)}`));
        if (!r.results.length) setErr('No place found with that name. Try a nearby town, or paste a Google Maps link.');
        // only an exact match inside India is placed straight away; anything less sure is offered as a choice
        else if (r.results.length === 1 && r.match === 'exact') await place(r.results[0].lat, r.results[0].lng, r.results[0].label);
        else { setMatches(r.results); setMatchNote(r.match === 'near' ? 'The exact place is not on the map. These are the nearest areas found: pick one, then drag the pin onto the roof.' : r.match === 'abroad' ? 'Nothing in India has this name. These matches are in other countries: pick one only if that is really the site, or paste a Google Maps link instead.' : ''); }
      }
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  }

  async function create() {
    const bad = sheds.findIndex((s) => !(Number(s.length) >= 1 && Number(s.length) <= 1000) || !(Number(s.width) >= 1 && Number(s.width) <= 1000));
    if (mode === 'map' && !pos) { setErr('Set the project location first: paste a Google Maps link and press Find, or click on the map.'); return; }
    if (mode === 'shed' && bad >= 0) { setAt(bad); setErr(`Enter the length and width of shed ${bad + 1} in metres.`); return; }
    if (!f.name.trim()) { setErr('Enter a project name.'); return; }
    if (!f.clientName.trim()) { setErr('Enter the client name.'); return; }
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) { setErr('The email address does not look right.'); return; }
    setBusy('create'); setErr('');
    try {
      if (mode === 'shed') {
        const r = await api('/api/projects', 'POST', { ...f, ...(pos || {}), noMap: true, gap: Number(gap), sheds: sheds.map((s) => ({ length: Number(s.length), width: Number(s.width), height: Number(s.height), tilt: Number(s.tilt), slopeAz: s.slopeAz, setback: Number(s.setback) })) });
        router.push(`/designs/${r.project.designs[0].id}/edit`); // straight to the editor: the shed is already there
        return;
      }
      const r = await api('/api/projects', 'POST', { ...f, ...pos });
      router.push(`/projects/${r.project.id}`);
    } catch (e: any) { setErr(e.message); setBusy(''); }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">Create a new project<button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">
          <div className="seg" style={{ marginBottom: 14 }}>
            <button className={mode === 'map' ? 'on' : ''} onClick={() => { setMode('map'); setErr(''); }}>Find on the map</button>
            <button className={mode === 'shed' ? 'on' : ''} onClick={() => { setMode('shed'); setErr(''); }}>Shed dimensions (no map)</button>
          </div>
          {err && <div className="error">{err}</div>}
          <div className="create-grid">
            <div>
              <div className="field">
                <label>{mode === 'shed' ? 'Nearest town' : <>Location <span className="req">*</span></>}</label>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input className="input" autoFocus placeholder={mode === 'shed' ? 'Optional: town or city, for sun and weather' : 'Paste Google Maps link, coordinates, or type a place'} value={loc}
                    onChange={(e) => setLoc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()} />
                  <button className="btn dark" onClick={find} disabled={busy === 'find'}>{busy === 'find' ? 'Finding…' : 'Find'}</button>
                </div>
              </div>
              {matchNote && <p className="muted small" style={{ margin: '0 0 6px' }}>{matchNote}</p>}
              {matches.length > 0 && (
                <div className="results-list">{matches.map((m, i) => <button key={i} onClick={() => place(m.lat, m.lng, m.label)}>{m.label}</button>)}</div>
              )}
              <div className="field"><label>Project name <span className="req">*</span></label><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
              <div className="field"><label>Client name <span className="req">*</span></label><input className="input" value={f.clientName} onChange={(e) => set('clientName', e.target.value)} /></div>
              <div className="field"><label>Client number</label><input className="input" placeholder="+91" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
              <div className="field"><label>Email</label><input className="input" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
              <div className="field"><label>Display address</label><input className="input" placeholder="Address to show in the report" value={f.displayAddress} onChange={(e) => set('displayAddress', e.target.value)} /></div>
              <div className="field">
                <label>Project type</label>
                <div className="seg">
                  <button className={f.type === 'residential' ? 'on' : ''} onClick={() => set('type', 'residential')}>Residential</button>
                  <button className={f.type === 'commercial' ? 'on' : ''} onClick={() => set('type', 'commercial')}>Commercial</button>
                </div>
              </div>
            </div>
            <div>
              {mode === 'map' ? (<>
              <LocationPicker lat={pos?.lat ?? null} lng={pos?.lng ?? null} address={pos ? f.address : ''} onChange={(a, b) => place(a, b)} />
              <p className="muted small" style={{ marginTop: 8 }}>
                {pos ? <>Pin at <b>{pos.lat.toFixed(6)}, {pos.lng.toFixed(6)}</b>. Drag the pin or click the map to put it exactly on the roof.</> : 'Find a location, or zoom in and click the map to drop the pin on the roof.'}
              </p>
              </>) : (
                <div>
                  <div className="shed-tabs">
                    {sheds.map((_, i) => <button key={i} className={i === at ? 'on' : ''} onClick={() => setAt(i)}>Shed {i + 1}</button>)}
                    {sheds.length < 20 && <button className="add" onClick={addShed} title="Add another shed with the same size, then change it">+ Add shed</button>}
                  </div>
                  <div className="shed-form">
                  <svg className="shed-plan" viewBox="0 0 200 110" role="img" aria-label="Shed outline">
                    {(() => {
                      const dims = sheds.map((s) => ({ L: Math.max(Number(s.length) || 1, 1), W: Math.max(Number(s.width) || 1, 1) }));
                      const G = sheds.length > 1 ? Math.max(Number(gap) || 0, 0) : 0, total = dims.reduce((s, d) => s + d.L, 0) + G * (dims.length - 1), deep = Math.max(...dims.map((d) => d.W));
                      const k = Math.min(150 / total, 70 / deep);
                      let x = 100 - (total * k) / 2;
                      const one = dims.length === 1;
                      return <>
                        {dims.map((d, i) => {
                          const w = d.L * k, h = d.W * k, x0 = x, y = 52 - h / 2; x += (d.L + G) * k;
                          return <g key={i} onClick={() => setAt(i)} style={{ cursor: 'pointer' }}>
                            <rect x={x0} y={y} width={w} height={h} rx="2" fill={i === at ? 'rgba(240,140,0,.22)' : 'rgba(240,140,0,.08)'} stroke="var(--sun-d)" strokeWidth={i === at ? 1.8 : 1} />
                            {!one && <text x={x0 + w / 2} y="55" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--ink2)">{i + 1}</text>}
                            {one && <text x={x0 - 5} y="54" textAnchor="end" fontSize="9" fill="var(--ink2)">{shed.width || 0} m</text>}
                          </g>;
                        })}
                        <text x="100" y={52 + (deep * k) / 2 + 12} textAnchor="middle" fontSize="9" fill="var(--ink2)">{one ? `${shed.length || 0} m (east–west)` : `${dims.length} sheds in a row, west to east · ${Math.round(total * 10) / 10} m in all`}</text>
                        <text x="192" y="12" textAnchor="end" fontSize="9" fontWeight="700" fill="var(--ink2)">N ↑</text>
                      </>;
                    })()}
                  </svg>
                  <div className="field"><label>Length<br /><span className="muted small">east to west, m</span></label><input className="input" type="number" min={0} step={0.5} value={shed.length} onChange={(e) => sh('length', e.target.value)} /></div>
                  <div className="field"><label>Width<br /><span className="muted small">north to south, m</span></label><input className="input" type="number" min={0} step={0.5} value={shed.width} onChange={(e) => sh('width', e.target.value)} /></div>
                  <div className="field"><label>Roof height<br /><span className="muted small">at the lowest edge, m</span></label><input className="input" type="number" min={0} step={0.5} value={shed.height} onChange={(e) => sh('height', e.target.value)} /></div>
                  <div className="field"><label>Roof tilt<br /><span className="muted small">0 = flat roof, degrees</span></label><input className="input" type="number" min={0} step={0.5} value={shed.tilt} onChange={(e) => sh('tilt', e.target.value)} /></div>
                  {Number(shed.tilt) > 0 && (
                    <div className="field"><label>Slopes down to</label>
                      <div className="seg">{[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([l, az]) => <button key={l} className={shed.slopeAz === az ? 'on' : ''} onClick={() => sh('slopeAz', az as number)}>{l}</button>)}</div>
                    </div>
                  )}
                  <div className="field"><label>Edge margin<br /><span className="muted small">kept free of panels, m</span></label><input className="input" type="number" min={0} step={0.05} value={shed.setback} onChange={(e) => sh('setback', e.target.value)} /></div>
                  {sheds.length > 1 && <>
                    <div className="field"><label>Gap between sheds<br /><span className="muted small">same for all, m</span></label><input className="input" type="number" min={0} step={0.5} value={gap} onChange={(e) => setGap(e.target.value)} /></div>
                    <div className="field"><label>Shed {at + 1}</label><button className="btn" onClick={dropShed}>Remove this shed</button></div>
                  </>}
                  </div>
                  <p className="muted small" style={{ marginTop: 8 }}>
                    The project opens in the editor with {sheds.length > 1 ? `these ${sheds.length} sheds` : 'this shed'} on plain ground, ready for panels. Everything can be changed there, and more sheds can be added.{' '}
                    {pos ? <>Sun and weather data: <b>{f.address || `${pos.lat.toFixed(3)}, ${pos.lng.toFixed(3)}`}</b>.</> : <>No town set: generation figures will use central India and are only approximate. Add the nearest town for accurate figures.</>}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={create} disabled={busy === 'create'}>{busy === 'create' ? 'Creating…' : 'Create project'}</button>
        </div>
      </div>
    </div>
  );
}
