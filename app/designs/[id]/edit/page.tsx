'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import SceneView, { SceneHandle } from '@/components/SceneView';
import Num from '@/components/Num';
import Confirm from '@/components/Confirm';
import { useDesign } from '@/lib/useDesign';
import { api, fmt, fmt0, SHORT_MONTHS } from '@/lib/client';
import { findModule, findStructure, newBlock, STRUCTURE_BRAND, STRUCTURES, structureOf, uid } from '@/lib/catalog';
import { blockLayout, blockSlots, boxPlan, blockYaw, designTotals, edgeLengths, pointInPoly, polyArea, polyCentre, polyPerimeter, ROOF_CLEARANCE, rad, shedAzimuth, shedRoofY, shedTopY, shedUnder, toWorld } from '@/lib/geometry';
import { footprint, freeSpot, moveError, overlapError, shedError, type Foot } from '@/lib/placement';
import { clockToSolar, dayOfYear, sunVector } from '@/lib/sun';
import type { Block, Design, Keepout, ModuleSpec, Obstruction, ObstructionType, Pt, Shed, StructureId, Walkway } from '@/lib/types';
import type { DrawKind, Selection, Tool } from '@/lib/engine';

const I = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const clockLabel = (h: number) => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
type Pick = NonNullable<Selection>;
const MOVABLE = ['block', 'obstruction', 'walkway'];
const NO_PICKS: Pick[] = [];
type ArrangeOp = 'top' | 'bottom' | 'left' | 'right' | 'row' | 'column';

// Lines up or spaces the picked items. The first picked item is the reference: it never moves, and directions are its own:
// "across" runs along its rows (left to right), "top to bottom" runs from its back edge to its front edge.
function arrange(d: Design, mods: ModuleSpec[], picks: Pick[], op: ArrangeOp, gap: number): { design?: Design; error?: string } {
  const items = picks.map((p) => footprint(d, mods, p)).filter(Boolean) as Foot<Pick>[];
  if (items.length < 2) return { error: 'Select at least two items first (Ctrl + click).' };
  const c = Math.cos(items[0].yaw), s = Math.sin(items[0].yaw);
  const U: Pt = [c, -s], V: Pt = [s, c];
  const ext = items.map((it) => {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [wx, wz] of it.corners) {
      const u = wx * U[0] + wz * U[1], v = wx * V[0] + wz * V[1];
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    return { u0, u1, v0, v1 };
  });
  const du = items.map(() => 0), dv = items.map(() => 0);
  if (op === 'top') items.forEach((_, i) => { dv[i] = ext[0].v0 - ext[i].v0; });
  else if (op === 'bottom') items.forEach((_, i) => { dv[i] = ext[0].v1 - ext[i].v1; });
  else if (op === 'left') items.forEach((_, i) => { du[i] = ext[0].u0 - ext[i].u0; });
  else if (op === 'right') items.forEach((_, i) => { du[i] = ext[0].u1 - ext[i].u1; });
  else {
    // the others line up on either side of the first item, in the order they are in now
    const row = op === 'row', lo = (i: number) => (row ? ext[i].u0 : ext[i].v0), hi = (i: number) => (row ? ext[i].u1 : ext[i].v1), mid = (i: number) => lo(i) + hi(i);
    const rest = items.map((_, i) => i).slice(1), set = (i: number, m: number) => { if (row) du[i] = m; else dv[i] = m; };
    let edge = hi(0);
    for (const i of rest.filter((q) => mid(q) >= mid(0)).sort((a, b) => mid(a) - mid(b))) { const m = edge + gap - lo(i); set(i, m); edge = hi(i) + m; }
    edge = lo(0);
    for (const i of rest.filter((q) => mid(q) < mid(0)).sort((a, b) => mid(b) - mid(a))) { const m = edge - gap - hi(i); set(i, m); edge = lo(i) + m; }
  }
  const at = new Map<string, { x: number; z: number }>();
  items.forEach((it, i) => at.set(it.p.kind + it.p.id, { x: r3(it.x + du[i] * U[0] + dv[i] * V[0]), z: r3(it.z + du[i] * U[1] + dv[i] * V[1]) }));
  const put = <T extends { id: string; x: number; z: number }>(kind: string, list: T[]) => list.map((o) => { const n = at.get(kind + o.id); return n ? { ...o, ...n } : o; });
  const next = { ...d, blocks: put('block', d.blocks), obstructions: put('obstruction', d.obstructions), walkways: put('walkway', d.walkways) };
  // nothing is moved when any item would leave its shed or land on another item
  const err = moveError(d, next, mods, items.slice(1).map((it) => it.p));
  if (err) return { error: `No space for that. ${err} Nothing was moved: use a smaller gap, or move “${items[0].name}” (the first item selected) to make room.` };
  return { design: next };
}

