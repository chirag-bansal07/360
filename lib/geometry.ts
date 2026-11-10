import type { Block, Design, Keepout, ModuleSpec, Obstruction, Pt, Shed, Walkway } from './types';
import { findModule } from './catalog';

export const rad = (d: number) => (d * Math.PI) / 180;
export const PANEL_THICK = 0.04;
export const ROOF_CLEARANCE = 0.1; // panels sit this far above the shed roof

export type Slot = { key: string; r: number; c: number; lx: number; ly: number; lz: number };
export type Layout = { Lu: number; Lv: number; width: number; depth: number; tilt: number; slots: Slot[]; topY: number };

// Position of every panel slot in the block's own frame.
// Local x runs along a row, local z points the way the panels face (down the slope), y is up.
export function blockLayout(b: Block, m: ModuleSpec): Layout {
  const Lu = b.orientation === 'portrait' ? m.width : m.length;
  const Lv = b.orientation === 'portrait' ? m.length : m.width;
  const t = rad(b.tilt);
  const rows = Math.max(1, Math.round(b.rows)), cols = Math.max(1, Math.round(b.cols));
  const colOff = (c: number) => c * (Lu + b.gapH) + (b.aisleColsEvery > 0 ? Math.floor(c / b.aisleColsEvery) * b.aisleColsGap : 0);
  const rowExtra = (r: number) => (b.aisleRowsEvery > 0 ? Math.floor(r / b.aisleRowsEvery) * b.aisleRowsGap : 0);
  const width = colOff(cols - 1) + Lu;
  const flush = b.mounting === 'flush';
  // flush: rows measured along the slope. rows: each row tilts by itself, spacing measured on the ground.
  const rowOff = (r: number) => (flush ? r * (Lv + b.gapV) + rowExtra(r) : r * (Lv * Math.cos(t) + b.gapV) + rowExtra(r));
  const span = rowOff(rows - 1) + (flush ? Lv : Lv * Math.cos(t));
  const depth = flush ? span * Math.cos(t) : span;
  const slots: Slot[] = [];
  let topY = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lx = colOff(c) + Lu / 2 - width / 2;
      let lz: number, ly: number;
      if (flush) {
        const s = rowOff(r) + Lv / 2;
        lz = (s - span / 2) * Math.cos(t);
        ly = b.mountHeight + (span - s) * Math.sin(t);
      } else {
        lz = rowOff(r) + (Lv * Math.cos(t)) / 2 - span / 2;
        ly = b.mountHeight + (Lv / 2) * Math.sin(t);
      }
      topY = Math.max(topY, ly + (Lv / 2) * Math.sin(t));
      slots.push({ key: `${r}-${c}`, r, c, lx, ly, lz });
    }
  }
  return { Lu, Lv, width, depth, tilt: t, slots, topY };
}

// three.js rotation about the vertical axis for a compass azimuth
export const blockYaw = (azimuth: number) => Math.PI - rad(azimuth);

