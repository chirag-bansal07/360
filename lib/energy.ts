// Shading and energy simulation. Pure maths, no network.
// Method: monthly average weather -> typical day per month -> hourly steps.
// Hourly split: Collares-Pereira & Rabl. Tilted plane: isotropic sky (Liu & Jordan).
// Reflection: ASHRAE incidence modifier. Cell temperature: NOCT model.
import type { Design, LossRow, LossSettings, ModuleSpec, MonthRow, Results, Weather } from './types';
import { findModule } from './catalog';
import { shedRoofY, shedUnder, shedNormal, tipToRoof, blockSlots, blockYaw, designSignature, designTotals, rad, PANEL_THICK } from './geometry';
import { MID_DAY, MONTHS, MONTH_DAYS, sunVector, sunsetHourAngle } from './sun';

const HOURS = 16; // solar hours 4.5 .. 19.5
const hourOf = (k: number) => 4.5 + k;

type Box = { c: number[]; u: number[]; v: number[]; n: number[]; hu: number; hv: number; hn: number; r: number };
type Group = { blockIndex: number; flush: boolean; c: number[]; r: number; boxes: Box[] };

function groupSphere(boxes: Box[]): { c: number[]; r: number } {
  const c = [0, 0, 0];
  for (const b of boxes) { c[0] += b.c[0]; c[1] += b.c[1]; c[2] += b.c[2]; }
  c[0] /= boxes.length; c[1] /= boxes.length; c[2] /= boxes.length;
  let r = 0;
  for (const b of boxes) r = Math.max(r, Math.hypot(b.c[0] - c[0], b.c[1] - c[1], b.c[2] - c[2]) + b.r);
  return { c, r };
}
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function sphereMiss(o: number[], s: number[], c: number[], r: number) {
  const dx = c[0] - o[0], dy = c[1] - o[1], dz = c[2] - o[2];
  const t = dx * s[0] + dy * s[1] + dz * s[2];
  if (t < -r) return true;
  return dx * dx + dy * dy + dz * dz - t * t > r * r;
}
function rayHitsBox(o: number[], s: number[], b: Box) {
  const d = [o[0] - b.c[0], o[1] - b.c[1], o[2] - b.c[2]];
  let tmin = 1e-4, tmax = Infinity;
  const axes: [number[], number][] = [[b.u, b.hu], [b.v, b.hv], [b.n, b.hn]];
  for (const [ax, h] of axes) {
    const e = dot(ax, d), f = dot(ax, s);
    if (Math.abs(f) < 1e-9) { if (Math.abs(e) > h) return false; continue; }
    let t1 = (-h - e) / f, t2 = (h - e) / f;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  return true;
}

export function simulate(lat: number, design: Design, mods: ModuleSpec[], weather: Weather, losses: LossSettings): Omit<Results, 'calculatedAt'> {
  const totals = designTotals(design, mods);

  // ---------- geometry ----------
  const groups: Group[] = [];
  const blocks = design.blocks.map((b, bi) => {
    const m = findModule(mods, b.moduleId);
    const { L, active } = blockSlots(b, m, design);
    const yaw = blockYaw(b.azimuth), cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(L.tilt), st = Math.sin(L.tilt);
    const u = [cy, 0, -sy], v = [ct * sy, -st, ct * cy], n = [st * sy, ct, st * cy];
    const panels = active.map((s) => {
      const c = [b.x + s.lx * cy + s.lz * sy, s.ly, b.z - s.lx * sy + s.lz * cy];
      const box: Box = { c, u, v, n, hu: L.Lu / 2, hv: L.Lv / 2, hn: PANEL_THICK / 2, r: Math.hypot(L.Lu, L.Lv) / 2 + 0.05 };
      return { key: s.key, box };
    });
    if (panels.length && b.mounting === 'flush') groups.push({ blockIndex: bi, flush: true, boxes: panels.map((p) => p.box), ...groupSphere(panels.map((p) => p.box)) });
    else if (panels.length) {
      // tilted rows can shade each other, so keep one group per row for fast rejection
      const byRow = new Map<string, Box[]>();
      for (const p of panels) { const r = p.key.split('-')[0]; if (!byRow.has(r)) byRow.set(r, []); byRow.get(r)!.push(p.box); }
      for (const boxes of byRow.values()) groups.push({ blockIndex: bi, flush: false, boxes, ...groupSphere(boxes) });
    }
    return { b, m, n, panels, kwp: (panels.length * m.watt) / 1000, cosTilt: ct };
  });
  for (const o of design.obstructions) {
    const yaw = -rad(o.rotation), cy = Math.cos(yaw), sy = Math.sin(yaw);
    // on a shed the obstruction stands on the roof and leans with it
    const roof = shedUnder(design, o.x, o.z);
    const nn: [number, number, number] = roof ? shedNormal(roof) : [0, 1, 0];
    const base = roof ? shedRoofY(roof, o.x, o.z) : 0;
    const tip = (a: [number, number, number]) => (roof ? tipToRoof(roof, a) : a);
    const box: Box = { c: [o.x + nn[0] * o.h / 2, base + nn[1] * o.h / 2, o.z + nn[2] * o.h / 2], u: tip([cy, 0, -sy]), v: tip([sy, 0, cy]), n: nn, hu: o.w / 2, hv: o.l / 2, hn: o.h / 2, r: Math.hypot(o.w, o.l, o.h) / 2 };
    groups.push({ blockIndex: -1, flush: false, boxes: [box], c: box.c, r: box.r });
  }

  // ---------- shading: which panels are in shadow at each sample hour ----------
  const shadeFrac = blocks.map(() => Array.from({ length: 12 }, () => new Float32Array(HOURS)));
  const access: Results['access'] = {};
  let sunUp = 0, freeSum = 0, panelCount = 0;
  const unshaded = blocks.map((bl) => new Uint16Array(bl.panels.length));
  for (let mth = 0; mth < 12; mth++) {
    for (let k = 0; k < HOURS; k++) {
      const s = sunVector(lat, MID_DAY[mth], hourOf(k));
      if (s[1] < 0.05) continue;
      sunUp++;
      blocks.forEach((bl, bi) => {
        let shadedCount = 0;
        bl.panels.forEach((p, pi) => {
          const o = [p.box.c[0] + bl.n[0] * 0.05, p.box.c[1] + bl.n[1] * 0.05, p.box.c[2] + bl.n[2] * 0.05];
          let hit = false;
          for (const g of groups) {
            if (g.blockIndex === bi && g.flush) continue;
            if (sphereMiss(o, s, g.c, g.r)) continue;
            for (const bx of g.boxes) {
              if (bx === p.box) continue;
              if (sphereMiss(o, s, bx.c, bx.r)) continue;
              if (rayHitsBox(o, s, bx)) { hit = true; break; }
            }
            if (hit) break;
          }
          if (hit) shadedCount++; else unshaded[bi][pi]++;
        });
        if (bl.panels.length) shadeFrac[bi][mth][k] = shadedCount / bl.panels.length;
      });
    }
  }
  blocks.forEach((bl, bi) => {
    access[bl.b.id] = {};
    bl.panels.forEach((p, pi) => {
      const a = sunUp ? unshaded[bi][pi] / sunUp : 1;
      access[bl.b.id][p.key] = Math.round(a * 1000) / 1000;
      freeSum += a; panelCount++;
    });
  });

  // ---------- energy ----------
  const adj = 1 + losses.irradianceAdjust / 100;
  const fSoil = 1 - losses.soiling / 100, fLid = 1 - losses.lid / 100, fMis = 1 - losses.mismatch / 100, fWir = 1 - losses.dcWiring / 100;
  const fInv = losses.inverterEff / 100, fUn = 1 - losses.unavailability / 100, fAcw = 1 - losses.acWiring / 100;
  const gamma = losses.tempCoeff / 100;
  const kwp = totals.kwp, acKw = totals.acKw;
  const dcLimit = acKw > 0 ? acKw / fInv : Infinity;
  const A = { ghi: 0, poa: 0, shade: 0, iam: 0, soil: 0, nom: 0, temp: 0, lid: 0, mis: 0, wir: 0, clip: 0, inv: 0, un: 0, ac: 0 };
  const monthly: MonthRow[] = [];
  const poaByBlock: Record<string, number> = {};
  blocks.forEach((bl) => (poaByBlock[bl.b.id] = 0));

  for (let mth = 0; mth < 12; mth++) {
    const n = MID_DAY[mth], days = MONTH_DAYS[mth];
    const H = weather.ghi[mth] * adj, Hd = Math.min(weather.dhi[mth] * adj, H);
    const ws = sunsetHourAngle(lat, n);
    const a = 0.409 + 0.5016 * Math.sin(ws - Math.PI / 3), bb = 0.6609 - 0.4767 * Math.sin(ws - Math.PI / 3);
    const rt: number[] = [], rd: number[] = [];
    let srt = 0, srd = 0;
    for (let k = 0; k < HOURS; k++) {
      const w = rad((hourOf(k) - 12) * 15);
      const base = Math.abs(w) < ws ? Math.max(0, Math.cos(w) - Math.cos(ws)) : 0;
      rd.push(base); rt.push(base * (a + bb * Math.cos(w)));
      srd += base; srt += base * (a + bb * Math.cos(w));
    }
    const M = { poa: 0, eff: 0, dc: 0, ac: 0 };
    for (let k = 0; k < HOURS; k++) {
      if (!rt[k]) continue;
      const s = sunVector(lat, n, hourOf(k));
      const cosz = Math.max(s[1], 0);
      const I = (H * rt[k]) / srt, Id = Math.min((Hd * rd[k]) / srd, I), Ib = I - Id; // kWh/m2 in this hour
      const Ta = weather.temp[mth] + 4 * Math.cos(((hourOf(k) - 14.5) * Math.PI) / 12);
      let pDc = 0;
      blocks.forEach((bl, bi) => {
        if (!bl.kwp) return;
        const cosi = Math.max(0, dot(bl.n, s));
        const beam = cosz > 0.02 ? Math.min((Ib * cosi) / Math.max(cosz, 0.1), 1.2) : 0;
        const sky = (Id * (1 + bl.cosTilt)) / 2 + (I * 0.2 * (1 - bl.cosTilt)) / 2;
        const beamSh = beam * (1 - shadeFrac[bi][mth][k]);
        const kb = cosi > 0 ? Math.max(0, 1 - 0.05 * (1 / Math.max(cosi, 0.05) - 1)) : 0;
        const gIam = beamSh * kb + sky * 0.96;
        const g = gIam * fSoil;
        const w = kwp ? bl.kwp / kwp : 0;
        A.poa += (beam + sky) * days * w; A.shade += (beamSh + sky) * days * w; A.iam += gIam * days * w; A.soil += g * days * w;
        M.poa += (beam + sky) * days * w; M.eff += g * days * w;
        poaByBlock[bl.b.id] += g * days;
        const noct = bl.b.mounting === 'flush' ? 48 : 45;
        const Tc = Ta + (g / 0.8) * (noct - 20);
        const pNom = bl.kwp * g, pT = pNom * (1 + gamma * (Tc - 25));
        A.nom += pNom * days; A.temp += pT * days;
        pDc += pT;
      });
      A.ghi += I * days;
      const p1 = pDc * fLid, p2 = p1 * fMis, p3 = p2 * fWir, p4 = Math.min(p3, dcLimit), p5 = p4 * fInv, p6 = p5 * fUn, p7 = p6 * fAcw;
      A.lid += p1 * days; A.mis += p2 * days; A.wir += p3 * days; A.clip += p4 * days; A.inv += p5 * days; A.un += p6 * days; A.ac += p7 * days;
      M.dc += p4 * days; M.ac += p7 * days;
    }
    monthly.push({
      month: MONTHS[mth], direct: (H - Hd) * days, diffuse: Hd * days, effective: M.eff, dc: M.dc, ac: M.ac,
      specific: kwp ? M.ac / kwp : 0, pr: kwp && M.poa ? (M.ac / (kwp * M.poa)) * 100 : 0,
    });
  }

  const pct = (now: number, before: number) => (before ? (now / before - 1) * 100 : 0);
  const row = (label: string, value: number, unit: string, p: number | null, stage: LossRow['stage']): LossRow => ({ label, value, unit, pct: p, stage });
  const lossRows: LossRow[] = [
    row('Horizontal global irradiation', A.ghi, 'kWh/m²', null, 'irradiance'),
    row('Global incidence on panel plane', A.poa, 'kWh/m²', pct(A.poa, A.ghi), 'irradiance'),
    row('Near shading', A.shade, 'kWh/m²', pct(A.shade, A.poa), 'irradiance'),
    row('Irradiance after reflection', A.iam, 'kWh/m²', pct(A.iam, A.shade), 'irradiance'),
    row('Soiling', A.soil, 'kWh/m²', pct(A.soil, A.iam), 'irradiance'),
    row('Nominal energy after PV conversion', A.nom, 'kWh', null, 'dc'),
    row('Module temperature loss', A.temp, 'kWh', pct(A.temp, A.nom), 'dc'),
    row('Light induced degradation', A.lid, 'kWh', pct(A.lid, A.temp), 'dc'),
    row('Mismatch, modules and strings', A.mis, 'kWh', pct(A.mis, A.lid), 'dc'),
    row('DC wiring loss', A.wir, 'kWh', pct(A.wir, A.mis), 'dc'),
    row('Inverter clipping', A.clip, 'kWh', pct(A.clip, A.wir), 'ac'),
    row('DC to AC conversion', A.inv, 'kWh', pct(A.inv, A.clip), 'ac'),
    row('System unavailability', A.un, 'kWh', pct(A.un, A.inv), 'ac'),
    row('AC wiring loss', A.ac, 'kWh', pct(A.ac, A.un), 'ac'),
  ];

  return {
    source: weather.source, kwp, acKw, annualAc: A.ac,
    pr: kwp && A.poa ? (A.ac / (kwp * A.poa)) * 100 : 0,
    specific: kwp ? A.ac / kwp : 0,
    shadeFreePct: panelCount ? (freeSum / panelCount) * 100 : 100,
    monthly, losses: lossRows, access, poaByBlock, signature: designSignature(design),
  };
}
