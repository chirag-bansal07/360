'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Design, ModuleSpec, Results } from '@/lib/types';
import type { ColorMode, DrawKind, Engine, EngineEvents, Selection, Tool } from '@/lib/engine';

type Props = {
  lat: number; lng: number; interactive: boolean; plain?: boolean;
  design: Design; mods: ModuleSpec[]; results: Results | null;
  view: '2d' | '3d'; tool: Tool; selected?: Selection; also?: NonNullable<Selection>[];
  sun?: [number, number, number] | null; colorMode?: ColorMode;
  events?: EngineEvents; overlay?: boolean; draw?: DrawKind | null;
};
export type SceneHandle = { engine: () => Engine | null };

const SceneView = forwardRef<SceneHandle, Props>(function SceneView(p, ref) {
  const host = useRef<HTMLDivElement>(null);
  const eng = useRef<Engine | null>(null);
  const events = useRef<EngineEvents>({});
  const [az, setAz] = useState(0);
  const [hover, setHover] = useState<{ action: string; x: number; y: number } | null>(null);
  const [failed, setFailed] = useState('');
  const [imagery, setImagery] = useState({ credit: 'Imagery © Esri, Maxar, Earthstar Geographics', warning: '' });
  events.current = p.events || {};
  useImperativeHandle(ref, () => ({ engine: () => eng.current }));

  useEffect(() => {
    let dead = false;
    import('@/lib/engine').then(({ Engine }) => {
      if (dead || !host.current) return;
      try {
        const e = new Engine(host.current, { lat: p.lat, lng: p.lng, interactive: p.interactive, plain: p.plain }, {
          onSelect: (s, add) => events.current.onSelect?.(s, add),
          onMove: (s, x, z) => events.current.onMove?.(s, x, z),
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
  useEffect(() => { eng.current?.setView(p.view); }, [p.view]);
  useEffect(() => { eng.current?.setTool(p.tool); if (p.tool !== 'panels') setHover(null); }, [p.tool]);
  useEffect(() => { eng.current?.setSelected(p.selected || null); }, [p.selected]);
  useEffect(() => { eng.current?.setAlso(p.also || []); }, [p.also]);
  useEffect(() => { eng.current?.setColorMode(p.colorMode || 'normal'); }, [p.colorMode]);
  useEffect(() => { eng.current?.setSun(p.sun || null); }, [p.sun]);
  useEffect(() => { if (p.draw) eng.current?.startDraw(p.draw); else eng.current?.cancelDraw(); }, [p.draw]);

  return (
    <>
      <div className="scene" ref={host} />
      {failed && <div className="hint" style={{ bottom: '50%' }}>{failed}</div>}
      {p.overlay !== false && (
        <>
          <div className="compass"><i style={{ transform: `rotate(${az}deg)` }} /></div>
          <div className="attrib">{imagery.credit}{imagery.warning && <> · {imagery.warning}</>}</div>
        </>
      )}
      {hover && <div className="hover-tip" style={{ left: hover.x, top: hover.y }}>{hover.action === 'remove' ? 'Click to remove this panel' : 'Click to add a panel here'}</div>}
    </>
  );
});
export default SceneView;
