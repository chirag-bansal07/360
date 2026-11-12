'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import ShareDialog from '@/components/ShareDialog';
import SceneView, { SceneHandle } from '@/components/SceneView';
import { useDesign } from '@/lib/useDesign';
import { api, fmt, fmt0, fmtDateTime, SHORT_MONTHS } from '@/lib/client';
import { designTotals } from '@/lib/geometry';
import { STRUCTURE_BRAND, structureOf } from '@/lib/catalog';
import { clockToSolar, dayOfYear, sunVector } from '@/lib/sun';

type Pics = { top: string; jun9: string; jun17: string; dec9: string; dec17: string; irr: string; access: string };


// The report. With "share" it is a saved report opened through its link: it shows the copy kept when it was saved.
export default function ReportScreen({ id, share }: { id?: string; share?: string }) {
  const { design, project, settings, mods, error, stale, calculate, calcBusy, calcError, sharedAt } = useDesign(id, share);
  const [link, setLink] = useState('');
  const [saveErr, setSaveErr] = useState('');
  // every report that is downloaded or shared is saved, so it shows up in the project's report list
  const save = () => api<{ token: string }>(`/api/designs/${id}/reports`, 'POST').then((r) => { setSaveErr(''); return r.token; });
  const scene = useRef<SceneHandle>(null);
  const [pics, setPics] = useState<Pics | null>(null);
  const [opened] = useState(() => new Date().toISOString());
  const now = sharedAt || opened;
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

  if (!design || !project || !settings) return <div style={{ padding: 40 }}>{error ? <div className="error">{error}{!share && <> <Link href="/projects"><u>Back to projects</u></Link></>}</div> : 'Preparing report…'}</div>;
  const t = designTotals(design, mods), r = design.results, co = settings.company;
  const PAGES = 6;
  const Brand = () => (co.logo ? <img src={co.logo} alt={co.name} /> : <span className="who"><span className="mark" />{co.name}</span>);
  // one A4 portrait page: logo header, body, numbered footer
  const page = (n: number, title: string, body: ReactNode) => (
    <section className="rp" key={n}>
      <header className="rp-head"><Brand /><div className="ctx"><b>{project.name}</b>{title}</div></header>
      {body}
      <footer className="rp-foot"><span>{co.name} · Generated on {fmtDateTime(now)}</span><span>Page {n} of {PAGES}</span></footer>
    </section>
  );
  const Img = ({ src }: { src?: string }) => (src ? <img src={src} alt="" /> : <div style={{ aspectRatio: '1', background: '#dfe5ea', display: 'grid', placeItems: 'center', color: '#6b7a90', borderRadius: '2mm' }}>Drawing…</div>);
  const fmtK = (v: number) => (v >= 10000 ? `${fmt(v / 1000, 1)}k` : fmt0(v));

  // monthly chart (drawn in millimetres)
  const acs = r ? r.monthly.map((m) => m.ac) : [];
  const maxM = Math.max(...acs, 1), avgM = r ? r.annualAc / 12 : 0;
  const pow = 10 ** Math.floor(Math.log10(maxM)), axisMax = Math.ceil(maxM / (pow / 2)) * (pow / 2);
  const best = acs.indexOf(Math.max(...acs)), low = acs.indexOf(Math.min(...acs));
  const CX = 14, CW = 164, CT = 6, CB = 54, band = CW / 12, bw = 9;
  const cy = (v: number) => CB - (v / axisMax) * (CB - CT);
  const bar = (i: number, v: number) => {
    const x = CX + i * band + (band - bw) / 2, y = cy(v), q = Math.min(1.2, (CB - y) / 2);
    return `M${x},${CB}V${y + q}Q${x},${y} ${x + q},${y}H${x + bw - q}Q${x + bw},${y} ${x + bw},${y + q}V${CB}Z`;
  };
  const sum = (k: 'direct' | 'diffuse' | 'effective' | 'dc' | 'ac') => (r ? r.monthly.reduce((a, m) => a + m[k], 0) : 0);

  // energy flow
  const irrRows = r ? r.losses.filter((l) => l.stage === 'irradiance') : [], elRows = r ? r.losses.filter((l) => l.stage !== 'irradiance') : [];
  const ghi = irrRows[0]?.value || 0, onPanel = irrRows[irrRows.length - 1]?.value || 0, nom = elRows[0]?.value || 0, acOut = elRows[elRows.length - 1]?.value || 0;
  const maxIrr = Math.max(...irrRows.map((l) => l.value), 1), maxE = Math.max(...elRows.map((l) => l.value), 1);
  const lossRow = (l: (typeof irrRows)[number], i: number, max: number, col: string) => (
    <div className={`rp-loss${l.pct === null ? ' start' : ''}`} key={i}>
      <span>{l.label}</span>
      <div className="track"><i style={{ width: `${Math.min((l.value / max) * 100, 100)}%`, background: col }} /></div>
      <span className="num">{fmt0(l.value)} {l.unit}</span>
      <span className="num">{l.pct === null ? 'Start' : Math.abs(l.pct) < 0.005 ? '0.00%' : `${l.pct > 0 ? '▲ +' : '▼ −'}${fmt(Math.abs(l.pct))}%`}</span>
    </div>
  );
  const lossHead = (unit: string) => <div className="rp-loss head"><span>Step</span><span>Remaining</span><span className="num">{unit}</span><span className="num">Change</span></div>;
  const blocks = design.blocks.filter((b) => r?.poaByBlock[b.id] !== undefined);

  return (
    <>
      <div className="report-bar no-print">
        {!share && <Link className="btn sm" href={`/designs/${id}`}>← Design summary</Link>}
        <b>{project.name} · {design.name}</b>
        <span className="grow" />
        {!share && r && <button className="btn sm" disabled={calcBusy} onClick={() => calculate()}>{calcBusy ? 'Calculating…' : 'Recalculate'}</button>}
        {!share && r && <button className="btn sm" disabled={stale} title={stale ? 'Recalculate first, so the shared report matches the layout' : 'Get a link to this report'} onClick={() => save().then((t) => setLink(`${window.location.origin}/report/${t}`)).catch((e) => setSaveErr(e.message))}>Share</button>}
        <button className="btn primary" disabled={!r || !pics} onClick={() => { if (!share) save().catch(() => {}); window.print(); }}>⬇ Download PDF</button>
      </div>
      <div className="no-print" style={{ background: '#8792a2', padding: '14px 24px 0', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        {calcError && <div className="error" style={{ width: '210mm', maxWidth: '100%', margin: 0 }}>{calcError}</div>}
        {saveErr && <div className="error" style={{ width: '210mm', maxWidth: '100%', margin: 0 }}>The report could not be saved for sharing: {saveErr}</div>}
        {!share && r && stale && <div className="note" style={{ width: '210mm', maxWidth: '100%' }}>The layout changed after the last calculation. Press Recalculate so the report matches the layout.</div>}
        {r && <div className="okmsg" style={{ width: '210mm', maxWidth: '100%' }}>“Download PDF” opens the print window. Choose <b>Save as PDF</b>, layout <b>Portrait</b>, paper <b>A4</b>, margins <b>None</b>, and tick <b>Background graphics</b>.</div>}
      </div>
      {/* hidden canvas used only to draw the pictures */}
      <div className="no-print" style={{ position: 'fixed', left: -5000, top: 0, width: 800, height: 800 }}>
        <SceneView ref={scene} lat={project.lat} lng={project.lng} plain={project.noMap} share={share} picture={project.imagery} interactive={false} design={design} mods={mods} results={r} view="2d" tool="select" overlay={false} />
      </div>

      {link && <ShareDialog title="Share this report" url={link} text={`${project.name}: solar plant layout report`} note="Anyone with this link can open the report and save it as a PDF. No sign-in is needed. The report stays as it is now, even if the design changes later." onClose={() => setLink('')} />}
      {!r ? (
        <div className="report-wrap"><div className="card" style={{ maxWidth: 520 }}><div className="card-body empty">
          <h3>{t.modules === 0 ? 'This design has no panels yet' : 'Generation is not calculated yet'}</h3>
          {t.modules === 0 ? <p>Add a panel block in the editor first.</p> : <p>The report needs the yearly production figures.</p>}
          {t.modules === 0 ? <Link className="btn primary" href={`/designs/${id}/edit`}>Open the editor</Link> : <button className="btn primary" disabled={calcBusy} onClick={() => calculate()}>{calcBusy ? 'Calculating…' : 'Calculate generation'}</button>}
        </div></div></div>
      ) : (
        <div className="report-wrap">
          {/* 1 cover */}
          <section className="rp cover">
            <div className="rp-cover-top">
              {co.logo ? <img src={co.logo} alt={co.name} /> : <span className="who"><span className="mark" />{co.name}</span>}
              <div className="tag"><b>Solar plant layout report</b>{fmtDateTime(now).split(' | ')[0]}</div>
            </div>
            <h1>{project.name}</h1>
            <p className="rp-addr">{project.noMap ? (project.displayAddress || project.address || 'Layout from shed dimensions') : `${project.displayAddress || project.address} · ${project.lat.toFixed(5)}, ${project.lng.toFixed(5)}`}</p>
            <div className="rp-hero"><Img src={pics?.top} /></div>
            <div className="credit">{CREDIT}</div>
            <div className="rp-strip">
              <div><span>Plant capacity</span><b>{fmt(t.kwp)} <small>kWp</small></b></div>
              <div><span>Solar modules</span><b>{fmt0(t.modules)}</b></div>
              <div><span>Inverter capacity</span><b>{fmt(t.acKw)} <small>kW AC</small></b></div>
              <div><span>Yearly generation</span><b>{fmt0(r.annualAc)} <small>kWh</small></b></div>
            </div>
            <div className="rp-by">
              <div><span>Prepared for</span><b>{project.clientName || '-'}</b></div>
              <div><span>Prepared by</span><b>{co.name}</b></div>
              <div><span>Design</span><b>{design.name}</b></div>
            </div>
            <footer className="rp-foot"><span>{co.name}{co.email ? ` · ${co.email}` : ''}{co.phone ? ` · ${co.phone}` : ''}</span><span>Page 1 of {PAGES}</span></footer>
          </section>

          {/* 2 summary */}
          {page(2, 'System summary', <>
            <h2>System summary</h2>
            <p className="lead">The four numbers that describe how this plant is expected to perform in its first year.</p>
            <div className="rp-kpis">
              <div className="rp-kpi"><span>Yearly generation</span><b>{fmt0(r.annualAc)} <small>kWh (units)</small></b><p>Electricity delivered in year one. About {fmt0(r.annualAc / 12)} kWh a month, {fmt0(r.annualAc / 365)} kWh a day.</p></div>
              <div className="rp-kpi"><span>Specific generation</span><b>{fmt0(r.specific)} <small>kWh per kWp a year</small></b><p>Units produced by each kWp installed. Use it to compare plants of different sizes.</p></div>
              <div className="rp-kpi"><span>Performance ratio</span><b>{fmt(r.pr, 1)} <small>%</small></b><p>Share of the sunlight energy reaching the panels that ends up as usable electricity.</p></div>
              <div className="rp-kpi"><span>Shadow-free time</span><b>{fmt(r.shadeFreePct, 1)} <small>%</small></b><p>Share of sun hours in the year when the panels are free of shadow.</p></div>
            </div>
            <h3>Plant details</h3>
            <div className="rp-spec">
              <div><span>DC capacity (modules)</span><b>{fmt(t.kwp)} kWp</b></div>
              <div><span>AC capacity (inverters)</span><b>{fmt(t.acKw)} kW</b></div>
              <div><span>DC to AC ratio</span><b>{t.acKw ? fmt(t.ratio) : '-'}</b></div>
              <div><span>Yearly degradation</span><b>{settings.losses.degradation}% a year</b></div>
              <div><span>Weather data</span><b>{r.source}</b></div>
              {t.shedArea > 0 && <div><span>Shed roof area</span><b>{fmt(t.shedArea)} m²</b></div>}
            </div>
            <h3>Equipment</h3>
            <table className="rp-table left">
              <thead><tr><th>Item</th><th>Description</th><th>Quantity</th></tr></thead>
              <tbody>
                {t.byModule.map((m, i) => <tr key={i}><td className="key">{i === 0 ? 'Modules' : ''}</td><td>{m.name}</td><td>{fmt0(m.qty)}</td></tr>)}
                <tr><td className="key">Inverters</td><td>{design.inverter.name || 'Inverter'} ({fmt(design.inverter.kw, 0)} kW)</td><td>{design.inverter.qty}</td></tr>
                {t.byStructure.map((s, i) => <tr key={`s${i}`}><td className="key">{i === 0 ? 'Structure' : ''}</td><td>{s.name}</td><td>{fmt0(s.qty)} modules</td></tr>)}
                <tr><td className="key">Walkways</td><td>{design.walkways.length ? `${design.walkways.length} walkway${design.walkways.length > 1 ? 's' : ''}` : 'None'}</td><td>{design.walkways.length ? `${fmt(t.walkwayLength)} m` : '-'}</td></tr>
              </tbody>
            </table>
          </>)}

          {/* 3 monthly */}
          {page(3, 'Monthly generation', <>
            <h2>Monthly generation</h2>
            <p className="lead">Expected electricity for each month of the first year, in kWh (units). The dashed line is the monthly average.</p>
            <svg className="rp-chart" viewBox="0 0 178 60" role="img" aria-label="Monthly generation in kWh">
              {[0, 0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line className={f ? 'grid' : 'base'} x1={CX} x2={CX + CW} y1={cy(axisMax * f)} y2={cy(axisMax * f)} /><text x={CX - 1.5} y={cy(axisMax * f) + 0.9} textAnchor="end">{fmtK(axisMax * f)}</text></g>)}
              {r.monthly.map((m, i) => <g key={i}><path className="bar" d={bar(i, m.ac)} /><text className="val" x={CX + i * band + band / 2} y={cy(m.ac) - 1.2} textAnchor="middle">{fmtK(m.ac)}</text><text x={CX + i * band + band / 2} y={CB + 4} textAnchor="middle">{SHORT_MONTHS[i]}</text></g>)}
              <line className="avg" x1={CX} x2={CX + CW} y1={cy(avgM)} y2={cy(avgM)} />
            </svg>
            <div className="rp-kpis three" style={{ marginTop: '3mm' }}>
              <div className="rp-kpi"><span>Best month</span><b>{r.monthly[best].month}</b><p>{fmt0(acs[best])} kWh</p></div>
              <div className="rp-kpi"><span>Lowest month</span><b>{r.monthly[low].month}</b><p>{fmt0(acs[low])} kWh</p></div>
              <div className="rp-kpi"><span>Monthly average</span><b>{fmt0(avgM)} <small>kWh</small></b><p>{fmt0(r.annualAc)} kWh in the year</p></div>
            </div>
            <h3>Month by month</h3>
            <table className="rp-table">
              <thead><tr><th>Month</th><th>Direct sun<small>kWh/m²</small></th><th>Diffuse sun<small>kWh/m²</small></th><th>On panels<small>kWh/m²</small></th><th>DC energy<small>kWh</small></th><th>AC energy<small>kWh</small></th><th>Specific<small>kWh/kWp</small></th><th>PR<small>%</small></th></tr></thead>
              <tbody>{r.monthly.map((m, i) => <tr key={i}><td>{m.month}</td><td>{fmt(m.direct, 1)}</td><td>{fmt(m.diffuse, 1)}</td><td>{fmt(m.effective, 1)}</td><td>{fmt0(m.dc)}</td><td className="key">{fmt0(m.ac)}</td><td>{fmt(m.specific, 1)}</td><td>{fmt(m.pr, 1)}</td></tr>)}</tbody>
              <tfoot><tr><td>Year</td><td>{fmt(sum('direct'), 1)}</td><td>{fmt(sum('diffuse'), 1)}</td><td>{fmt(sum('effective'), 1)}</td><td>{fmt0(sum('dc'))}</td><td>{fmt0(sum('ac'))}</td><td>{fmt(r.specific, 1)}</td><td>{fmt(r.pr, 1)}</td></tr></tfoot>
            </table>
          </>)}

          {/* 4 shadows */}
          {page(4, 'Shadow analysis', <>
            <h2>Shadow analysis</h2>
            <p className="lead">Where shadows fall on the longest and shortest days of the year, in the morning and the late afternoon.</p>
            <div className="rp-imgs">
              <figure><figcaption><b>21 June</b> · 9:00 AM</figcaption><Img src={pics?.jun9} /></figure>
              <figure><figcaption><b>21 June</b> · 5:00 PM</figcaption><Img src={pics?.jun17} /></figure>
              <figure><figcaption><b>21 December</b> · 9:00 AM</figcaption><Img src={pics?.dec9} /></figure>
              <figure><figcaption><b>21 December</b> · 5:00 PM</figcaption><Img src={pics?.dec17} /></figure>
            </div>
            <div className="credit">{CREDIT}</div>
            <div className="rp-note">The modules are shadow free for <b>{fmt(r.shadeFreePct, 1)}%</b> of the sampled sun hours through the year. Shadows come from obstructions and from other panel rows.</div>
          </>)}

          {/* 5 maps */}
          {page(5, 'Sunlight on the panels', <>
            <h2>Sunlight on the panels</h2>
            <p className="lead">How much sunlight each panel receives over the year, and how much of the time it is free of shadow.</p>
            <div className="rp-imgs">
              <figure><figcaption><b>Irradiance map</b> · yellow = most sunlight</figcaption><Img src={pics?.irr} /></figure>
              <figure><figcaption><b>Solar access</b> · green = shadow free</figcaption><Img src={pics?.access} /></figure>
            </div>
            <div className="credit">{CREDIT}</div>
            {blocks.length > 0 && <>
              <h3>Yearly sunlight by panel block</h3>
              <table className="rp-table">
                <thead><tr><th>Panel block</th><th>Structure<small>{STRUCTURE_BRAND}</small></th><th>Tilt<small>degrees</small></th><th>Facing<small>compass degrees</small></th><th>Sunlight on panels<small>kWh/m² a year</small></th></tr></thead>
                <tbody>{blocks.slice(0, 12).map((b) => <tr key={b.id}><td>{b.name}</td><td>{structureOf(b).name}, {b.orientation}</td><td>{fmt(b.tilt, 1)}</td><td>{fmt0(b.azimuth)}</td><td className="key">{fmt0(r.poaByBlock[b.id])}</td></tr>)}</tbody>
              </table>
              {blocks.length > 12 && <div className="credit">and {blocks.length - 12} more panel blocks.</div>}
            </>}
          </>)}

          {/* 6 losses */}
          {page(6, 'Energy flow and losses', <>
            <h2>Where the energy goes</h2>
            <p className="lead">From sunlight on the site to electricity delivered. Each step shows what remains and how much that step changed it.</p>
            <div className="rp-flow">
              <div><span>Sunlight on site</span><b>{fmt0(ghi)}</b><small>kWh/m² a year</small></div>
              <div><span>Reaches the panels</span><b>{fmt0(onPanel)}</b><small>kWh/m² a year</small></div>
              <div><span>Panel output</span><b>{fmt0(nom)}</b><small>kWh before losses</small></div>
              <div><span>Delivered</span><b>{fmt0(acOut)}</b><small>kWh · {nom ? fmt((acOut / nom) * 100, 1) : '-'}% of panel output</small></div>
            </div>
            <h3>1. Sunlight reaching the panels</h3>
            {lossHead('kWh/m²')}
            {irrRows.map((l, i) => lossRow(l, i, maxIrr, 'var(--sun)'))}
            <h3>2. Electricity produced</h3>
            {lossHead('kWh')}
            {elRows.map((l, i) => lossRow(l, i, maxE, 'var(--teal)'))}
            <div className="rp-contact">
              {co.logo ? <img src={co.logo} alt="" /> : <span className="mark" />}
              <div><b>{co.name}</b><p>Questions about this report? {[co.email, co.phone].filter(Boolean).join(' · ') || 'Contact us.'}</p>
                {!share && !co.email && !co.phone && <p className="no-print small">Add your email and phone in Settings.</p>}</div>
            </div>
          </>)}
        </div>
      )}
    </>
  );
}
