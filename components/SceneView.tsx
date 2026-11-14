'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Design, ModuleSpec, Results } from '@/lib/types';
import type { ColorMode, DrawKind, Engine, EngineEvents, Selection, Tool } from '@/lib/engine';

type Props = {
  lat: number; lng: number; interactive: boolean; plain?: boolean; share?: string;
  picture?: 'auto' | 'solar' | 'tiles'; onPicture?: (choice: 'solar' | 'tiles') => void; // which picture lies under the layout, and the editor's switch for it
  design: Design; mods: ModuleSpec[]; results: Results | null;
  view: '2d' | '3d'; tool: Tool; selected?: Selection; also?: NonNullable<Selection>[];
  sun?: [number, number, number] | null; colorMode?: ColorMode;
  events?: EngineEvents; overlay?: boolean; draw?: DrawKind | null; drawRect?: boolean;
};
export type SceneHandle = { engine: () => Engine | null };

// The ground the satellite picture has to cover: a square centred on the middle of everything drawn (x east, z south of
// the site point), wide enough for the layout plus 40 m around it, never less than 160 m and never more than 340 m.
// An empty design gets 200 m around the site point.
function groundArea(d: Design): { span: number; x: number; z: number } {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const reach = (x: number, z: number, pad = 0) => { x0 = Math.min(x0, x - pad); x1 = Math.max(x1, x + pad); z0 = Math.min(z0, z - pad); z1 = Math.max(z1, z + pad); };
  for (const s of [...d.sheds, ...d.keepouts]) for (const [x, z] of s.points) reach(x, z);
  for (const b of d.blocks) reach(b.x, b.z, 25);
  for (const o of [...d.obstructions, ...d.walkways]) reach(o.x, o.z, 5);
  if (!isFinite(x0)) return { span: 200, x: 0, z: 0 };
  return { span: Math.max(160, Math.min(340, Math.ceil(Math.max(x1 - x0, z1 - z0) + 80))), x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
}

const SceneView = forwardRef<SceneHandle, Props>(function SceneView(p, ref) {
  const host = useRef<HTMLDivElement>(null);
  const eng = useRef<Engine | null>(null);
  const events = useRef<EngineEvents>({});
  const [az, setAz] = useState(0);
  const [hover, setHover] = useState<{ action: string; x: number; y: number } | null>(null);
  const [failed, setFailed] = useState('');
  const [imagery, setImagery] = useState<{ credit: string; warning: string; solar?: { shown: boolean } }>({ credit: 'Imagery © Esri, Maxar, Earthstar Geographics', warning: '' });
  events.current = p.events || {};
  useImperativeHandle(ref, () => ({ engine: () => eng.current }));

  useEffect(() => {
    let dead = false;
    import('@/lib/engine').then(({ Engine }) => {
      if (dead || !host.current) return;
      try {
        const e = new Engine(host.current, { lat: p.lat, lng: p.lng, interactive: p.interactive, plain: p.plain, share: p.share, picture: p.picture, ground: groundArea(p.design) }, {
          onSelect: (s, add) => events.current.onSelect?.(s, add),
          onMove: (s, x, z) => events.current.onMove?.(s, x, z),
          canMove: (s, x, z) => events.current.canMove?.(s, x, z) ?? true,
          onTogglePanel: (b, k, a) => events.current.onTogglePanel?.(b, k, a),
          onHover: (h) => setHover(h),
          onAzimuth: (d) => setAz(d),
          onImagery: (info) => setImagery(info),
          onVertexMove: (k, i, n, x, z) => events.current.onVertexMove?.(k, i, n, x, z),
          onDraw: (info) => events.current.onDraw?.(info),
          onDrawDone: (k, pts) => events.current.onDrawDone?.(k, pts),
        });
        eng.current = e;
        e.setData(p.design, p.mods, p.results);
        e.setView(p.view); e.setTool(p.tool); e.setSelected(p.selected || null); e.setAlso(p.also || []);
        e.setColorMode(p.colorMode || 'normal'); e.setSun(p.sun || null);
        e.fit();
      } catch {
        setFailed('This browser could not start the 3D view. Turn on hardware acceleration (WebGL) and reload.');
      }
    });
    return () => { dead = true; eng.current?.dispose(); eng.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.lat, p.lng, p.plain]);

  useEffect(() => { eng.current?.setData(p.design, p.mods, p.results); }, [p.design, p.mods, p.results]);
  useEffect(() => { eng.current?.setPicture(p.picture); }, [p.picture]);
  useEffect(() => { eng.current?.setView(p.view); }, [p.view]);
  useEffect(() => { eng.current?.setTool(p.tool); if (p.tool !== 'panels') setHover(null); }, [p.tool]);
  useEffect(() => { eng.current?.setSelected(p.selected || null); }, [p.selected]);
  useEffect(() => { eng.current?.setAlso(p.also || []); }, [p.also]);
  useEffect(() => { eng.current?.setColorMode(p.colorMode || 'normal'); }, [p.colorMode]);
  useEffect(() => { eng.current?.setSun(p.sun || null); }, [p.sun]);
  useEffect(() => { if (p.draw) eng.current?.startDraw(p.draw, !!p.drawRect); else eng.current?.cancelDraw(); }, [p.draw, p.drawRect]);

  return (
    <>
      <div className="scene" ref={host} />
      {failed && <div className="hint" style={{ bottom: '50%' }}>{failed}</div>}
      {p.overlay !== false && (
        <>
          <div className="compass"><i style={{ transform: `rotate(${az}deg)` }} /></div>
          <div className="attrib">{imagery.credit}{imagery.warning && <> · {imagery.warning}</>}
            {imagery.solar && p.onPicture && <> · <button type="button" className="attrib-btn" title="The two pictures can sit a few metres apart. Sheds drawn on one may need a small move on the other." onClick={() => p.onPicture!(imagery.solar!.shown ? 'tiles' : 'solar')}>{imagery.solar.shown ? 'Use the standard satellite picture' : 'Use the Google aerial picture'}</button></>}
          </div>
        </>
      )}
      {hover && <div className="hover-tip" style={{ left: hover.x, top: hover.y }}>{hover.action === 'remove' ? 'Click to remove this panel' : 'Click to add a panel here'}</div>}
    </>
  );
});
export default SceneView;
