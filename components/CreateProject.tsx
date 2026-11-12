'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import LocationPicker from './LocationPicker';
import { api } from '@/lib/client';
import { parseLatLng } from '@/lib/maplink';

export default function CreateProject({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<'map' | 'shed'>('map'); // shed = no map: the project starts from typed shed dimensions
  const [shed, setShed] = useState({ length: '40', width: '20', height: '6', tilt: '0', slopeAz: 180, setback: '0.3' });
  const sh = (k: string, v: string | number) => setShed((x) => ({ ...x, [k]: v }));
  const [loc, setLoc] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [matches, setMatches] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [f, setF] = useState({ name: '', clientName: '', phone: '', email: '', address: '', displayAddress: '', type: 'commercial' });
  const [matchNote, setMatchNote] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function place(lat: number, lng: number, label?: string) {
    setPos({ lat, lng }); setMatches([]); setMatchNote(''); setErr('');
    let address = label || '';
    if (!address) {
      try { address = (await api(`/api/geocode?lat=${lat}&lng=${lng}`)).address || ''; } catch { /* address stays as typed */ }
    }
    if (address) setF((s) => ({ ...s, address, displayAddress: s.displayAddress || address }));
  }

  async function find() {
    const t = loc.trim();
    if (!t) { setErr(mode === 'shed' ? 'Type the nearest town or city, or leave it empty.' : 'Paste a Google Maps link, coordinates, or type a place name.'); return; }
    setErr(''); setMatches([]); setMatchNote('');
    const direct = parseLatLng(t);
    if (direct && !direct.approx) return place(direct.lat, direct.lng);
    setBusy('find');
    try {
      if (/^https?:\/\//i.test(t)) {
        const r = await api('/api/maplink', 'POST', { text: t });
        if (r.results) { // the link names a place but has no position: offer the map matches, never guess
          setMatches(r.results);
          setMatchNote(`This link has no exact position in it, only the name “${r.name}”. ${r.match === 'exact' ? 'These are the map matches for that name' : r.match === 'near' ? 'The exact place is not on the map; these are the nearest areas found' : 'Nothing in India has this name; these matches are in other countries'}: pick one, then drag the pin onto the roof. For an exact pin, copy the coordinates from Google Maps instead.`);
        } else {
          await place(r.lat, r.lng);
          if (r.approx) setMatchNote('This link gives the centre of the map view, not an exact pin. Check the pin and drag it onto the roof.');
        }
      } else {
        const r = await api(`/api/geocode?q=${encodeURIComponent(t)}`);
        if (!r.results.length) setErr('No place found with that name. Try a nearby town, or paste a Google Maps link.');
        // only an exact match inside India is placed straight away; anything less sure is offered as a choice
        else if (r.results.length === 1 && r.match === 'exact') await place(r.results[0].lat, r.results[0].lng, r.results[0].label);
        else { setMatches(r.results); setMatchNote(r.match === 'near' ? 'The exact place is not on the map. These are the nearest areas found: pick one, then drag the pin onto the roof.' : r.match === 'abroad' ? 'Nothing in India has this name. These matches are in other countries: pick one only if that is really the site, or paste a Google Maps link instead.' : ''); }
      }
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  }

  async function create() {
    const L = Number(shed.length), W = Number(shed.width);
    if (mode === 'map' && !pos) { setErr('Set the project location first: paste a Google Maps link and press Find, or click on the map.'); return; }
    if (mode === 'shed' && (!(L >= 1 && L <= 1000) || !(W >= 1 && W <= 1000))) { setErr('Enter the shed length and width in metres.'); return; }
    if (!f.name.trim()) { setErr('Enter a project name.'); return; }
    if (!f.clientName.trim()) { setErr('Enter the client name.'); return; }
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) { setErr('The email address does not look right.'); return; }
    setBusy('create'); setErr('');
    try {
      if (mode === 'shed') {
        const r = await api('/api/projects', 'POST', { ...f, ...(pos || {}), noMap: true, shed: { length: L, width: W, height: Number(shed.height), tilt: Number(shed.tilt), slopeAz: shed.slopeAz, setback: Number(shed.setback) } });
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
                  <div className="shed-form">
                  <svg className="shed-plan" viewBox="0 0 200 110" role="img" aria-label="Shed outline">
                    {(() => {
                      const L = Math.max(Number(shed.length) || 1, 1), W = Math.max(Number(shed.width) || 1, 1), k = Math.min(150 / L, 70 / W), w = L * k, h = W * k, x = 100 - w / 2, y = 52 - h / 2;
                      return <>
                        <rect x={x} y={y} width={w} height={h} rx="2" fill="rgba(240,140,0,.12)" stroke="var(--sun-d)" strokeWidth="1.5" />
                        <text x="100" y={y + h + 12} textAnchor="middle" fontSize="9" fill="var(--ink2)">{shed.length || 0} m (east–west)</text>
                        <text x={x - 5} y="54" textAnchor="end" fontSize="9" fill="var(--ink2)">{shed.width || 0} m</text>
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
                  </div>
                  <p className="muted small" style={{ marginTop: 8 }}>
                    The project opens in the editor with this shed on plain ground, ready for panels. Everything can be changed there.{' '}
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
