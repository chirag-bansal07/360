'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import LocationPicker from './LocationPicker';
import { api } from '@/lib/client';
import { parseLatLng } from '@/lib/maplink';

export default function CreateProject({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [loc, setLoc] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [matches, setMatches] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [f, setF] = useState({ name: '', clientName: '', phone: '', email: '', address: '', displayAddress: '', type: 'commercial' });
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function place(lat: number, lng: number, label?: string) {
    setPos({ lat, lng }); setMatches([]); setErr('');
    let address = label || '';
    if (!address) {
      try { address = (await api(`/api/geocode?lat=${lat}&lng=${lng}`)).address || ''; } catch { /* address stays as typed */ }
    }
    if (address) setF((s) => ({ ...s, address, displayAddress: s.displayAddress || address }));
  }

  async function find() {
    const t = loc.trim();
    if (!t) { setErr('Paste a Google Maps link, coordinates, or type a place name.'); return; }
    setErr(''); setMatches([]);
    const direct = parseLatLng(t);
    if (direct) return place(direct.lat, direct.lng);
    setBusy('find');
    try {
      if (/^https?:\/\//i.test(t)) {
        const r = await api('/api/maplink', 'POST', { text: t });
        await place(r.lat, r.lng);
      } else {
        const r = await api(`/api/geocode?q=${encodeURIComponent(t)}`);
        if (!r.results.length) setErr('No place found with that name. Try a nearby town, or paste a Google Maps link.');
        else if (r.results.length === 1) await place(r.results[0].lat, r.results[0].lng, r.results[0].label);
        else setMatches(r.results);
      }
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  }

  async function create() {
    if (!pos) { setErr('Set the project location first: paste a Google Maps link and press Find, or click on the map.'); return; }
    if (!f.name.trim()) { setErr('Enter a project name.'); return; }
    if (!f.clientName.trim()) { setErr('Enter the client name.'); return; }
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) { setErr('The email address does not look right.'); return; }
    setBusy('create'); setErr('');
    try {
      const r = await api('/api/projects', 'POST', { ...f, ...pos });
      router.push(`/projects/${r.project.id}`);
    } catch (e: any) { setErr(e.message); setBusy(''); }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">Create a new project<button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">
          {err && <div className="error">{err}</div>}
          <div className="create-grid">
            <div>
              <div className="field">
                <label>Location <span className="req">*</span></label>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input className="input" autoFocus placeholder="Paste Google Maps link, coordinates, or type a place" value={loc}
                    onChange={(e) => setLoc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()} />
                  <button className="btn dark" onClick={find} disabled={busy === 'find'}>{busy === 'find' ? 'Finding…' : 'Find'}</button>
                </div>
              </div>
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
              <LocationPicker lat={pos?.lat ?? null} lng={pos?.lng ?? null} onChange={(a, b) => place(a, b)} />
              <p className="muted small" style={{ marginTop: 8 }}>
                {pos ? <>Pin at <b>{pos.lat.toFixed(6)}, {pos.lng.toFixed(6)}</b>. Drag the pin or click the map to put it exactly on the roof.</> : 'Find a location, or zoom in and click the map to drop the pin on the roof.'}
              </p>
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