// Panel sets on a shed sit on its roof. Rows, columns and position are set by the user.
// Flat roof: only the height follows the shed. Sloped roof: the set also lies in the roof plane (same tilt and direction).
function refit(d: Design, mods: ModuleSpec[], only?: string): Design {
  return {
    ...d, blocks: d.blocks.map((b) => {
      if (!b.shedId || (only && b.shedId !== only)) return b;
      const shed = d.sheds.find((s) => s.id === b.shedId);
      if (!shed) return b;
      if (!((shed.tilt || 0) > 0)) return { ...b, roofRise: undefined, mountHeight: r2(shed.height + ROOF_CLEARANCE) };
      if (b.ownTilt) { // keeps its own tilt and direction; every panel stands just clear of the sloped roof
        const T = Math.tan((shed.tilt! * Math.PI) / 180), a = ((shed.slopeAz ?? 180) * Math.PI) / 180, gx = -Math.sin(a) * T, gz = Math.cos(a) * T;
        const yaw = blockYaw(b.azimuth), c = Math.cos(yaw), s = Math.sin(yaw), r5 = (v: number) => Math.round(v * 1e5) / 1e5;
        return { ...b, mounting: 'rows', roofRise: [r5(gx * c - gz * s), r5(gx * s + gz * c)], mountHeight: r2(shedRoofY(shed, b.x, b.z) + ROOF_CLEARANCE) };
      }
      const nb: Block = { ...b, roofRise: undefined, mounting: 'flush', tilt: shed.tilt!, azimuth: shed.slopeAz ?? 180 };
      const L = blockLayout(nb, findModule(mods, nb.moduleId));
      const [fx, fz] = toWorld(nb.x, nb.z, blockYaw(nb.azimuth), 0, L.depth / 2); // middle of the set's lowest edge
      return { ...nb, mountHeight: r2(shedRoofY(shed, fx, fz) + ROOF_CLEARANCE) };
    }),
  };
}

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { design, setDesign, project, setProject, settings, mods, error, stale, calculate, calcBusy, calcError } = useDesign(id);
  const scene = useRef<SceneHandle>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [multi, setMulti] = useState<Pick[]>([]); // Ctrl+click selection; used while nothing single is selected
  const [gap, setGap] = useState(0.5);
  const selRef = useRef<Selection>(null), multiRef = useRef<Pick[]>([]);
  selRef.current = sel; multiRef.current = multi;
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [tool, setTool] = useState<Tool>('select');
  const [draw, setDraw] = useState<DrawKind | null>(null);
  const [drawInfo, setDrawInfo] = useState<{ points: Pt[]; cursor: Pt | null } | null>(null);
  const [notice, setNotice] = useState('');
  const [shedMenu, setShedMenu] = useState(false); // the three ways to add a shed
  const [drawRect, setDrawRect] = useState(false); // the outline being drawn is a three-click rectangle
  const [shedForm, setShedForm] = useState<null | { l: number; w: number; rot: number; h: number }>(null); // a shed typed as dimensions
  const [obMenu, setObMenu] = useState(false); // the three kinds under "Add obstruction" (commercial projects)
  const [sunOn, setSunOn] = useState(false);
  const [month, setMonth] = useState(5);
  const [hour, setHour] = useState(12);
  const [status, setStatus] = useState<'saved' | 'unsaved' | 'saving' | 'error'>('saved');
  const [confirmDel, setConfirmDel] = useState(false);
  const [, force] = useState(0);
  const past = useRef<Design[]>([]), future = useRef<Design[]>([]);
  const latest = useRef<Design | null>(null);
  const dirty = useRef(false), timer = useRef<any>(null), saving = useRef<Promise<void> | null>(null);
  latest.current = design;

  // ---------- saving ----------
  const save = useCallback(async (withThumb = false) => {
    clearTimeout(timer.current);
    if (saving.current) await saving.current;
    const d = latest.current;
    if (!d || (!dirty.current && !withThumb)) return;
    dirty.current = false;
    setStatus('saving');
    const body: any = { name: d.name, sheds: d.sheds, keepouts: d.keepouts, blocks: d.blocks, obstructions: d.obstructions, walkways: d.walkways, inverter: d.inverter, defaultModuleId: d.defaultModuleId, structureName: d.structureName, defaultStructure: d.defaultStructure };
    if (withThumb) { try { body.thumb = scene.current?.engine()?.snapshot({ size: 480, quality: 0.72 }); } catch { /* picture is optional */ } }
    saving.current = api(`/api/designs/${id}`, 'PUT', body)
      .then(() => { if (!dirty.current) setStatus('saved'); })
      .catch(() => { dirty.current = true; setStatus('error'); })
      .finally(() => { saving.current = null; });
    await saving.current;
  }, [id]);

  const apply = useCallback((next: Design, record = true) => {
    const cur = latest.current;
    if (!cur) return;
    if (record) { past.current.push(cur); if (past.current.length > 80) past.current.shift(); future.current = []; }
    latest.current = next;
    setDesign(next);
    dirty.current = true; setStatus('unsaved');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(false), 800);
  }, [save, setDesign]);

  const undo = () => { const p = past.current.pop(); if (!p || !latest.current) return; future.current.push(latest.current); apply({ ...p, results: latest.current.results }, false); setSel(null); force((n) => n + 1); };
  const redo = () => { const f = future.current.pop(); if (!f || !latest.current) return; past.current.push(latest.current); apply({ ...f, results: latest.current.results }, false); setSel(null); force((n) => n + 1); };
  const go = async (url: string) => { await save(true); if (dirty.current) return; router.push(url); };

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); clearTimeout(timer.current); };
  }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(t); }, [notice]);

  // ---------- edits ----------
  const patchBlock = (bid: string, p: Partial<Block>) => {
    const d = latest.current!;
    const next = { ...d, blocks: d.blocks.map((b) => {
      if (b.id !== bid) return b;
      const nb = { ...b, ...p };
      nb.removed = nb.removed.filter((k) => { const [r, c] = k.split('-').map(Number); return r < nb.rows && c < nb.cols; });
      return nb;
    }) };
    const b = next.blocks.find((x) => x.id === bid);
    const fitted = b?.shedId ? refit(next, mods, b.shedId) : next, me = [{ kind: 'block', id: bid }];
    // a move must keep the set on its shed and clear of everything else; a change of size must not start an overlap
    const err = 'x' in p || 'z' in p ? moveError(d, fitted, mods, me) : overlapError(d, mods, me) ? null : overlapError(fitted, mods, me);
    if (err) {
      apply({ ...d }, false); // redraw as it was
      setNotice(`${err} Nothing was changed.`);
      return;
    }
    apply(fitted);
  };
  const patchShed = (sid: string, p: Partial<Shed>) => {
    const d = latest.current!;
    apply(refit({ ...d, sheds: d.sheds.map((s) => (s.id === sid ? { ...s, ...p } : s)) }, mods, sid));
  };
  const patchKeepout = (kid: string, p: Partial<Keepout>) => {
    const d = latest.current!;
    apply({ ...d, keepouts: d.keepouts.map((k) => (k.id === kid ? { ...k, ...p } : k)) });
  };
  const patchObj = (kind: 'obstructions' | 'walkways', oid: string, p: any) => {
    const d = latest.current!;
    const next = { ...d, [kind]: (d[kind] as any[]).map((o) => (o.id === oid ? { ...o, ...p } : o)) } as Design;
    const me = [{ kind: kind === 'obstructions' ? 'obstruction' : 'walkway', id: oid }];
    const err = 'x' in p || 'z' in p ? overlapError(next, mods, me) : ['w', 'l', 'rotation'].some((k) => k in p) && !overlapError(d, mods, me) ? overlapError(next, mods, me) : null;
    if (err) { apply({ ...d }, false); setNotice(`${err} Nothing was changed.`); return; }
    apply(next);
  };
  // a new item starts at the nearest clear place; when there is none it starts where asked and the user is told
  const settle = (d: Design, p: Pick): { design: Design; crowded: boolean } => {
    const at = freeSpot(d, mods, p);
    if (!at) return { design: d, crowded: true };
    const put = <T extends { id: string }>(l: T[]) => l.map((o) => (o.id === p.id ? { ...o, ...at } : o));
    return { design: p.kind === 'block' ? { ...d, blocks: put(d.blocks) } : p.kind === 'obstruction' ? { ...d, obstructions: put(d.obstructions) } : { ...d, walkways: put(d.walkways) }, crowded: false };
  };
  const CROWDED = 'There is no clear space for it nearby, so it lies over another item. Make it smaller or drag it to a clear place.';
  const centre = () => scene.current?.engine()?.viewCentre() || { x: 0, z: 0 };

  const startDraw = (kind: DrawKind, rect = false) => { setTool('select'); setSel(null); setNotice(''); setShedMenu(false); setShedForm(null); setDrawRect(rect); setDraw(kind); };
  const stopDraw = () => { setDraw(null); setDrawInfo(null); };
  // A shed from typed dimensions: a rectangle at the middle of the view, or beside the other sheds when that place is taken.
  const addShedBySize = () => {
    const d = latest.current!, f = shedForm; if (!f) return;
    const a = rad(f.rot), ux = Math.cos(a), uz = -Math.sin(a); // length runs east-west at 0 and turns anticlockwise
    const at = (cx: number, cz: number): Pt[] => ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as Pt[]).map(([i, j]) => [r2(cx + (i * f.l / 2) * ux - (j * f.w / 2) * uz), r2(cz + (i * f.l / 2) * uz + (j * f.w / 2) * ux)] as Pt);
    const box = (pts: Pt[]) => ({ x0: Math.min(...pts.map((q) => q[0])), x1: Math.max(...pts.map((q) => q[0])), z0: Math.min(...pts.map((q) => q[1])), z1: Math.max(...pts.map((q) => q[1])) });
    const c = centre();
    let pts = at(c.x, c.z);
    const mine = box(pts), others = d.sheds.map((s) => box(s.points));
    if (others.some((o) => o.x0 < mine.x1 && o.x1 > mine.x0 && o.z0 < mine.z1 && o.z1 > mine.z0)) {
      // 3 m east of everything already drawn, level with it
      const east = Math.max(...others.map((o) => o.x1)), mid = (Math.min(...others.map((o) => o.z0)) + Math.max(...others.map((o) => o.z1))) / 2;
      pts = at(east + 3 + (mine.x1 - mine.x0) / 2, mid);
    }
    const shed: Shed = { id: uid(), name: `Shed ${d.sheds.length + 1}`, points: pts, height: f.h, setback: 0.3 };
    apply({ ...d, sheds: [...d.sheds, shed] }); setSel({ kind: 'shed', id: shed.id }); setShedForm(null);
    setNotice(`Shed added: ${fmt(f.l)} × ${fmt(f.w)} m. Move it with the arrow keys, or drag its corner dots. Then press “Add panel set”.`);
    setTimeout(() => scene.current?.engine()?.fit(), 60);
  };

  // adds a manual panel set (rows x columns) on a shed; nothing is filled automatically
  const addPanels = (shedId?: string) => {
    const d = latest.current!;
    if (!d.sheds.length) { setNotice('Draw the shed outline first. Click each corner of the roof on the map.'); startDraw('shed'); return; }
    const selBlock = sel?.kind === 'block' ? d.blocks.find((b) => b.id === sel.id) : null;
    const sid = shedId || (sel?.kind === 'shed' ? sel.id : selBlock?.shedId) || (d.sheds.length === 1 ? d.sheds[0].id : '');
    const shed = d.sheds.find((q) => q.id === sid);
    if (!shed) { setNotice('Click the shed you want the panels on, then press “Add panel set”.'); return; }
    const n = d.blocks.filter((b) => b.shedId === shed.id).length + 1;
    const [cx, cz] = polyCentre(shed.points);
    const inside = pointInPoly(cx, cz, shed.points);
    const nb = newBlock(d), sloped = (shed.tilt || 0) > 0;
    const b: Block = { ...nb, name: `${shed.name} · set ${n}`, shedId: shed.id,
      azimuth: nb.ownTilt && sloped ? ((shed.slopeAz ?? 180) + 180) % 360 : shedAzimuth(shed), // reverse tilt faces away from the roof slope
      x: r2(inside ? cx : shed.points[0][0]), z: r2(inside ? cz : shed.points[0][1]), mountHeight: r2(shed.height + ROOF_CLEARANCE) };
    const placed = settle(refit({ ...d, blocks: [...d.blocks, b] }, mods, shed.id), { kind: 'block', id: b.id });
    apply(refit(placed.design, mods, shed.id));
    setSel({ kind: 'block', id: b.id }); setTool('select');
    setNotice(placed.crowded ? CROWDED : `Panel set added with 1 row × 1 column. Set rows, columns and gaps on the right, and drag it into place.`);
  };
  const clearPanels = (shedId: string) => {
    const d = latest.current!;
    apply({ ...d, blocks: d.blocks.filter((b) => b.shedId !== shedId) });
    setSel({ kind: 'shed', id: shedId }); setTool('select');
    setNotice('All panels removed from this shed. The outline is kept.');
  };

  const addObstruction = (type: ObstructionType = 'custom') => {
    setObMenu(false);
    const d = latest.current!; const c = centre();
    // with a shed (or one of its panel sets) selected, the obstruction starts on that roof
    const sid = sel?.kind === 'shed' ? sel.id : sel?.kind === 'block' ? d.blocks.find((b) => b.id === sel.id)?.shedId : d.sheds.length === 1 ? d.sheds[0].id : '';
    const on = d.sheds.find((q) => q.id === sid) || shedUnder(d, c.x, c.z);
    const at = on ? polyCentre(on.points) : [c.x, c.z];
    const label = type === 'skylight' ? 'Skylight' : type === 'fan' ? 'Exhaust fan' : 'Obstruction';
    const count = d.obstructions.filter((q) => (q.type || 'custom') === type).length + 1;
    // skylight: a clear roof sheet 1 m wide and 3 m long, running down the slope; exhaust fan: 0.6 m across and 0.6 m tall
    const size = type === 'skylight' ? { w: 3, l: 1, h: 0.05 } : type === 'fan' ? { w: 0.6, l: 0.6, h: 0.6 } : { w: 2, l: 2, h: on ? 1 : 2 };
    const o: Obstruction = { id: uid(), name: `${label} ${count}`, type, x: r2(at[0]), z: r2(at[1]), ...size, rotation: on ? (shedAzimuth(on) + 90) % 180 : 0 };
    if (on) setNotice(`${label} placed on the roof of ${on.name}. Drag it into place; it ${type === 'skylight' ? 'lies' : 'stands'} on the roof and follows its tilt.`);
    const placed = settle({ ...d, obstructions: [...d.obstructions, o] }, { kind: 'obstruction', id: o.id });
    if (placed.crowded) setNotice(CROWDED);
    apply(placed.design); setSel({ kind: 'obstruction', id: o.id }); setTool('select');
  };
  const addWalkway = () => {
    const d = latest.current!; const c = centre();
    // with a shed (or one of its panel sets) selected, the walkway starts on that roof, running along its long side
    const sid = sel?.kind === 'shed' ? sel.id : sel?.kind === 'block' ? d.blocks.find((b) => b.id === sel.id)?.shedId : d.sheds.length === 1 ? d.sheds[0].id : '';
    const on = d.sheds.find((q) => q.id === sid) || shedUnder(d, c.x, c.z);
    const at = on ? polyCentre(on.points) : [c.x, c.z];
    const w: Walkway = { id: uid(), name: `Walkway ${d.walkways.length + 1}`, x: r2(at[0]), z: r2(at[1]), w: 0.31, l: 3.66, h: 1, rotation: on ? (shedAzimuth(on) + 90) % 180 : 90 };
    if (on) setNotice(`Walkway placed on the roof of ${on.name}. Drag it into place; it follows the roof tilt.`);
    const placed = settle({ ...d, walkways: [...d.walkways, w] }, { kind: 'walkway', id: w.id });
    if (placed.crowded) setNotice(CROWDED);
    apply(placed.design); setSel({ kind: 'walkway', id: w.id }); setTool('select');
  };
  const canDuplicate = !!sel && (sel.kind === 'obstruction' || sel.kind === 'walkway' || sel.kind === 'block');
  const duplicate = () => {
    const d = latest.current!; if (!sel || !canDuplicate) return;
    if (sel.kind === 'block') {
      const b = d.blocks.find((x) => x.id === sel.id); if (!b) return;
      const L = blockSlots(b, findModule(mods, b.moduleId), d).L;
      const sh = b.shedId ? d.sheds.find((q) => q.id === b.shedId) : null;
      const off = sh ? 0 : L.width + 1; // a copy on a shed starts at the nearest clear place on the roof
      const nb = { ...b, id: uid(), name: sh ? `${sh.name} · set ${d.blocks.filter((q) => q.shedId === sh.id).length + 1}` : `Block ${d.blocks.length + 1}`, removed: [...b.removed], x: r2(b.x + off) };
      const placed = settle({ ...d, blocks: [...d.blocks, nb] }, { kind: 'block', id: nb.id });
      if (placed.crowded) setNotice(CROWDED);
      apply(refit(placed.design, mods)); setSel({ kind: 'block', id: nb.id });
    } else {
      const kind = sel.kind === 'obstruction' ? 'obstructions' : 'walkways';
      const o = (d[kind] as any[]).find((x) => x.id === sel.id); if (!o) return;
      // a walkway copy continues the run: end to end with the original, the short (width) edges touching
      const c = boxPlan(d, o), no = sel.kind === 'walkway' ? { ...o, id: uid(), name: `Walkway ${d.walkways.length + 1}`, x: r3(o.x + c[3][0] - c[0][0]), z: r3(o.z + c[3][1] - c[0][1]) } : { ...o, id: uid(), x: r2(o.x + o.w + 1) };
      const placed = settle({ ...d, [kind]: [...(d[kind] as any[]), no] } as Design, { kind: sel.kind, id: no.id });
      if (placed.crowded) setNotice(CROWDED);
      apply(placed.design); setSel({ kind: sel.kind, id: no.id });
    }
  };
  const removeSelected = () => {
    const d = latest.current!; if (!sel) return;
    const is = (k: string, oid: string) => sel.kind === k && oid === sel.id;
    apply({
      ...d,
      sheds: d.sheds.filter((s) => !is('shed', s.id)),
      keepouts: d.keepouts.filter((k) => !is('keepout', k.id)),
      blocks: d.blocks.filter((b) => !is('block', b.id) && !(sel.kind === 'shed' && b.shedId === sel.id)),
      obstructions: d.obstructions.filter((o) => !is('obstruction', o.id)),
      walkways: d.walkways.filter((o) => !is('walkway', o.id)),
    });
    setSel(null); setConfirmDel(false);
  };
  const nudge = (dx: number, dz: number) => {
    const d = latest.current!; if (!sel) return;
    if (sel.kind === 'block') { const b = d.blocks.find((x) => x.id === sel.id); if (b) patchBlock(b.id, { x: r2(b.x + dx), z: r2(b.z + dz) }); }
    else if (sel.kind === 'obstruction' || sel.kind === 'walkway') { const kind = sel.kind === 'obstruction' ? 'obstructions' : 'walkways'; const o = (d[kind] as any[]).find((x) => x.id === sel.id); if (o) patchObj(kind, o.id, { x: r2(o.x + dx), z: r2(o.z + dz) }); }
    else if (sel.kind === 'shed') {
      // everything on the roof moves with the shed: its panel sets and the obstructions and walkways standing on it
      const s = d.sheds.find((x) => x.id === sel.id);
      const ride = <T extends { x: number; z: number }>(o: T) => (shedUnder(d, o.x, o.z)?.id === s?.id ? { ...o, x: r2(o.x + dx), z: r2(o.z + dz) } : o);
      if (s) apply({ ...d, sheds: d.sheds.map((q) => (q.id === s.id ? { ...q, points: q.points.map(([x, z]) => [r2(x + dx), r2(z + dz)] as Pt) } : q)), blocks: d.blocks.map((b) => (b.shedId === s.id ? { ...b, x: r2(b.x + dx), z: r2(b.z + dz) } : b)), obstructions: d.obstructions.map(ride), walkways: d.walkways.map(ride) });
    }
    else if (sel.kind === 'keepout') { const k = d.keepouts.find((x) => x.id === sel.id); if (k) patchKeepout(k.id, { points: k.points.map(([x, z]) => [r2(x + dx), r2(z + dz)] as Pt) }); }
  };

  const events = useMemo(() => ({
    onSelect: (s: Selection, add?: boolean) => {
      if (!add || !s || !MOVABLE.includes(s.kind)) { setMulti([]); setSel(s); return; }
      const cur = selRef.current;
      const base = !cur && multiRef.current.length >= 2 ? multiRef.current : cur && MOVABLE.includes(cur.kind) ? [cur] : [];
      const has = base.some((p) => p.kind === s.kind && p.id === s.id);
      const next = has ? base.filter((p) => !(p.kind === s.kind && p.id === s.id)) : [...base, s];
      if (next.length >= 2) { setMulti(next); setSel(null); } else { setMulti([]); setSel(next[0] || null); }
    },
    onMove: (s: NonNullable<Selection>, x: number, z: number) => {
      if (s.kind === 'block') patchBlock(s.id, { x, z }); else if (s.kind === 'obstruction' || s.kind === 'walkway') patchObj(s.kind === 'obstruction' ? 'obstructions' : 'walkways', s.id, { x, z });
    },
    // asked while dragging: an item does not follow the pointer off its shed or onto another item
    canMove: (s: NonNullable<Selection>, x: number, z: number) => {
      const d = latest.current!;
      if (!MOVABLE.includes(s.kind)) return true;
      const put = <T extends { id: string }>(l: T[]) => l.map((o) => (o.id === s.id ? { ...o, x, z } : o));
      const after = s.kind === 'block' ? { ...d, blocks: put(d.blocks) } : s.kind === 'obstruction' ? { ...d, obstructions: put(d.obstructions) } : { ...d, walkways: put(d.walkways) };
      // an item that already lies over another may be dragged freely to get it clear; where it is dropped is still checked
      const err = shedError(d, after, mods, [s]) || (overlapError(d, mods, [s]) ? null : overlapError(after, mods, [s]));
      if (err) setNotice(err);
      return !err;
    },
    onTogglePanel: (bid: string, key: string, action: 'remove' | 'add') => {
      const b = latest.current!.blocks.find((x) => x.id === bid); if (!b) return;
      patchBlock(bid, { removed: action === 'remove' ? [...b.removed, key] : b.removed.filter((k) => k !== key) });
    },
    onVertexMove: (kind: DrawKind, sid: string, index: number, x: number, z: number) => {
      const d = latest.current!;
      const move = (pts: Pt[]) => pts.map((p, i) => (i === index ? ([x, z] as Pt) : p));
      if (kind === 'shed') { const s = d.sheds.find((q) => q.id === sid); if (s) patchShed(sid, { points: move(s.points) }); }
      else { const k = d.keepouts.find((q) => q.id === sid); if (k) patchKeepout(sid, { points: move(k.points) }); }
    },
    onDraw: (info: { kind: DrawKind; points: Pt[]; cursor: Pt | null } | null) => setDrawInfo(info),
    onDrawDone: (kind: DrawKind, points: Pt[]) => {
      const d = latest.current!;
      setDraw(null); setDrawInfo(null);
      if (polyArea(points) < 1) { setNotice('That outline is too small. Zoom in and click the corners again.'); return; }
      if (kind === 'shed') {
        const shed: Shed = { id: uid(), name: `Shed ${d.sheds.length + 1}`, points, height: 6, setback: 0.3 };
        // the outline only: panels are added from the Panels section
        apply({ ...d, sheds: [...d.sheds, shed] }); setSel({ kind: 'shed', id: shed.id });
        setNotice(`Shed measured: ${fmt(polyArea(points))} m². No panels yet: press “Add panel set” under 2 · Panels and enter rows and columns.`);
      } else {
        const k: Keepout = { id: uid(), name: `No-panel area ${d.keepouts.length + 1}`, points };
        const before = designTotals(d, mods).modules;
        const next = { ...d, keepouts: [...d.keepouts, k] };
        apply(next); setSel({ kind: 'keepout', id: k.id });
        const gone = before - designTotals(next, mods).modules;
        setNotice(`No-panel area marked: ${fmt(polyArea(points))} m². ${gone ? `${gone} panels removed from it.` : 'Panels will stay out of it.'}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [apply, mods]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
      if (draw) {
        if (e.key === 'Enter') { if (!scene.current?.engine()?.finishDraw()) setNotice(drawRect ? 'Click the far side of the rectangle to finish.' : 'Click at least 3 corners before finishing.'); }
        else if (e.key === 'Escape') stopDraw();
        else if (e.key === 'Backspace') { e.preventDefault(); scene.current?.engine()?.undoDrawPoint(); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && sel) { e.preventDefault(); duplicate(); }
      else if (e.key === 'Delete' && sel) setConfirmDel(true);
      else if (e.key === 'Escape') { setTool('select'); setSel(null); setMulti([]); }
      else if (sel && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const s = e.shiftKey ? 1 : 0.1;
        nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const sun = useMemo(() => {
    if (!sunOn || !project) return null;
    const n = dayOfYear(month, 21);
    return sunVector(project.lat, n, clockToSolar(hour, n, project.lng, project.utcOffset));
  }, [sunOn, month, hour, project]);

  const totalsNow = useMemo(() => (design ? designTotals(design, mods) : null), [design, mods]);

  if (!design || !project) {
    return <div className="ed" style={{ display: 'grid', placeItems: 'center', gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }}>{error ? <div className="eerr">{error} <Link href="/projects"><u>Back to projects</u></Link></div> : 'Loading design…'}</div>;
  }

  const totals = totalsNow!;
  const block = sel?.kind === 'block' ? design.blocks.find((b) => b.id === sel.id) : null;
  const obst = sel?.kind === 'obstruction' ? design.obstructions.find((o) => o.id === sel.id) : null;
  const walk = sel?.kind === 'walkway' ? design.walkways.find((o) => o.id === sel.id) : null;
  const shed = sel?.kind === 'shed' ? design.sheds.find((s) => s.id === sel.id) : null;
  const keep = sel?.kind === 'keepout' ? design.keepouts.find((k) => k.id === sel.id) : null;
  const picked = block || obst || walk || shed || keep;
  const many = !sel && multi.length >= 2 ? multi.map((p) => footprint(design, mods, p)).filter(Boolean) as Foot<Pick>[] : [];
  const group = many.length >= 2;
  const doArrange = (op: ArrangeOp) => {
    const r = arrange(latest.current!, mods, many.map((m) => m.p), op, gap);
    if (r.error || !r.design) { setNotice(r.error || 'Nothing to move.'); return; }
    apply(refit(r.design, mods));
    setNotice(op === 'row' || op === 'column' ? `Placed ${op === 'row' ? 'side by side' : 'one behind the other'} with a ${fmt(gap)} m gap.` : 'Edges lined up with the first item you selected.');
  };
  const removeGroup = () => {
    const d = latest.current!, gone = (k: string, oid: string) => many.some((m) => m.p.kind === k && m.p.id === oid);
    apply({ ...d, blocks: d.blocks.filter((b) => !gone('block', b.id)), obstructions: d.obstructions.filter((o) => !gone('obstruction', o.id)), walkways: d.walkways.filter((o) => !gone('walkway', o.id)) });
    setMulti([]); setNotice(`${many.length} items removed. Undo brings them back.`);
  };
  const res = design.results;

  let hint: string;
  if (draw) {
    const pts = drawInfo?.points || [], cur = drawInfo?.cursor;
    const what = draw === 'shed' ? 'shed roof' : 'area where panels must not go';
    if (drawRect) {
      const span = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!pts.length) hint = `Rectangle: click one corner of the ${what}. Scroll to zoom in for accuracy · Esc cancels`;
      else if (pts.length === 1) hint = `Click the next corner along the same edge${cur ? ` · this side ${fmt(span(pts[0], cur))} m` : ''} · Backspace undoes · Esc cancels`;
      else {
        const len = span(pts[0], pts[1]) || 1, wide = cur ? Math.abs((cur[0] - pts[0][0]) * -(pts[1][1] - pts[0][1]) + (cur[1] - pts[0][1]) * (pts[1][0] - pts[0][0])) / len : 0;
        hint = `Move across the roof and click the far side · ${fmt(len)} × ${fmt(wide)} m · area ${fmt(len * wide)} m² · Backspace undoes · Esc cancels`;
      }
    } else if (!pts.length) hint = `Click the first corner of the ${what}. Scroll to zoom in for accuracy · Esc cancels`;
    else {
      const last = pts[pts.length - 1];
      const side = cur ? Math.hypot(cur[0] - last[0], cur[1] - last[1]) : 0;
      const area = pts.length + (cur ? 1 : 0) >= 3 ? polyArea(cur ? [...pts, cur] : pts) : 0;
      hint = `${pts.length} corner${pts.length > 1 ? 's' : ''} · this side ${fmt(side)} m${area ? ` · area ${fmt(area)} m²` : ''} · ${pts.length >= 3 ? 'click the first corner or press Enter to finish' : 'keep clicking corners'} · Backspace undoes · Esc cancels`;
    }
  } else if (tool === 'panels') hint = 'Click a panel to remove it. Click a faded slot to put the panel back. Press Esc when done.';
  else if (shed && !design.blocks.some((b) => b.shedId === shed.id)) hint = 'Shed outline ready, no panels on it yet. Press “Add panel set”, then enter rows and columns.';
  else if (shed || keep) hint ='Drag the orange corner dots to adjust the outline · arrow keys move it 0.1 m (Shift = 1 m)';
  else if (block?.shedId) hint = 'Drag the set to move it on the shed · arrow keys nudge 0.1 m (Shift = 1 m) · set rows, columns and gaps on the right';
  else if (picked) hint = 'Drag to move · arrow keys nudge 0.1 m (Shift = 1 m) · Delete removes';
  else if (design.sheds.length === 0) hint = 'Step 1: press “Draw shed” and choose Rectangle, Corner by corner or By dimensions.';
  else if (group) hint = `${many.length} items selected · Ctrl + click adds or removes one · line them up or set the gap on the right · Esc clears`;
  else hint = view === '2d' ? 'Click a shed or its panels to edit · Ctrl + click selects several · drag empty space to pan · scroll to zoom' : 'Drag to rotate · right-drag to pan · scroll to zoom';

  return (
    <div className="ed">
      <div className="ed-top">
        <button className="ebtn" onClick={() => go(`/designs/${id}`)}>← Design summary</button>
        <span className="sep" />
        {settings?.company.logo && <img className="top-logo" src={settings.company.logo} alt={settings.company.name} />}
        <span className="name">{project.name}</span><span style={{ color: 'var(--ed-muted)' }}>/ {design.name}</span>
        <span className="sep" />
        <button className="ebtn" onClick={undo} disabled={!past.current.length} title="Undo (Ctrl+Z)">↶ Undo</button>
        <button className="ebtn" onClick={redo} disabled={!future.current.length} title="Redo (Ctrl+Y)">↷ Redo</button>
        <span className="small" style={{ color: status === 'error' ? '#ff9a9a' : 'var(--ed-muted)' }}>
          {status === 'saved' ? '✓ Saved' : status === 'saving' ? 'Saving…' : status === 'unsaved' ? 'Unsaved changes…' : <>Could not save. <u style={{ cursor: 'pointer' }} onClick={() => save(false)}>Retry</u></>}
        </span>
        <span className="grow" />
        <div className="eseg" style={{ width: 150 }}>
          <button className={view === '2d' ? 'on' : ''} onClick={() => setView('2d')}>2D plan</button>
          <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>3D</button>
        </div>
        <button className="ebtn" onClick={() => go(`/designs/${id}/view`)}>3D view ↗</button>
        <button className="ebtn primary" onClick={() => go(`/designs/${id}/report`)}>Report ↗</button>
      </div>

      <div className="ed-tools">
        <div className="tools-label">1 · Roof</div>
        <button className={`tool ${draw === 'shed' || shedMenu ? 'on' : ''}`} onClick={() => { if (draw === 'shed') stopDraw(); else { setObMenu(false); setShedMenu((v) => !v); } }} title="Add a shed roof: as a rectangle, corner by corner, or from its dimensions"><I d="M3 11l9-6 9 6M5 10v9h14v-9M9 19v-5h6v5" />Draw shed</button>
        {shedMenu && (
          <div className="tool-sub">
            <button onClick={() => startDraw('shed', true)} title="Three clicks: two corners along one edge, then the far side">Rectangle</button>
            <button onClick={() => startDraw('shed')} title="Click every corner of the roof, for any shape">Corner by corner</button>
            <button onClick={() => { stopDraw(); setShedMenu(false); setSel(null); setTool('select'); setShedForm({ l: 40, w: 20, rot: 0, h: 6 }); }} title="Type the length and width in metres">By dimensions</button>
          </div>
        )}
        <button className={`tool ${draw === 'keepout' ? 'on' : ''}`} onClick={() => (draw === 'keepout' ? stopDraw() : startDraw('keepout'))} title="Mark skylights, vents or any area that must stay free"><I d="M5 5h14v14H5zM5 5l14 14M19 5L5 19" />No-panel area</button>
        <div className="tools-label">2 · Panels</div>
        <button className="tool" onClick={() => { stopDraw(); addPanels(); }} title="Add a set of panels with your own rows and columns"><I d="M3 5h18v14H3zM3 12h18M9 5v14M15 5v14" />Add panel set</button>
        <button className={`tool ${tool === 'panels' && !draw ? 'on' : ''}`} onClick={() => { stopDraw(); setTool('panels'); setSel(null); }} disabled={!design.blocks.length} title="Add or remove single panels by clicking"><I d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM15 16.5h4M17 14.5v4" />Add / remove panels</button>
        <div className="tools-label">3 · Extras</div>
        <button className={`tool ${obMenu ? 'on' : ''}`} onClick={() => { stopDraw(); setShedMenu(false); if (project.type === 'commercial') setObMenu((v) => !v); else addObstruction(); }}><I d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" />Add obstruction</button>
        {obMenu && (
          <div className="tool-sub">
            <button onClick={() => addObstruction('skylight')} title="A clear roof sheet that lets daylight in. Panels cannot be placed on it.">Skylight</button>
            <button onClick={() => addObstruction('fan')} title="A roof exhaust fan (turbo ventilator). Its shadow is included in the generation.">Exhaust fan</button>
            <button onClick={() => addObstruction('custom')} title="A box with your own width, length and height">Custom</button>
          </div>
        )}
        <button className="tool" onClick={() => { stopDraw(); setObMenu(false); addWalkway(); }}><I d="M4 20L9 4M20 20L15 4M12 6v2M12 11v2M12 16v2" />Add walkway</button>
        <div className="tools-label">View</div>
        <button className={`tool ${tool === 'select' && !draw ? 'on' : ''}`} onClick={() => { stopDraw(); setTool('select'); }}><I d="M5 3l14 7-6 2-2 6z" />Select</button>
        <button className="tool" onClick={() => scene.current?.engine()?.fit()}><I d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />Fit to layout</button>
      </div>

      <div className="ed-canvas">
        <SceneView ref={scene} lat={project.lat} lng={project.lng} plain={project.noMap} interactive picture={project.imagery}
          onPicture={(c) => { setProject((p) => (p ? { ...p, imagery: c } : p)); api(`/api/projects/${project.id}`, 'PATCH', { imagery: c }).catch(() => {}); }} design={design} mods={mods} results={res}
          view={view} tool={tool} selected={sel} also={group ? multi : NO_PICKS} sun={sun} events={events} draw={draw} drawRect={drawRect} />
        {notice && <div className="hint" style={{ bottom: 58, background: '#1f6b2ee6' }}>{notice}</div>}
        <div className="hint">{hint}</div>
      </div>

      <div className="ed-side">
        {shedForm && !draw && (
          <>
            <h3>New shed by dimensions</h3>
            <div className="ed-sec" style={{ marginBottom: 18 }}><div className="t">Shed size</div>
              <div className="ef"><label>Length</label><Num value={shedForm.l} min={1} max={1000} step={0.5} unit="m" onCommit={(v) => setShedForm((s) => s && { ...s, l: v })} /></div>
              <div className="ef"><label>Width</label><Num value={shedForm.w} min={1} max={1000} step={0.5} unit="m" onCommit={(v) => setShedForm((s) => s && { ...s, w: v })} /></div>
              <div className="ef"><label>Rotation<small>0° = length runs east–west</small></label><Num value={shedForm.rot} min={0} max={359} step={1} unit="°" onCommit={(v) => setShedForm((s) => s && { ...s, rot: v })} /></div>
              <div className="ef"><label>Roof height<small>at the lowest edge</small></label><Num value={shedForm.h} min={0} max={80} step={0.5} unit="m" onCommit={(v) => setShedForm((s) => s && { ...s, h: v })} /></div>
              <button className="ebtn primary block" style={{ marginTop: 8 }} onClick={addShedBySize}>Add this shed</button>
              <button className="ebtn block" style={{ marginTop: 6 }} onClick={() => setShedForm(null)}>Cancel</button>
              <div style={{ color: 'var(--ed-muted)', fontSize: 12, marginTop: 8 }}>The shed is placed in the middle of the view, or beside the other sheds when that place is taken. Tilt and edge margin are set after it is added.</div>
            </div>
          </>
        )}
        {shed && <ShedPanel s={shed} design={design} mods={mods} patch={(p) => patchShed(shed.id, p)} onDelete={() => setConfirmDel(true)}
          onPanels={() => addPanels(shed.id)} onPick={(bid) => setSel({ kind: 'block', id: bid })} onClear={() => clearPanels(shed.id)} onKeepout={() => startDraw('keepout')} />}
        {keep && <KeepoutPanel k={keep} patch={(p) => patchKeepout(keep.id, p)} onDelete={() => setConfirmDel(true)} />}
        {block && <BlockPanel b={block} design={design} mods={mods} patch={(p) => patchBlock(block.id, p)} onDuplicate={duplicate} onDelete={() => setConfirmDel(true)}
          onPanelsTool={() => { setTool('panels'); setSel(null); }} onShed={() => block.shedId && setSel({ kind: 'shed', id: block.shedId })} />}
        {(obst || walk) && <BoxPanel o={(obst || walk)!} walkway={!!walk} roof={shedUnder(design, (obst || walk)!.x, (obst || walk)!.z)?.name || ''} patch={(p) => patchObj(obst ? 'obstructions' : 'walkways', (obst || walk)!.id, p)} onDuplicate={duplicate} onDelete={() => setConfirmDel(true)} />}
        {group && (
          <>
            <h3>{many.length} items selected</h3>
            <div className="ed-sec"><div className="t">Selected</div>
              {many.map((m, i) => <div className="kv" key={m.p.kind + m.p.id}><span>{m.name}</span><b style={{ fontWeight: 400 }}>{i === 0 ? 'stays in place' : m.p.kind === 'block' ? 'panel set' : m.p.kind}</b></div>)}
              <div style={{ color: 'var(--ed-muted)', fontSize: 12 }}>Ctrl + click an item on the map to add or remove it. Everything lines up with the first one in this list.</div>
            </div>
            <div className="ed-sec"><div className="t">Line up edges</div>
              <div className="eseg" style={{ marginBottom: 7 }}>
                <button onClick={() => doArrange('top')}>Top</button>
                <button onClick={() => doArrange('bottom')}>Bottom</button>
                <button onClick={() => doArrange('left')}>Left</button>
                <button onClick={() => doArrange('right')}>Right</button>
              </div>
              <div style={{ color: 'var(--ed-muted)', fontSize: 12 }}>Top is the back (upper) edge of the first item, bottom is its front (lower) edge.</div>
            </div>
            <div className="ed-sec"><div className="t">Keep next to each other</div>
              <div className="ef"><label>Gap between them<small>0 = touching</small></label><Num value={gap} min={0} max={100} step={0.05} unit="m" onCommit={(v) => setGap(v)} /></div>
              <button className="ebtn primary block" onClick={() => doArrange('row')}>Place side by side with this gap</button>
              <button className="ebtn block" style={{ marginTop: 6 }} onClick={() => doArrange('column')}>Place one behind the other with this gap</button>
              <div style={{ color: 'var(--ed-muted)', fontSize: 12, marginTop: 6 }}>The first item selected stays where it is; the others line up on either side of it in their current order. Nothing is moved if an item would leave its shed or land on another item.</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="ebtn grow" style={{ justifyContent: 'center' }} onClick={() => setMulti([])}>Clear selection</button>
              <button className="ebtn danger grow" style={{ justifyContent: 'center' }} onClick={removeGroup}>🗑 Delete all</button>
            </div>
          </>
        )}
        {!picked && !group && (
          <>
            <h3>Design summary</h3>
            <div className="kv"><span>Shed area</span><b>{design.sheds.length ? `${fmt(totals.shedArea)} m²` : '-'}</b></div>
            <div className="kv"><span>DC size</span><b>{fmt(totals.kwp)} kWp</b></div>
            <div className="kv"><span>Modules</span><b>{totals.modules}</b></div>
            <div className="kv"><span>AC size</span><b>{fmt(totals.acKw)} kW</b></div>
            <div className="kv"><span>DC:AC ratio</span><b>{totals.acKw ? fmt(totals.ratio) : '-'}</b></div>
            <div className="kv"><span>Walkways</span><b>{fmt(totals.walkwayLength)} m</b></div>
            {design.sheds.length === 0 && <button className="ebtn primary block" style={{ marginTop: 8 }} onClick={() => startDraw('shed', true)}>Draw the shed as a rectangle</button>}
            {design.sheds.length > 0 && (
              <div className="ed-sec"><div className="t">Sheds</div>
                {design.sheds.map((s) => {
                  const n = design.blocks.filter((x) => x.shedId === s.id).reduce((t, b) => t + blockSlots(b, findModule(mods, b.moduleId), design).active.length, 0);
                  return <button key={s.id} className="ebtn block" style={{ justifyContent: 'space-between', marginBottom: 6 }} onClick={() => setSel({ kind: 'shed', id: s.id })}><span>{s.name}</span><span style={{ color: 'var(--ed-muted)' }}>{fmt(polyArea(s.points), 0)} m² · {n} panels</span></button>;
                })}
              </div>
            )}
            {totals.kwp > 0 && totals.acKw > 0 && (totals.ratio > 1.5 || totals.ratio < 0.9) && <div className="ewarn">DC:AC ratio is {fmt(totals.ratio)}. Most plants sit between 1.0 and 1.4. Check the inverter size or quantity.</div>}

            <div className="ed-sec"><div className="t">Inverter</div>
              <div className="ef wide"><input className="einput" value={design.inverter.name} placeholder="Inverter make / model" onChange={(e) => apply({ ...design, inverter: { ...design.inverter, name: e.target.value } })} onKeyDown={(e) => e.stopPropagation()} /></div>
              <div className="ef"><label>Size of one inverter</label><Num value={design.inverter.kw} min={0.5} max={5000} step={5} unit="kW" onCommit={(v) => apply({ ...design, inverter: { ...design.inverter, kw: v } })} /></div>
              <div className="ef"><label>Quantity</label><Num value={design.inverter.qty} min={0} max={500} int onCommit={(v) => apply({ ...design, inverter: { ...design.inverter, qty: v } })} /></div>
              <button className="ebtn block" disabled={!totals.kwp} onClick={() => apply({ ...design, inverter: { ...design.inverter, qty: Math.max(1, Math.round(totals.kwp / 1.25 / design.inverter.kw)) } })}>Suggest quantity for DC:AC ≈ 1.25</button>
            </div>

            <div className="ed-sec"><div className="t">Defaults for new panels</div>
              <div className="ef wide"><select className="eselect" value={design.defaultModuleId} onChange={(e) => apply({ ...design, defaultModuleId: e.target.value })}>{mods.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.length} × {m.width} m)</option>)}</select></div>
              <div className="ef wide"><label>{STRUCTURE_BRAND} for new panel sets</label><select className="eselect" value={design.defaultStructure || 'monorail'} onChange={(e) => apply({ ...design, defaultStructure: e.target.value as StructureId })}>{STRUCTURES.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.orientation}{s.tilt ? `, ${s.tilt}° tilt` : ''})</option>)}</select></div>
              <div style={{ color: 'var(--ed-muted)', fontSize: 12 }}>Each panel set can use a different structure. Select a panel set to change it.</div>
            </div>

            <div className="ed-sec"><div className="t">Generation</div>
              {res ? (
                <>
                  <div className="kv"><span>Annual generation</span><b>{fmt(res.annualAc / 1000)} MWh</b></div>
                  <div className="kv"><span>Specific generation</span><b>{fmt0(res.specific)} kWh/kWp/yr</b></div>
                  <div className="kv"><span>Performance ratio</span><b>{fmt(res.pr)} %</b></div>
                  <div className="kv"><span>Shadow-free time</span><b>{fmt(res.shadeFreePct)} %</b></div>
                  {stale && <div className="ewarn">The layout changed after this calculation. Calculate again to update.</div>}
                </>
              ) : <div style={{ color: 'var(--ed-muted)', fontSize: 13, marginBottom: 8 }}>Not calculated yet.</div>}
              {calcError && <div className="eerr">{calcError}</div>}
              <button className="ebtn primary block" style={{ marginTop: 10 }} disabled={calcBusy || totals.modules === 0} onClick={() => calculate(() => save(true))}>{calcBusy ? 'Calculating…' : 'Calculate generation'}</button>
            </div>
          </>
        )}

        <div className="ed-sec"><div className="t">Sun &amp; shadows</div>
          <label className="switch">Show shadows<input type="checkbox" checked={sunOn} onChange={(e) => setSunOn(e.target.checked)} /></label>
          {sunOn && (
            <>
              <div className="kv"><span>Date</span><b>21 {SHORT_MONTHS[month]}</b></div>
              <input className="slider" type="range" min={0} max={11} value={month} onChange={(e) => setMonth(+e.target.value)} />
              <div className="kv"><span>Time</span><b>{clockLabel(hour)}</b></div>
              <input className="slider" type="range" min={5} max={19} step={0.25} value={hour} onChange={(e) => setHour(+e.target.value)} />
              {sun && sun[1] <= 0.02 && <div className="ewarn">The sun is below the horizon at this time.</div>}
            </>
          )}
        </div>
      </div>
      {confirmDel && sel && picked && <Confirm title="Delete this item?"
        text={`“${picked.name}” will be removed from the design${shed && design.blocks.some((b) => b.shedId === shed.id) ? ', together with the panels on it' : ''}. You can bring it back with Undo.`}
        action="Delete" onYes={removeSelected} onNo={() => setConfirmDel(false)} />}
    </div>
  );
}

function Head({ name, onName, onDuplicate, onDelete }: { name: string; onName: (s: string) => void; onDuplicate?: () => void; onDelete: () => void }) {
  return (
    <>
      <div className="ef wide"><input className="einput" style={{ fontWeight: 650, fontSize: 15 }} value={name} onChange={(e) => onName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></div>
      <div className="row" style={{ gap: 6 }}>
        {onDuplicate && <button className="ebtn grow" style={{ justifyContent: 'center' }} onClick={onDuplicate} title="Ctrl+D">⧉ Duplicate</button>}
        <button className="ebtn danger grow" style={{ justifyContent: 'center' }} onClick={onDelete}>🗑 Delete</button>
      </div>
    </>
  );
}

function ShedPanel({ s, design, mods, patch, onDelete, onPanels, onPick, onClear, onKeepout }: { s: Shed; design: Design; mods: ModuleSpec[]; patch: (p: Partial<Shed>) => void; onDelete: () => void; onPanels: () => void; onPick: (id: string) => void; onClear: () => void; onKeepout: () => void }) {
  const sets = design.blocks.filter((x) => x.shedId === s.id).map((b) => { const m = findModule(mods, b.moduleId); return { b, m, n: blockSlots(b, m, design).active.length }; });
  const total = sets.reduce((t, x) => t + x.n, 0);
  const kwp = sets.reduce((t, x) => t + (x.n * x.m.watt) / 1000, 0);
  const cover = sets.reduce((t, x) => t + x.n * x.m.length * x.m.width, 0);
  const sides = edgeLengths(s.points);
  const tilt = s.tilt || 0, az = s.slopeAz ?? shedAzimuth(s);
  return (
    <>
      <Head name={s.name} onName={(name) => patch({ name })} onDelete={onDelete} />
      <div className="ed-sec"><div className="t">Measured from your outline</div>
        <div className="kv"><span>{tilt > 0 ? 'Roof area on plan' : 'Roof area'}</span><b>{fmt(polyArea(s.points))} m²</b></div>
        {tilt > 0 && <div className="kv"><span>Roof sheet area along the slope</span><b>{fmt(polyArea(s.points) / Math.cos((tilt * Math.PI) / 180))} m²</b></div>}
        <div className="kv"><span>Perimeter</span><b>{fmt(polyPerimeter(s.points))} m</b></div>
        <div className="kv"><span>Corners</span><b>{s.points.length}</b></div>
        <div className="kv"><span>Sides</span><b style={{ fontWeight: 400 }}>{sides.map((l) => fmt(l, 1)).join(' · ')} m</b></div>
      </div>
      <div className="ed-sec"><div className="t">Shed</div>
        <div className="ef"><label>Roof height<small>{tilt > 0 ? 'at the lowest edge' : 'above ground'}</small></label><Num value={s.height} min={0} max={80} step={0.5} unit="m" onCommit={(v) => patch({ height: v })} /></div>
        <div className="ef"><label>Roof tilt<small>0 = flat roof</small></label><Num value={tilt} min={0} max={60} step={0.5} unit="°" onCommit={(v) => patch({ tilt: v, slopeAz: s.slopeAz ?? shedAzimuth(s) })} /></div>
        {tilt > 0 && (
          <>
            <div className="ef"><label>Roof slopes down towards<small>180° = south</small></label><Num value={az} min={0} max={360} step={0.5} unit="°" onCommit={(v) => patch({ slopeAz: v % 360 })} /></div>
            <div className="eseg" style={{ marginBottom: 7 }}>
              {[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([l, a]) => <button key={l} className={az === a ? 'on' : ''} onClick={() => patch({ slopeAz: a as number })}>{l}</button>)}
            </div>
            <div className="eseg" style={{ marginBottom: 7 }}>
              <button onClick={() => patch({ slopeAz: shedAzimuth(s) })}>Across long side</button>
              <button onClick={() => patch({ slopeAz: (az + 90) % 360 })}>Turn 90°</button>
              <button onClick={() => patch({ slopeAz: (az + 180) % 360 })}>Flip</button>
            </div>
            <div className="kv"><span>Highest edge of the roof</span><b>{fmt(shedTopY(s))} m</b></div>
            <div style={{ color: 'var(--ed-muted)', fontSize: 12 }}>Panels on this shed lie on the roof: they take this tilt and direction. For a roof with two slopes, draw one shed per slope.</div>
          </>
        )}
        <div className="ef"><label>Edge margin<small>kept free along every edge</small></label><Num value={s.setback} min={0} max={10} step={0.05} unit="m" onCommit={(v) => patch({ setback: v })} /></div>
      </div>
      <div className="ed-sec"><div className="t">Panel sets on this shed</div>
        {sets.length ? (
          <>
            {sets.map(({ b, n }) => <button key={b.id} className="ebtn block" style={{ justifyContent: 'space-between', marginBottom: 6 }} onClick={() => onPick(b.id)}><span>{b.name}</span><span style={{ color: 'var(--ed-muted)' }}>{b.rows} × {b.cols} · {n} panels</span></button>)}
            <div className="kv"><span>Panels placed</span><b>{total}</b></div>
            <div className="kv"><span>DC size</span><b>{fmt(kwp)} kWp</b></div>
            <div className="kv"><span>Roof covered by panels</span><b>{fmt((cover * 100) / Math.max(polyArea(s.points), 0.01), 0)} %</b></div>
          </>
        ) : <div style={{ color: 'var(--ed-muted)', fontSize: 13, marginBottom: 8 }}>No panels on this shed yet.</div>}
        <button className="ebtn primary block" style={{ marginTop: 8 }} onClick={onPanels}>+ Add panel set (rows × columns)</button>
        {sets.length > 0 && <button className="ebtn danger block" style={{ marginTop: 6 }} onClick={onClear}>Remove all panels from this shed</button>}
        <button className="ebtn block" style={{ marginTop: 6 }} onClick={onKeepout}>Mark an area where panels cannot go</button>
      </div>
      <div className="ewarn">Nothing is filled in automatically. Add as many panel sets as you need and give each its own rows, columns and gaps. Panels that would fall outside this outline are left out.</div>
    </>
  );
}

function KeepoutPanel({ k, patch, onDelete }: { k: Keepout; patch: (p: Partial<Keepout>) => void; onDelete: () => void }) {
  return (
    <>
      <Head name={k.name} onName={(name) => patch({ name })} onDelete={onDelete} />
      <div className="ed-sec"><div className="t">No-panel area</div>
        <div className="kv"><span>Area</span><b>{fmt(polyArea(k.points))} m²</b></div>
        <div className="kv"><span>Corners</span><b>{k.points.length}</b></div>
      </div>
      <div className="ewarn">No panel is placed where it would touch this red area. Use it for skylights, turbo vents, damaged sheets or maintenance paths. Drag the orange corner dots to adjust it.</div>
    </>
  );
}

function BlockPanel({ b, design, mods, patch, onDuplicate, onDelete, onPanelsTool, onShed }: { b: Block; design: Design; mods: ModuleSpec[]; patch: (p: Partial<Block>) => void; onDuplicate: () => void; onDelete: () => void; onPanelsTool: () => void; onShed: () => void }) {
  const m = findModule(mods, b.moduleId), S = blockSlots(b, m, design), L = S.L, n = S.active.length;
  const shed = b.shedId ? design.sheds.find((s) => s.id === b.shedId) : null;
  const removed = S.ghost.length;
  const sloped = !!shed && (shed.tilt || 0) > 0, onRoof = sloped && !b.ownTilt, slopeAz = shed?.slopeAz ?? 180;
  const st = structureOf(b);
  // on a sloped shed, changing the tilt or direction lifts the set off the roof plane onto its own tilt
  const own: Partial<Block> = sloped ? { ownTilt: true, mounting: 'rows' } : {};
  const face = (a: number) => patch({ ...own, azimuth: Math.round((((a % 360) + 360) % 360) * 100) / 100 });
  const turn = (d: number) => face(b.azimuth + d);
  const setStructure = (id: StructureId) => {
    const n = findStructure(id);
    // the row gap follows the structure's own default, unless it was changed by hand
    const gap = n.gapV ?? (st.gapV && b.gapV === st.gapV ? 0.025 : b.gapV);
    if (n.tilt) patch({ structure: id, orientation: n.orientation, mounting: 'rows', tilt: n.tilt, gapV: gap, ownTilt: true, azimuth: sloped ? (slopeAz + 180) % 360 : b.azimuth });
    else patch({ structure: id, orientation: n.orientation, gapV: gap, ownTilt: false, ...(st.tilt && !sloped ? { mounting: 'flush' as const, tilt: 0 } : {}) });
  };
  return (
    <>
      <Head name={b.name} onName={(name) => patch({ name })} onDuplicate={onDuplicate} onDelete={onDelete} />
      {shed && <button className="ebtn block" style={{ marginTop: 6 }} onClick={onShed}>← Back to {shed.name} (outline, height, margin)</button>}
      <div className="ed-sec"><div className="t">Summary</div>
        <div className="kv"><span>Modules</span><b>{n}</b></div>
        <div className="kv"><span>DC size</span><b>{fmt((n * m.watt) / 1000)} kWp</b></div>
        <div className="kv"><span>Set size on plan</span><b>{fmt(L.width)} × {fmt(L.depth)} m</b></div>
        {shed && b.rows * b.cols - S.usable > 0 && <div className="ewarn">{b.rows * b.cols - S.usable} of {b.rows * b.cols} places fall outside the shed outline, in its edge margin or in a no-panel area, and are left empty. Reduce rows or columns, or drag the set.</div>}
      </div>
      <div className="ed-sec"><div className="t">Panels</div>
        <div className="ef wide"><select className="eselect" value={m.id} onChange={(e) => patch({ moduleId: e.target.value })}>{mods.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.length} × {x.width} m)</option>)}</select></div>
        {<div className="ef"><label>Rows</label><Num value={b.rows} min={1} max={200} int onCommit={(v) => patch({ rows: v })} /></div>}
        {<div className="ef"><label>Columns</label><Num value={b.cols} min={1} max={400} int onCommit={(v) => patch({ cols: v })} /></div>}
      </div>
      <div className="ed-sec"><div className="t">Gaps</div>
        <div className="ef"><label>Gap between columns<small>side by side</small></label><Num value={b.gapH} min={0} max={20} step={0.005} unit="m" onCommit={(v) => patch({ gapH: v })} /></div>
        <div className="ef"><label>Gap between rows<small>{b.mounting === 'flush' ? 'along the roof slope' : 'clear gap on the ground'}</small></label><Num value={b.gapV} min={0} max={30} step={0.005} unit="m" onCommit={(v) => patch({ gapV: v })} /></div>
        <div className="ef"><label>Walkway gap after every<small>rows (0 = none)</small></label><Num value={b.aisleRowsEvery} min={0} max={200} int onCommit={(v) => patch({ aisleRowsEvery: v })} /></div>
        {b.aisleRowsEvery > 0 && <div className="ef"><label>Row walkway gap</label><Num value={b.aisleRowsGap} min={0} max={30} step={0.1} unit="m" onCommit={(v) => patch({ aisleRowsGap: v })} /></div>}
        <div className="ef"><label>Walkway gap after every<small>columns (0 = none)</small></label><Num value={b.aisleColsEvery} min={0} max={400} int onCommit={(v) => patch({ aisleColsEvery: v })} /></div>
        {b.aisleColsEvery > 0 && <div className="ef"><label>Column walkway gap</label><Num value={b.aisleColsGap} min={0} max={30} step={0.1} unit="m" onCommit={(v) => patch({ aisleColsGap: v })} /></div>}
      </div>
      <div className="ed-sec"><div className="t">Structure and tilt</div>
        <div className="ef wide"><label>{STRUCTURE_BRAND}</label><select className="eselect" value={st.id} onChange={(e) => setStructure(e.target.value as StructureId)}>
          {STRUCTURES.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.orientation}{x.tilt ? `, ${x.tilt}° tilt` : ''})</option>)}
        </select></div>
        <div className="kv"><span>Panel orientation</span><b>{b.orientation === 'portrait' ? 'Portrait' : 'Landscape'} (set by the structure)</b></div>
        {!sloped && !st.tilt && <div className="ef wide"><select className="eselect" value={b.mounting} onChange={(e) => patch({ mounting: e.target.value as any })}>
          <option value="flush">One flat plane</option>
          <option value="rows">Every row tilted on its own</option>
        </select></div>}
        <div className="ef"><label>Panel tilt<small>{onRoof ? 'lying on the shed roof' : '0 = flat'}</small></label><Num value={b.tilt} min={0} max={60} step={0.5} unit="°" onCommit={(v) => patch({ ...own, tilt: v })} /></div>
        <div className="ef"><label>Panels slope down towards<small>180° = south</small></label><Num value={b.azimuth} min={0} max={360} step={0.5} unit="°" onCommit={(v) => face(v)} /></div>
        <div className="eseg" style={{ marginBottom: 7 }}>
          {[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([l, a]) => <button key={l} className={b.azimuth === a ? 'on' : ''} onClick={() => face(a as number)}>{l}</button>)}
        </div>
        <div className="eseg" style={{ marginBottom: 7 }}>
          {shed && <button onClick={() => face(shedAzimuth(shed))}>Across long side</button>}
          <button onClick={() => turn(90)}>Turn 90°</button>
          <button onClick={() => turn(180)}>Flip</button>
        </div>
        {sloped && (
          <>
            <div className="eseg" style={{ marginBottom: 7 }}>
              {!st.tilt && <button className={onRoof ? 'on' : ''} onClick={() => patch({ ownTilt: false })}>Lie on the roof</button>}
              <button className={!onRoof && b.azimuth === (slopeAz + 180) % 360 ? 'on' : ''} onClick={() => face(slopeAz + 180)}>Reverse to the roof</button>
            </div>
            <div style={{ color: 'var(--ed-muted)', fontSize: 12 }}>{onRoof
              ? `These panels lie on the roof of ${shed!.name} (${fmt(shed!.tilt || 0, 1)}° towards ${fmt(slopeAz, 1)}°). Change the tilt or direction here to give this set its own.`
              : `This set has its own tilt, measured from level. The roof of ${shed!.name} slopes ${fmt(shed!.tilt || 0, 1)}° towards ${fmt(slopeAz, 1)}°; each panel stands just clear of it.`}</div>
          </>
        )}
        {!shed && <div className="ef"><label>Height above ground<small>lowest panel edge</small></label><Num value={b.mountHeight} min={0} max={80} step={0.1} unit="m" onCommit={(v) => patch({ mountHeight: v })} /></div>}
      </div>
      {(
        <div className="ed-sec"><div className="t">Position from the project pin</div>
          <div className="ef"><label>East</label><Num value={b.x} min={-2000} max={2000} step={0.1} unit="m" onCommit={(v) => patch({ x: v })} /></div>
          <div className="ef"><label>North</label><Num value={-b.z} min={-2000} max={2000} step={0.1} unit="m" onCommit={(v) => patch({ z: -v })} /></div>
        </div>
      )}
      <div className="ed-sec"><div className="t">Single panels</div>
        <div style={{ color: 'var(--ed-muted)', fontSize: 13, marginBottom: 8 }}>{removed > 0 ? `${removed} panel${removed > 1 ? 's' : ''} removed by hand.` : 'No panel has been removed by hand.'}</div>
        <button className="ebtn block" onClick={onPanelsTool}>Add / remove panels by clicking</button>
        {removed > 0 && <button className="ebtn block" style={{ marginTop: 6 }} onClick={() => patch({ removed: [] })}>Put all removed panels back</button>}
      </div>
    </>
  );
}

function BoxPanel({ o, walkway, roof, patch, onDuplicate, onDelete }: { o: Obstruction | Walkway; walkway: boolean; roof: string; patch: (p: any) => void; onDuplicate: () => void; onDelete: () => void }) {
  const kind: ObstructionType | '' = walkway ? '' : (o as Obstruction).type || 'custom';
  return (
    <>
      <Head name={o.name} onName={(name) => patch({ name })} onDuplicate={onDuplicate} onDelete={onDelete} />
      <div className="ed-sec"><div className="t">{walkway ? 'Walkway size' : kind === 'skylight' ? 'Skylight size' : kind === 'fan' ? 'Exhaust fan size' : 'Obstruction size'}</div>
        <div className="ef"><label>Width</label><Num value={o.w} min={0.1} max={500} step={0.01} unit="m" onCommit={(v) => patch({ w: v })} /></div>
        <div className="ef"><label>Length</label><Num value={o.l} min={0.1} max={1000} step={0.01} unit="m" onCommit={(v) => patch({ l: v })} /></div>
        {walkway && roof
          ? <div className="kv"><span>Height</span><b>on the roof of {roof}</b></div>
          : <div className="ef"><label>{walkway ? 'Height above ground' : 'Height'}<small>{walkway ? 'used on open ground' : roof ? `above the roof of ${roof}, follows its tilt` : 'casts a shadow on the panels'}</small></label><Num value={o.h} min={0} max={150} step={0.1} unit="m" onCommit={(v) => patch({ h: v })} /></div>}
        {walkway && roof && <div style={{ color: 'var(--ed-muted)', fontSize: 12 }}>The walkway lies on the roof and follows its tilt. Drag it off the shed to place it on the ground.</div>}
        <div className="ef"><label>Rotation<small>0° = length runs north–south</small></label><Num value={o.rotation} min={0} max={360} step={1} unit="°" onCommit={(v) => patch({ rotation: v % 360 })} /></div>
      </div>
      <div className="ed-sec"><div className="t">Position from the project pin</div>
        <div className="ef"><label>East</label><Num value={o.x} min={-2000} max={2000} step={0.1} unit="m" onCommit={(v) => patch({ x: v })} /></div>
        <div className="ef"><label>North</label><Num value={-o.z} min={-2000} max={2000} step={0.1} unit="m" onCommit={(v) => patch({ z: -v })} /></div>
      </div>
      {kind === 'custom' && <div className="ewarn">Use obstructions for water tanks, parapets, lift rooms or nearby buildings. Their shadows are included in “Calculate generation”.</div>}
      {kind === 'skylight' && <div className="ewarn">A skylight is a clear roof sheet. Panels cannot be placed over it.</div>}
      {kind === 'fan' && <div className="ewarn">A roof exhaust fan. Panels cannot be placed over it and its shadow is included in “Calculate generation”.</div>}
    </>
  );
}
