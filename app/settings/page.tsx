'use client';
import { useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import Num from '@/components/Num';
import { api } from '@/lib/client';
import { BUILTIN_MODULES, DEFAULT_LOSSES, uid } from '@/lib/catalog';
import type { Settings } from '@/lib/types';

const LOSS_FIELDS: [keyof typeof DEFAULT_LOSSES, string, string, number, number, number][] = [
  ['irradianceAdjust', 'Irradiance adjustment', 'Raise or lower the weather data, e.g. -10 to match a more conservative dataset', -40, 40, 1],
  ['soiling', 'Soiling (dust)', '%', 0, 30, 0.5],
  ['lid', 'Light induced degradation', '%', 0, 10, 0.1],
  ['mismatch', 'Mismatch, modules and strings', '%', 0, 10, 0.1],
  ['dcWiring', 'DC wiring', '%', 0, 10, 0.1],
  ['inverterEff', 'Inverter efficiency', '% (not a loss: 96 means 4 % lost)', 50, 100, 0.1],
  ['acWiring', 'AC wiring', '%', 0, 10, 0.1],
  ['unavailability', 'System unavailability', '%', 0, 20, 0.1],
  ['tempCoeff', 'Module temperature coefficient', '% per °C, negative', -1, 0, 0.01],
  ['degradation', 'Yearly degradation', '% per year, shown in the report', 0, 5, 0.1],
];

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/settings').then((r) => setS(r.settings)).catch((e) => setMsg({ ok: false, text: e.message })); }, []);
  if (!s) return <Shell>{msg ? <div className="error">{msg.text}</div> : <p className="muted">Loading…</p>}</Shell>;

  const co = (k: string, v: string) => setS({ ...s, company: { ...s.company, [k]: v } });
  const logo = (file?: File) => {
    if (!file) return;
    if (file.size > 500000) { setMsg({ ok: false, text: 'The logo file is too large. Use an image under 500 KB.' }); return; }
    const fr = new FileReader();
    fr.onload = () => co('logo', String(fr.result));
    fr.readAsDataURL(file);
  };
  const mod = (i: number, k: string, v: any) => setS({ ...s, customModules: s.customModules.map((m, j) => (j === i ? { ...m, [k]: v } : m)) });
  async function save() {
    setBusy(true); setMsg(null);
    try { const r = await api('/api/settings', 'PUT', s); setS(r.settings); setMsg({ ok: true, text: 'Settings saved. Recalculate a design to apply changed loss values.' }); }
    catch (e: any) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  }

  return (
    <Shell>
      <div className="page-head"><h1>Settings</h1><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
      {msg && <div className={msg.ok ? 'okmsg' : 'error'} style={{ marginBottom: 14 }}>{msg.text}</div>}

      <div className="card"><div className="card-head">Your company (shown on reports)</div><div className="card-body" style={{ maxWidth: 620 }}>
        <div className="field"><label>Company name</label><input className="input" value={s.company.name} onChange={(e) => co('name', e.target.value)} /></div>
        <div className="field"><label>Email</label><input className="input" value={s.company.email} onChange={(e) => co('email', e.target.value)} /></div>
        <div className="field"><label>Phone</label><input className="input" value={s.company.phone} onChange={(e) => co('phone', e.target.value)} /></div>
        <div className="field"><label>Logo</label>
          <div className="row">
            {s.company.logo && <img src={s.company.logo} alt="Logo" style={{ height: 40, maxWidth: 140, objectFit: 'contain', border: '1px solid var(--line)', borderRadius: 6, padding: 3 }} />}
            <input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(e) => logo(e.target.files?.[0])} />
            {s.company.logo && <button className="btn sm" onClick={() => co('logo', '')}>Remove</button>}
          </div>
        </div>
      </div></div>

      <div className="card"><div className="card-head">Sharper satellite imagery (optional)</div><div className="card-body" style={{ maxWidth: 760 }}>
        <div className="field" style={{ gridTemplateColumns: '160px 1fr' }}><label>Google Maps API key</label>
          <input className="input" type="password" autoComplete="off" placeholder="Paste your own key here" value={s.googleMapsKey || ''} onChange={(e) => setS({ ...s, googleMapsKey: e.target.value })} />
        </div>
        <p className="muted small">Without a key the app uses free Esri imagery, which is soft in many Indian towns (about 0.3 to 0.5 m per pixel). With your own Google key the editor loads Google satellite imagery at zoom 20, which shows shed edges, skylights and turbo vents clearly.</p>
        <p className="muted small">To get a key: open Google Cloud Console, create a project, turn on billing, enable <b>Map Tiles API</b>, then create an API key under Credentials. Google gives a monthly free allowance; opening one design loads about 100 tiles. The key is stored only in this computer&apos;s data folder.</p>
        {s.googleMapsKey && <button className="btn sm" onClick={() => setS({ ...s, googleMapsKey: '' })}>Remove key</button>}
      </div></div>

      <div className="card"><div className="card-head">Solar modules<button className="btn sm" onClick={() => setS({ ...s, customModules: [...s.customModules, { id: 'c' + uid(), name: 'My module', watt: 590, length: 2.278, width: 1.134 }] })}>+ Add your own module</button></div>
        <table className="table">
          <thead><tr><th>Name</th><th>Power (W)</th><th>Length (m)</th><th>Width (m)</th><th /></tr></thead>
          <tbody>
            {s.customModules.map((m, i) => (
              <tr key={m.id}>
                <td><input className="input" value={m.name} onChange={(e) => mod(i, 'name', e.target.value)} /></td>
                <td style={{ width: 130 }}><Num className="input" value={m.watt} min={50} max={1000} step={5} onCommit={(v) => mod(i, 'watt', v)} /></td>
                <td style={{ width: 130 }}><Num className="input" value={m.length} min={0.5} max={3} step={0.001} onCommit={(v) => mod(i, 'length', v)} /></td>
                <td style={{ width: 130 }}><Num className="input" value={m.width} min={0.5} max={3} step={0.001} onCommit={(v) => mod(i, 'width', v)} /></td>
                <td style={{ width: 60 }}><button className="icon-btn danger" title="Remove" onClick={() => setS({ ...s, customModules: s.customModules.filter((_, j) => j !== i) })}>🗑</button></td>
              </tr>
            ))}
            {BUILTIN_MODULES.map((m) => <tr key={m.id}><td className="muted">{m.name} <span className="badge">built in</span></td><td className="muted">{m.watt}</td><td className="muted">{m.length}</td><td className="muted">{m.width}</td><td /></tr>)}
          </tbody>
        </table>
        <div className="card-body muted small">Add the exact make and model you quote (name, watt and datasheet size) so the report shows it. If a module is removed while a design still uses it, that design falls back to the first module in the list.</div>
      </div>

      <div className="card"><div className="card-head">Generation calculation<button className="btn sm" onClick={() => setS({ ...s, losses: DEFAULT_LOSSES })}>Reset to defaults</button></div><div className="card-body" style={{ maxWidth: 720 }}>
        {LOSS_FIELDS.map(([k, label, help, min, max, step]) => (
          <div className="field" key={k} style={{ gridTemplateColumns: '240px 130px 1fr' }}>
            <label>{label}</label>
            <Num className="input" value={s.losses[k]} min={min} max={max} step={step} onCommit={(v) => setS({ ...s, losses: { ...s.losses, [k]: v } })} />
            <span className="muted small">{help}</span>
          </div>
        ))}
        <p className="muted small">Weather data comes from NASA POWER (free, long-term monthly averages). It usually reads a little higher than paid datasets such as Meteonorm in North India; use “Irradiance adjustment” if you want more conservative numbers.</p>
      </div></div>
    </Shell>
  );
}
