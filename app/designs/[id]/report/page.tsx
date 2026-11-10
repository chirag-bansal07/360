'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import SceneView, { SceneHandle } from '@/components/SceneView';
import { useDesign } from '@/lib/useDesign';
import { fmt, fmt0, fmtDateTime, SHORT_MONTHS } from '@/lib/client';
import { designTotals } from '@/lib/geometry';
import { clockToSolar, dayOfYear, sunVector } from '@/lib/sun';

type Pics = { top: string; jun9: string; jun17: string; dec9: string; dec17: string; irr: string; access: string };


export default function Report() {
  const { id } = useParams<{ id: string }>();
  const { design, project, settings, mods, error, stale, calculate, calcBusy, calcError } = useDesign(id);
  const scene = useRef<SceneHandle>(null);
  const [pics, setPics] = useState<Pics | null>(null);
  const [now] = useState(() => new Date().toISOString());
  const [CREDIT, setCredit] = useState('Imagery © Esri, Maxar, Earthstar Geographics');
  const ready = !!design && !!project;
  const resKey = design?.results?.calculatedAt || '';

  // draw the layout pictures once the satellite image has loaded
  useEffect(() => {
    if (!ready) return;
    let dead = false, tries = 0;
    setPics(null);
    const run = async () => {
      const e = scene.current?.engine();
      if (!e) { if (tries++ < 100 && !dead) setTimeout(run, 150); return; }
      await e.ready;
      setCredit(e.credit);
      await new Promise((r) => setTimeout(r, 150));
      if (dead) return;
      const sun = (m: number, h: number) => { const n = dayOfYear(m, 21); return sunVector(project!.lat, n, clockToSolar(h, n, project!.lng, project!.utcOffset)); };
      setPics({
        top: e.snapshot({ size: 1000 }),
        jun9: e.snapshot({ size: 800, sun: sun(5, 9) }), jun17: e.snapshot({ size: 800, sun: sun(5, 17) }),
        dec9: e.snapshot({ size: 800, sun: sun(11, 9) }), dec17: e.snapshot({ size: 800, sun: sun(11, 17) }),
        irr: e.snapshot({ size: 800, colorMode: 'irradiance' }), access: e.snapshot({ size: 800, colorMode: 'access' }),
      });
    };
    run();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, resKey]);

  if (!design || !project || !settings) return <div style={{ padding: 40 }}>{error ? <div className="error">{error} <Link href="/projects"><u>Back to projects</u></Link></div> : 'Preparing report…'}</div>;
  const t = designTotals(design, mods), r = design.results, co = settings.company;
  const Foot = () => (
    <div className="rp-foot">{co.logo ? <img src={co.logo} alt="" /> : <span className="mark" />}<span><b style={{ color: '#2a2f36' }}>{co.name}</b><br />Generated on {fmtDateTime(now)}</span></div>
  );
  const Img = ({ src }: { src?: string }) => (src ? <img src={src} alt="" /> : <div style={{ aspectRatio: '1', maxHeight: '125mm', background: '#dfe5ea', display: 'grid', placeItems: 'center', color: '#6b7a90' }}>Drawing…</div>);
  const maxM = r ? Math.max(...r.monthly.map((m) => m.ac), 1) : 1;
  const axisMax = Math.ceil(maxM / 10000) * 10000 || 1;
  const maxIrr = r ? r.losses[0].value : 1, maxE = r ? (r.losses.find((l) => l.stage === 'dc')?.value || 1) : 1;

  return (
    <>
      <div className="report-bar no-print">
        <Link className="btn sm" href={`/designs/${id}`}>← Design summary</Link>
        <b>{project.name} · {design.name}</b>
        <span className="grow" />
        {r && <button className="btn sm" disabled={calcBusy} onClick={() => calculate()}>{calcBusy ? 'Calculating…' : 'Recalculate'}</button>}
        <button className="btn primary" disabled={!r || !pics} onClick={() => window.print()}>⬇ Download PDF</button>
      </div>
      <div className="no-print" style={{ background: '#8792a2', padding: '14px 24px 0', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        {calcError && <div className="error" style={{ width: '297mm', maxWidth: '100%', margin: 0 }}>{calcError}</div>}
        {r && stale && <div className="note" style={{ width: '297mm', maxWidth: '100%' }}>The layout changed after the last calculation. Press Recalculate so the report matches the layout.</div>}
        {r && <div className="okmsg" style={{ width: '297mm', maxWidth: '100%' }}>“Download PDF” opens the print window. Choose <b>Save as PDF</b>, layout <b>Landscape</b>, paper <b>A4</b>, margins <b>None</b>, and tick <b>Background graphics</b>.</div>}
      </div>
      {/* hidden canvas used only to draw the pictures */}
      <div className="no-print" style={{ position: 'fixed', left: -5000, top: 0, width: 800, height: 800 }}>
        <SceneView ref={scene} lat={project.lat} lng={project.lng} interactive={false} design={design} mods={mods} results={r} view="2d" tool="select" overlay={false} />
      </div>

      {!r ? (
        <div className="report-wrap"><div className="card" style={{ maxWidth: 520 }}><div className="card-body empty">
          <h3>{t.modules === 0 ? 'This design has no panels yet' : 'Generation is not calculated yet'}</h3>
          {t.modules === 0 ? <p>Add a panel block in the editor first.</p> : <p>The report needs the yearly production figures.</p>}
          {t.modules === 0 ? <Link className="btn primary" href={`/designs/${id}/edit`}>Open the editor</Link> : <button className="btn primary" disabled={calcBusy} onClick={() => calculate()}>{calcBusy ? 'Calculating…' : 'Calculate generation'}</button>}
        </div></div></div>
      ) : (
        <div className="report-wrap">
          {/* 1 cover */}
          <section className="rp"><div className="rp-cover">
            <div>
              <h2>{project.name}</h2>
              <p className="accent" style={{ fontSize: '15pt', maxWidth: '110mm' }}>{project.displayAddress || project.address}</p>
              <div className="rp-big">{fmt(t.kwp)} kWp</div>
              <p className="accent" style={{ fontSize: '12pt' }}>({project.lat.toFixed(5)} , {project.lng.toFixed(5)})</p>
              <hr style={{ border: 0, borderTop: '1px solid #9aa5b1', margin: '6mm 0' }} />
              <p>{t.modules} modules · {design.inverter.qty} inverter{design.inverter.qty === 1 ? '' : 's'} · {fmt(t.acKw)} kW AC</p>
              <p style={{ marginTop: '22mm', fontSize: '13pt' }}>Prepared for: <b>{project.clientName}</b></p>
            </div>
            <div><Img src={pics?.top} /><div className="credit">{CREDIT}</div></div>
          </div><Foot /></section>

          {/* 2 metrics */}
          <section className="rp"><div className="rp-split">
            <h2>System Metrics</h2>
            <div>
              <div className="rp-metrics">
                <div className="rp-metric" style={{ background: 'var(--ink)' }}><span>Annual production</span><b>{fmt(r.annualAc / 1000)}</b><small>x 1000 kWh (units)</small></div>
                <div className="rp-metric" style={{ background: 'var(--teal)' }}><span>Performance ratio</span><b>{fmt(r.pr)}%</b><small>&nbsp;</small></div>
                <div className="rp-metric" style={{ background: 'var(--sun)' }}><span>Specific generation</span><b>{fmt(r.specific)}</b><small>kWh/kWp/year</small></div>
              </div>
              <div className="rp-metrics" style={{ marginTop: '8mm' }}>
                <div className="rp-box"><span>Module DC nameplate</span><b>{fmt(t.kwp)} kWp</b></div>
                <div className="rp-box"><span>AC nameplate</span><b>{fmt(t.acKw)} kW</b></div>
                <div className="rp-box"><span>DC-AC ratio</span><b>{t.acKw ? fmt(t.ratio) : '-'}</b></div>
                <div className="rp-box"><span>Weather dataset</span><b>{r.source}</b></div>
                <div className="rp-box"><span>Shadow-free time</span><b>{fmt(r.shadeFreePct)} %</b></div>
                {t.shedArea > 0 && <div className="rp-box"><span>Shed roof area</span><b>{fmt(t.shedArea)} m²</b></div>}
              </div>
            </div>
          </div><Foot /></section>

          {/* 3 components */}
          <section className="rp"><div className="rp-split">
            <div><h2>Components</h2><p>Equipment used in this installation</p></div>
            <div>
              <div className="rp-comp"><div className="h">Modules</div>{t.byModule.map((m, i) => <div className="l" key={i}><span>{m.name}</span><span>{m.qty}</span></div>)}</div>
              <div className="rp-comp"><div className="h">Inverters</div><div className="l"><span>{design.inverter.name || 'Inverter'} ({fmt(design.inverter.kw, 0)} kW)</span><span>{design.inverter.qty}</span></div></div>
              <div className="rp-comp"><div className="h">Structure</div><div className="l"><span>{design.structureName || '-'}</span><span>-</span></div></div>
              <div className="rp-comp"><div className="h">Walkways</div><div className="l"><span>{design.walkways.length ? `${design.walkways.length} walkway${design.walkways.length > 1 ? 's' : ''}` : 'None'}</span><span>{design.walkways.length ? `${fmt(t.walkwayLength)} m` : '-'}</span></div></div>
            </div>
          </div><Foot /></section>

          {/* 4 annual production */}
          <section className="rp" style={{ padding: 0 }}>
            <div style={{ padding: '14mm 16mm', width: '118mm', height: '100%', display: 'flex', flexDirection: 'column' }}>
              <h2>Expected Annual Production</h2>
              <p style={{ marginTop: '6mm' }}>During the first year of operation, the system is expected to produce {fmt(r.annualAc / 1000)} x 1000 kWh.</p>
              <div style={{ marginTop: 'auto' }}>
                <p style={{ margin: 0 }}>Expected average generation</p><p className="accent" style={{ margin: '0 0 4mm', fontSize: '13pt' }}>{fmt(r.annualAc / 12)} kWh/month</p>
                <p style={{ margin: 0 }}>Yearly degradation rate</p><p className="accent" style={{ margin: 0, fontSize: '13pt' }}>{settings.losses.degradation}%/year</p>
              </div>
            </div>
            <div className="rp-dark" style={{ left: '118mm' }}>
              <div style={{ textAlign: 'center', marginBottom: '4mm' }}>kWh (units) · scale 0 to {fmt0(axisMax)}</div>
              {r.monthly.map((m, i) => <div className="rp-hbar" key={i}><span>{SHORT_MONTHS[i]}</span><div><i style={{ width: `${(m.ac / axisMax) * 100}%` }}>{fmt0(m.ac)}</i></div></div>)}
            </div>
          </section>

          {/* 5 monthly table */}
          <section className="rp">
            <h2 style={{ marginBottom: '8mm' }}>Monthly Table</h2>
            <table className="rp-table">
              <thead><tr><th>Month</th><th>Direct irradiance, horizontal (kWh/m²)</th><th>Diffuse irradiance, horizontal (kWh/m²)</th><th>Effective irradiance on panels (kWh/m²)</th><th>DC energy (kWh)</th><th>AC energy (kWh)</th><th>Specific generation (kWh/kWp)</th><th>Performance ratio (%)</th></tr></thead>
              <tbody>{r.monthly.map((m, i) => <tr key={i}><td>{m.month}</td><td>{fmt(m.direct)}</td><td>{fmt(m.diffuse)}</td><td>{fmt(m.effective)}</td><td>{fmt(m.dc)}</td><td>{fmt(m.ac)}</td><td>{fmt(m.specific)}</td><td>{fmt(m.pr)}</td></tr>)}</tbody>
            </table>
            <Foot />
          </section>

          {/* 6-7 shadows */}
          <section className="rp"><h2>Shadow Analysis</h2>
            <div className="rp-imgs"><figure><figcaption>June 21 | 9:00 AM</figcaption><Img src={pics?.jun9} /></figure><figure><figcaption>June 21 | 5:00 PM</figcaption><Img src={pics?.jun17} /></figure></div>
            <div className="credit">{CREDIT}</div><Foot /></section>
          <section className="rp"><h2>Shadow Analysis</h2>
            <div className="rp-imgs" style={{ marginTop: '3mm' }}><figure><figcaption>December 21 | 9:00 AM</figcaption><Img src={pics?.dec9} /></figure><figure><figcaption>December 21 | 5:00 PM</figcaption><Img src={pics?.dec17} /></figure></div>
            <p style={{ margin: '2mm 0 0' }}><b>Summary:</b> modules are shadow free for <b>{fmt(r.shadeFreePct)}%</b> of the sampled sun hours through the year (shadows from obstructions and other panel rows).</p>
            <Foot /></section>

          {/* 8 maps */}
          <section className="rp">
            <div className="rp-imgs" style={{ marginTop: 0 }}>
              <figure><h2 style={{ marginBottom: '5mm' }}>Irradiance Map</h2><Img src={pics?.irr} /></figure>
              <figure><h2 style={{ marginBottom: '5mm' }}>Solar Access</h2><Img src={pics?.access} /></figure>
            </div>
            <div className="credit">Yellow = highest yearly irradiance on the panels · green = shadow free. {CREDIT}</div><Foot /></section>

          {/* 9 losses */}
          <section className="rp" style={{ padding: 0 }}>
            <div className="rp-dark" style={{ left: 0, display: 'grid', gridTemplateColumns: '80mm 1fr', gap: '10mm' }}>
              <div><h2 style={{ color: '#fff' }}>System Production Losses</h2><p style={{ marginTop: '6mm' }}>Loss in generation predicted due to environmental and electrical factors</p></div>
              <div>
                {r.losses.map((l, i) => {
                  const w = l.stage === 'irradiance' ? (l.value / maxIrr) * 100 : (l.value / maxE) * 100;
                  const col = l.stage === 'irradiance' ? '#fff' : l.stage === 'dc' ? '#4fb3d9' : '#f0a02e';
                  return (
                    <div className="rp-loss" key={i}>
                      <span style={{ textAlign: 'right' }}>{fmt0(l.value)} {l.unit}</span>
                      <div><div className="lab">{l.label}</div><div className="track"><i style={{ width: `${Math.min(w, 100)}%`, background: col }} /></div></div>
                      <span>{l.pct === null ? '' : `${l.pct > 0 ? '+' : ''}${fmt(l.pct)}%`}</span>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', gap: '8mm', justifyContent: 'center', marginTop: '4mm', fontSize: '9pt' }}>
                  {[['#fff', 'Irradiance'], ['#4fb3d9', 'DC'], ['#f0a02e', 'AC']].map(([c, n]) => <span key={n}><i style={{ display: 'inline-block', width: '6mm', height: '3mm', background: c, marginRight: '2mm' }} />{n}</span>)}
                </div>
              </div>
            </div>
          </section>

          {/* 10 thank you */}
          <section className="rp"><div style={{ position: 'absolute', left: '165mm', top: '72mm' }}>
            <h2 style={{ fontSize: '22pt' }}>Thank you</h2>
            <p className="accent" style={{ fontSize: '18pt', margin: '5mm 0 3mm' }}>{co.name}</p>
            <p style={{ fontSize: '14pt', margin: 0 }}>{co.email}</p><p style={{ fontSize: '14pt', margin: 0 }}>{co.phone}</p>
            {!co.email && !co.phone && <p className="no-print muted small">Add your email and phone in Settings.</p>}
          </div></section>
        </div>
      )}
    </>
  );
}