export function toWorld(x: number, z: number, yaw: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

// ---------- outlines (sheds and no-panel areas) ----------
export function polyArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return Math.abs(a) / 2;
}
export const edgeLengths = (p: Pt[]) => p.map((a, i) => { const b = p[(i + 1) % p.length]; return Math.hypot(b[0] - a[0], b[1] - a[1]); });
export const polyPerimeter = (p: Pt[]) => edgeLengths(p).reduce((s, l) => s + l, 0);
export function polyCentre(p: Pt[]): Pt {
  return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
}
export function pointInPoly(x: number, z: number, p: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distToSeg(x: number, z: number, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}
export function distToEdges(x: number, z: number, p: Pt[]) {
  let d = Infinity;
  for (let i = 0; i < p.length; i++) d = Math.min(d, distToSeg(x, z, p[i], p[(i + 1) % p.length]));
  return d;
}
function segsCross(a: Pt, b: Pt, c: Pt, d: Pt) {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function edgesCross(a: Pt[], b: Pt[]) {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    if (segsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  }
  return false;
}
export const polysOverlap = (a: Pt[], b: Pt[]) => edgesCross(a, b) || pointInPoly(a[0][0], a[0][1], b) || pointInPoly(b[0][0], b[0][1], a);

// Facing direction that lines the panel rows up with the longest edge of the shed, leaning south.
export function shedAzimuth(shed: Shed): number {
  const p = shed.points;
  let best = 0, len = -1;
  edgeLengths(p).forEach((l, i) => { if (l > len) { len = l; best = i; } });
  const a = p[best], b = p[(best + 1) % p.length];
  let az = (Math.atan2(-(b[1] - a[1]), -(b[0] - a[0])) * 180) / Math.PI; // direction at right angles to the edge
  az = ((az % 360) + 360) % 360;
  if (az < 90 || az > 270) az = (az + 180) % 360; // pick the side nearer south
  return Math.round(az * 100) / 100;
}

// Height of the shed roof above ground at a point. The roof is one flat plane:
// lowest at the edge it slopes down towards, rising by the tilt away from that edge.
export function shedRoofY(shed: Shed, x: number, z: number): number {
  const t = rad(Math.max(0, Math.min(60, shed.tilt || 0)));
  if (!t) return shed.height;
  const a = rad(shed.slopeAz ?? 180), ux = -Math.sin(a), uz = Math.cos(a); // uphill direction on the plan
  let min = Infinity;
  for (const [px, pz] of shed.points) min = Math.min(min, px * ux + pz * uz);
  return shed.height + Math.tan(t) * (x * ux + z * uz - min);
}
// The shed whose roof is under a point (the highest one if outlines overlap), or null on open ground.
export function shedUnder(d: { sheds?: Shed[] }, x: number, z: number): Shed | null {
  let best: Shed | null = null;
  for (const s of d.sheds || []) if (s.points.length >= 3 && pointInPoly(x, z, s.points) && (!best || shedRoofY(s, x, z) > shedRoofY(best, x, z))) best = s;
  return best;
}
// Unit vector at right angles to the roof surface, pointing up.
export function shedNormal(shed: Shed): [number, number, number] {
  const t = Math.tan(rad(Math.max(0, Math.min(60, shed.tilt || 0))));
  const a = rad(shed.slopeAz ?? 180), gx = -Math.sin(a) * t, gz = Math.cos(a) * t, len = Math.hypot(gx, 1, gz);
  return [-gx / len, 1 / len, -gz / len];
}
// Turns a vector the same way the roof is tipped away from level (the rotation that takes "straight up" to the roof normal).
export function tipToRoof(shed: Shed, a: [number, number, number]): [number, number, number] {
  const n = shedNormal(shed);
  const kx = n[2], kz = -n[0], s = Math.hypot(kx, kz); // axis = up x normal
  if (s < 1e-9) return a;
  const ux = kx / s, uz = kz / s, c = n[1];
  const dot = ux * a[0] + uz * a[2];
  const cx = -uz * a[1], cy = uz * a[0] - ux * a[2], cz = ux * a[1]; // axis x a
  return [a[0] * c + cx * s + ux * dot * (1 - c), a[1] * c + cy * s, a[2] * c + cz * s + uz * dot * (1 - c)];
}
export const shedTopY = (shed: Shed) => shed.points.reduce((h, [x, z]) => Math.max(h, shedRoofY(shed, x, z)), shed.height);

// Rows, columns and centre that fill the shed (inside its edge margin) for the block's current settings.
export function fitBlock(b: Block, shed: Shed, m: ModuleSpec): Pick<Block, 'rows' | 'cols' | 'x' | 'z' | 'mountHeight'> {
  const yaw = blockYaw(b.azimuth), c = Math.cos(yaw), s = Math.sin(yaw);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [wx, wz] of shed.points) {
    const lx = wx * c - wz * s, lz = wx * s + wz * c;
    minX = Math.min(minX, lx); maxX = Math.max(maxX, lx); minZ = Math.min(minZ, lz); maxZ = Math.max(maxZ, lz);
  }
  const availW = maxX - minX - 2 * shed.setback, availD = maxZ - minZ - 2 * shed.setback;
  const mountHeight = shed.height + ROOF_CLEARANCE;
  const probe = { ...b, mountHeight };
  let cols = 1, rows = 1;
  while (cols < 400 && blockLayout({ ...probe, rows: 1, cols: cols + 1 }, m).width <= availW + 1e-6) cols++;
  while (rows < 200 && blockLayout({ ...probe, rows: rows + 1, cols: 1 }, m).depth <= availD + 1e-6) rows++;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  return { rows, cols, x: Math.round((cx * c + cz * s) * 1000) / 1000, z: Math.round((-cx * s + cz * c) * 1000) / 1000, mountHeight };
}

// Which slots really hold a panel. For a block tied to a shed, a slot counts only when the whole
// panel lies inside the shed outline (minus the edge margin) and touches no no-panel area.
export function blockSlots(b: Block, m: ModuleSpec, d: { sheds?: Shed[]; keepouts?: Keepout[] }) {
  const L = blockLayout(b, m);
  const removed = new Set(b.removed);
  const shed = b.shedId ? (d.sheds || []).find((s) => s.id === b.shedId) : null;
  const keepouts = d.keepouts || [];
  let usable = L.slots;
  if (shed || keepouts.length) {
    const yaw = blockYaw(b.azimuth), hu = L.Lu / 2, hv = (L.Lv * Math.cos(L.tilt)) / 2;
    usable = L.slots.filter((s) => {
      const rect: Pt[] = [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]].map(([du, dv]) => toWorld(b.x, b.z, yaw, s.lx + du, s.lz + dv));
      if (shed) {
        for (const [x, z] of rect) if (!pointInPoly(x, z, shed.points) || distToEdges(x, z, shed.points) < shed.setback - 1e-4) return false;
        if (edgesCross(rect, shed.points)) return false;
      }
      for (const k of keepouts) if (k.points.length >= 3 && polysOverlap(rect, k.points)) return false;
      return true;
    });
  }
  return { L, active: usable.filter((s) => !removed.has(s.key)), ghost: usable.filter((s) => removed.has(s.key)), usable: usable.length };
}

