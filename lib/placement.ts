// Where panel sets, obstructions and walkways may stand: panel sets stay on their shed, and nothing overlaps.
import type { Block, Design, ModuleSpec, Pt } from './types';
import { findModule } from './catalog';
import { blockLayout, blockSlots, blockYaw, boxPlan, pointInPoly, rad, toWorld } from './geometry';

export type Ref = { kind: string; id: string };
export type Foot<P extends Ref = Ref> = { p: P; name: string; x: number; z: number; yaw: number; corners: Pt[] };
const same = (a: Ref, b: Ref) => a.kind === b.kind && a.id === b.id;

// Footprint of a panel set, obstruction or walkway on the plan: centre, turn and the four corners as drawn.
export function footprint<P extends Ref>(d: Design, mods: ModuleSpec[], p: P): Foot<P> | null {
  if (p.kind === 'block') {
    const b = d.blocks.find((q) => q.id === p.id); if (!b) return null;
    const L = blockLayout(b, findModule(mods, b.moduleId)), yaw = blockYaw(b.azimuth), hw = L.width / 2, hd = L.depth / 2;
    return { p, name: b.name, x: b.x, z: b.z, yaw, corners: [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => toWorld(b.x, b.z, yaw, lx, lz)) };
  }
  const o = (p.kind === 'obstruction' ? d.obstructions : p.kind === 'walkway' ? d.walkways : []).find((q) => q.id === p.id);
  return o ? { p, name: o.name, x: o.x, z: o.z, yaw: -rad(o.rotation), corners: boxPlan(d, o) } : null; // on a sloped roof the item is tipped with it
}

function allFeet(d: Design, mods: ModuleSpec[]): Foot[] {
  const refs: Ref[] = [...d.blocks.map((b) => ({ kind: 'block', id: b.id })), ...d.obstructions.map((o) => ({ kind: 'obstruction', id: o.id })), ...d.walkways.map((o) => ({ kind: 'walkway', id: o.id }))];
  return refs.map((p) => footprint(d, mods, p)).filter(Boolean) as Foot[];
}

// Pulls every edge in by a few millimetres, so items that only touch (gap 0) do not count as overlapping.
function inset(c: Pt[], e = 0.004): Pt[] {
  const n = (a: Pt, b: Pt): Pt => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [((b[0] - a[0]) / l) * e, ((b[1] - a[1]) / l) * e]; };
  const u = n(c[0], c[1]), v = n(c[0], c[3]);
  return [[c[0][0] + u[0] + v[0], c[0][1] + u[1] + v[1]], [c[1][0] - u[0] + v[0], c[1][1] - u[1] + v[1]], [c[2][0] - u[0] - v[0], c[2][1] - u[1] - v[1]], [c[3][0] + u[0] - v[0], c[3][1] + u[1] - v[1]]];
}
// Two four-sided footprints overlap unless a line along one of their edges separates them.
function overlap(a: Pt[], b: Pt[], dx = 0, dz = 0): boolean {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], nx = q[1] - p[1], nz = p[0] - q[0];
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of a) { const t = (x + dx) * nx + (z + dz) * nz; a0 = Math.min(a0, t); a1 = Math.max(a1, t); }
    for (const [x, z] of b) { const t = x * nx + z * nz; b0 = Math.min(b0, t); b1 = Math.max(b1, t); }
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}

// Message when one of the moved items overlaps anything else, or null when all are clear.
export function overlapError(d: Design, mods: ModuleSpec[], moved: Ref[]): string | null {
  const feet = allFeet(d, mods).map((f) => ({ ...f, corners: inset(f.corners) }));
  for (const m of feet) {
    if (!moved.some((p) => same(p, m.p))) continue;
    for (const o of feet) if (o !== m && overlap(m.corners, o.corners)) return `“${m.name}” would overlap “${o.name}”. Nothing may overlap.`;
  }
  return null;
}

// Panel places of a set that lie on its shed roof, inside the edge margin.
const onShed = (d: Design, mods: ModuleSpec[], b: Block) => blockSlots(b, findModule(mods, b.moduleId), { sheds: d.sheds, keepouts: [] }).usable;

// Message when a moved panel set would leave its shed: its centre must stay on the roof and no panel that is on the roof now may go off it.
export function shedError(before: Design, after: Design, mods: ModuleSpec[], moved: Ref[]): string | null {
  for (const p of moved) {
    if (p.kind !== 'block') continue;
    const b = after.blocks.find((q) => q.id === p.id), shed = b?.shedId ? after.sheds.find((q) => q.id === b.shedId) : null;
    if (!b || !shed) continue;
    if (!pointInPoly(b.x, b.z, shed.points)) return `“${b.name}” must stay on ${shed.name}.`;
    const b0 = before.blocks.find((q) => q.id === p.id); if (!b0) continue;
    const lost = onShed(before, mods, b0) - onShed(after, mods, b);
    if (lost > 0) return `That would push ${lost} panel${lost > 1 ? 's' : ''} of “${b.name}” outside ${shed.name} or into its edge margin.`;
  }
  return null;
}
export const moveError = (before: Design, after: Design, mods: ModuleSpec[], moved: Ref[]) => shedError(before, after, mods, moved) || overlapError(after, mods, moved);

// Nearest place to where a new item stands now at which it overlaps nothing (a panel set also keeps all its panels
// on the shed). Returns its own place when that is already clear, and null when there is no room nearby.
export function freeSpot(d: Design, mods: ModuleSpec[], p: Ref): { x: number; z: number } | null {
  const feet = allFeet(d, mods), me = feet.find((f) => same(f.p, p)); if (!me) return null;
  const others = feet.filter((f) => f !== me).map((f) => inset(f.corners)), mine = inset(me.corners);
  const hit = (dx: number, dz: number) => others.some((o) => overlap(mine, o, dx, dz));
  if (!hit(0, 0)) return { x: me.x, z: me.z };
  const b = p.kind === 'block' ? d.blocks.find((q) => q.id === p.id) : null, shed = b?.shedId ? d.sheds.find((q) => q.id === b.shedId) : null;
  const base = b && shed ? onShed(d, mods, b) : 0;
  const offs: [number, number][] = [];
  for (let i = -40; i <= 40; i++) for (let j = -40; j <= 40; j++) if (i || j) offs.push([i * 0.5, j * 0.5]);
  offs.sort((a, c) => Math.hypot(a[0], a[1]) - Math.hypot(c[0], c[1]));
  let counted = 0;
  for (const [dx, dz] of offs) {
    if (hit(dx, dz)) continue;
    if (b && shed) {
      if (!pointInPoly(b.x + dx, b.z + dz, shed.points)) continue;
      if (counted++ > 300) break;
      if (onShed(d, mods, { ...b, x: b.x + dx, z: b.z + dz }) < base) continue;
    }
    return { x: Math.round((me.x + dx) * 100) / 100, z: Math.round((me.z + dz) * 100) / 100 };
  }
  return null;
}