export const activeCount = (b: Block, m: ModuleSpec, d: { sheds?: Shed[]; keepouts?: Keepout[] }) => blockSlots(b, m, d).active.length;

export function designTotals(d: Design, mods: ModuleSpec[]) {
  let modules = 0, kwp = 0;
  const byModule: Record<string, { name: string; qty: number }> = {};
  for (const b of d.blocks) {
    const m = findModule(mods, b.moduleId);
    const n = activeCount(b, m, d);
    modules += n; kwp += (n * m.watt) / 1000;
    byModule[m.id] = { name: m.name, qty: (byModule[m.id]?.qty || 0) + n };
  }
  const acKw = d.inverter.kw * d.inverter.qty;
  const walkwayLength = d.walkways.reduce((s, w) => s + w.l, 0);
  const shedArea = (d.sheds || []).reduce((s, sh) => s + polyArea(sh.points), 0);
  return { modules, kwp, acKw, ratio: acKw > 0 ? kwp / acKw : 0, byModule: Object.values(byModule), walkwayLength, shedArea };
}

export function designBounds(d: Design, mods: ModuleSpec[]) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const pt = (wx: number, wz: number) => { minX = Math.min(minX, wx); maxX = Math.max(maxX, wx); minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz); };
  const add = (x: number, z: number, yaw: number, hw: number, hl: number) => {
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const [wx, wz] = toWorld(x, z, yaw, sx * hw, sz * hl); pt(wx, wz); }
  };
  for (const s of [...(d.sheds || []), ...(d.keepouts || [])]) for (const [x, z] of s.points) pt(x, z);
  for (const b of d.blocks) {
    if (b.shedId && (d.sheds || []).some((s) => s.id === b.shedId)) continue; // the shed outline already covers it
    const L = blockLayout(b, findModule(mods, b.moduleId)); add(b.x, b.z, blockYaw(b.azimuth), L.width / 2, L.depth / 2);
  }
  for (const o of [...d.obstructions, ...d.walkways] as (Obstruction | Walkway)[]) add(o.x, o.z, -rad(o.rotation), o.w / 2, o.l / 2);
  if (!isFinite(minX)) return { cx: 0, cz: 0, size: 60, empty: true };
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, size: Math.max(maxX - minX, maxZ - minZ, 10), empty: false };
}

export function designSignature(d: Design): string {
  return JSON.stringify([d.blocks, d.obstructions, d.inverter, d.sheds || [], d.keepouts || []]);
}
