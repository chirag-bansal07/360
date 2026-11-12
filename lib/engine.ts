// 3D scene used by the editor, the 3D view and the report images. Browser only.
// Axes: x = east, y = up, z = south. One unit = one metre.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Design, ModuleSpec, Pt, Results } from './types';
import { findModule } from './catalog';
import { shedRoofY, shedUnder, shedNormal, blockSlots, blockYaw, designBounds, polyCentre, pointInPoly, rad, PANEL_THICK } from './geometry';
import { tileXY, metresPerPixel } from './mercator';

export type Selection = { kind: 'block' | 'obstruction' | 'walkway' | 'shed' | 'keepout'; id: string } | null;
export type DrawKind = 'shed' | 'keepout';
export type ColorMode = 'normal' | 'access' | 'irradiance';
export type Tool = 'select' | 'panels';
export type EngineEvents = {
  onSelect?: (s: Selection, add?: boolean) => void; // add = Ctrl / Cmd / Shift was held
  onMove?: (s: NonNullable<Selection>, x: number, z: number) => void;
  canMove?: (s: NonNullable<Selection>, x: number, z: number) => boolean; // asked during a drag: false = the item may not stand there
  onTogglePanel?: (blockId: string, key: string, action: 'remove' | 'add') => void;
  onHover?: (h: { action: 'remove' | 'add'; x: number; y: number } | null) => void;
  onAzimuth?: (deg: number) => void;
  onVertexMove?: (kind: DrawKind, id: string, index: number, x: number, z: number) => void;
  onDraw?: (info: { kind: DrawKind; points: Pt[]; cursor: Pt | null } | null) => void;
  onDrawDone?: (kind: DrawKind, points: Pt[]) => void;
  // solar: set when a Google Solar API picture exists for the site; shown = it is the picture in use
  onImagery?: (info: { credit: string; warning: string; provider: string; zoom: number; solar?: { shown: boolean } }) => void;
};

function panelTexture(cellsX: number, cellsY: number, blue: boolean) {
  const c = document.createElement('canvas');
  c.width = cellsX * 32; c.height = cellsY * 32;
  const g = c.getContext('2d')!;
  if (blue) {
    const grad = g.createLinearGradient(0, 0, c.width, c.height);
    grad.addColorStop(0, '#1b5fb4'); grad.addColorStop(1, '#0d3f86');
    g.fillStyle = grad;
  } else g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = blue ? 'rgba(150,195,245,0.75)' : 'rgba(60,70,80,0.35)';
  g.lineWidth = 1.5;
  for (let i = 1; i < cellsX; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, c.height); g.stroke(); }
  for (let j = 1; j < cellsY; j++) { g.beginPath(); g.moveTo(0, j * 32); g.lineTo(c.width, j * 32); g.stroke(); }
  g.strokeStyle = blue ? '#e9eff6' : '#4a5560';
  g.lineWidth = 7;
  g.strokeRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function ramp(stops: [number, number, number, number][], v: number, out: THREE.Color) {
  v = Math.max(0, Math.min(1, v));
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i], f = (v - a[0]) / (b[0] - a[0] || 1);
      return out.setRGB((a[1] + (b[1] - a[1]) * f) / 255, (a[2] + (b[2] - a[2]) * f) / 255, (a[3] + (b[3] - a[3]) * f) / 255, THREE.SRGBColorSpace);
    }
  }
  const l = stops[stops.length - 1];
  return out.setRGB(l[1] / 255, l[2] / 255, l[3] / 255, THREE.SRGBColorSpace);
}
const ACCESS_RAMP: [number, number, number, number][] = [[0, 214, 54, 62], [0.5, 240, 200, 60], [1, 132, 204, 70]];
const IRR_RAMP: [number, number, number, number][] = [[0, 150, 40, 120], [0.5, 240, 110, 40], [1, 246, 238, 40]];

// Unsharp mask with a small contrast lift. Makes roof edges, skylights and sheet lines easier to see in soft imagery.
function sharpen(g: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  const im = g.getImageData(0, 0, w, h), a = im.data, o = new Uint8ClampedArray(a);
  const row = w * 4, k = 1 + 4 * amount;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const i = p + c;
        const v = o[i] * k - amount * (o[i - 4] + o[i + 4] + o[i - row] + o[i + row]);
        a[i] = (v - 128) * 1.04 + 128;
      }
    }
  }
  g.putImageData(im, 0, 0);
}

export class Engine {
  readonly ready: Promise<void>;
  credit = 'Imagery © Esri, Maxar, Earthstar Geographics';
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private persp = new THREE.PerspectiveCamera(45, 1, 0.5, 5000);
  private ortho = new THREE.OrthographicCamera(-50, 50, 50, -50, 1, 3000);
  private camera: THREE.Camera;
  private controls!: OrbitControls;
  private ambient = new THREE.AmbientLight(0xffffff, Math.PI);
  private sunLight = new THREE.DirectionalLight(0xffffff, 0);
  private content = new THREE.Group();
  private ground: THREE.Mesh;
  private pickables: THREE.Object3D[] = [];
  private outlines: { line: THREE.Line; kind: string; id: string }[] = [];
  private ghosts: THREE.InstancedMesh[] = [];
  private textures: Record<string, THREE.Texture> = {};
  private view: '2d' | '3d' = '2d';
  private tool: Tool = 'select';
  private selected: Selection = null;
  private also: NonNullable<Selection>[] = []; // further items highlighted in a multi-selection
  private colorMode: ColorMode = 'normal';
  private sunDir: [number, number, number] | null = null;
  private design: Design | null = null;
  private mods: ModuleSpec[] = [];
  private results: Results | null = null;
  private orthoSize = 80;
  private dirty = true;
  private raf = 0;
  private ro: ResizeObserver;
  private disposed = false;
  private pic: THREE.Group | null = null; // Google Solar API picture of the site
  private picInfo: { dark: boolean; credit: string; tilesCredit: string; warning: string; provider: string; zoom: number } | null = null;
  private picChoice: 'auto' | 'solar' | 'tiles' | undefined;
  private drag: null | { sel: NonNullable<Selection>; obj: THREE.Object3D; ox: number; oz: number; gx: number; gz: number; gy: number; moved: boolean; placed: boolean } = null;
  private down: { x: number; y: number } | null = null;
  private handles: THREE.Mesh[] = [];
  private vdrag: null | { mesh: THREE.Mesh; y: number } = null;
  private draw: null | { kind: DrawKind; pts: Pt[]; cursor: Pt | null } = null;
  private drawGroup = new THREE.Group();

  constructor(private el: HTMLElement, private opts: { lat: number; lng: number; interactive: boolean; plain?: boolean; share?: string; picture?: 'auto' | 'solar' | 'tiles'; ground?: { span: number; x: number; z: number } }, private events: EngineEvents = {}) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color('#dfe5ea');
    el.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    const base = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({ color: '#cfd6dc' }));
    base.rotation.x = -Math.PI / 2; base.position.y = -0.2;
    this.scene.add(base);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ color: '#b9c2c9' }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground, this.ambient, this.sunLight, this.sunLight.target, this.content, this.drawGroup);
    this.sunLight.shadow.mapSize.set(4096, 4096);
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.04;

    this.ortho.up.set(0, 0, -1);
    this.camera = this.ortho;
    this.makeControls();
    this.fit();

    const dom = this.renderer.domElement;
    // capture phase: runs before the camera controls, so dragging a block does not also pan the map
    dom.addEventListener('pointerdown', this.onDown, true);
    dom.addEventListener('pointermove', this.onMove);
    dom.addEventListener('pointerup', this.onUp);
    dom.addEventListener('pointerleave', () => this.events.onHover?.(null));
    dom.addEventListener('dblclick', () => { if (this.draw) this.finishDraw(); });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.resize();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      if (this.dirty) { this.dirty = false; this.renderer.render(this.scene, this.camera); }
    };
    loop();
    this.ready = this.loadImagery();
  }

  // ---------- imagery ----------
  private async loadImagery() {
    const { lat, lng } = this.opts;
    if (this.opts.plain) { // project made from shed dimensions: plain ground with a 5 m grid, no satellite picture
      this.credit = '';
      this.ground.geometry.dispose();
      this.ground.geometry = new THREE.PlaneGeometry(1200, 1200);
      (this.ground.material as THREE.MeshLambertMaterial).color.set('#cdd4da');
      const grid = new THREE.GridHelper(1200, 240, '#8f9aa5', '#b4bdc6');
      grid.position.y = 0.02;
      this.scene.add(grid);
      this.events.onImagery?.({ credit: 'No map · plain ground with a 5 m grid', warning: '', provider: 'none', zoom: 0 });
      return;
    }
    const base = this.opts.share ? `/api/share/${this.opts.share}` : '/api'; // a shared link loads its pictures through the link
    let zoom = 18, provider = 'esri', overlay: { sizeE: number; sizeN: number; dx: number; dz: number; rot: number; dark?: boolean } | null = null;
    this.picChoice = this.opts.picture;
    try {
      const info = await (await fetch(`${base}/imagery?lat=${lat}&lng=${lng}`)).json();
      zoom = info.zoom || 18; provider = info.provider || 'esri'; overlay = info.overlay || null;
      this.credit = info.credit || this.credit;
      if (overlay && overlay.sizeE > 0) {
        this.picInfo = { dark: !!overlay.dark, credit: this.credit, tilesCredit: info.tilesCredit || this.credit, warning: info.warning || '', provider, zoom };
        this.applyPicture();
      } else this.events.onImagery?.({ credit: this.credit, warning: info.warning || '', provider, zoom });
    } catch { /* keep default */ }
    if (this.disposed) return;
    const mpp = metresPerPixel(lat, zoom);
    // Only the ground the layout needs is loaded: "span" metres across, centred x metres east and z metres south of the
    // site point (the middle of what is drawn). Every tile is a paid request.
    const want = this.opts.ground || { span: 200, x: 0, z: 0 };
    const n = Math.max(3, Math.min(16, Math.ceil(want.span / (256 * mpp))));
    const t = tileXY(lat, lng, zoom);
    const x0 = Math.round(t.x + want.x / (256 * mpp) - n / 2), y0 = Math.round(t.y + want.z / (256 * mpp) - n / 2);
    // tiles are collected at their own size in "src", then enlarged and sharpened into the picture on the ground
    const up = Math.max(1, Math.min(3, Math.floor(4096 / (n * 256))));
    const src = document.createElement('canvas');
    src.width = src.height = n * 256;
    const sg = src.getContext('2d', { willReadFrequently: true })!;
    sg.fillStyle = '#b9c2c9'; sg.fillRect(0, 0, src.width, src.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = n * 256 * up;
    const g = canvas.getContext('2d')!;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.fillStyle = '#b9c2c9'; g.fillRect(0, 0, canvas.width, canvas.height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const size = n * 256 * mpp;
    this.ground.geometry.dispose();
    this.ground.geometry = new THREE.PlaneGeometry(size, size);
    this.ground.position.set((n * 128 - (t.x - x0) * 256) * mpp, 0, (n * 128 - (t.y - y0) * 256) * mpp);
    (this.ground.material as THREE.MeshLambertMaterial).dispose();
    this.ground.material = new THREE.MeshLambertMaterial({ map: tex });
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      jobs.push(new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { sg.drawImage(img, i * 256, j * 256, 256, 256); g.drawImage(img, i * 256 * up, j * 256 * up, 256 * up, 256 * up); tex.needsUpdate = true; this.dirty = true; resolve(); };
        img.onerror = () => resolve();
        img.src = `${base}/tile/${zoom}/${x0 + i}/${y0 + j}${provider === 'google' ? '?p=google' : ''}`;
      }));
    }
    // the sharp aerial picture of the site itself (Google Solar API), laid just above the tiles
    if (overlay && overlay.sizeE > 0) {
      const o = overlay;
      jobs.push(new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          if (this.disposed) return resolve();
          const t = new THREE.Texture(img);
          t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); t.needsUpdate = true;
          const pic = new THREE.Mesh(new THREE.PlaneGeometry(o.sizeE, o.sizeN), new THREE.MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
          pic.rotation.x = -Math.PI / 2; pic.receiveShadow = true;
          const holder = new THREE.Group();
          holder.add(pic); holder.position.set(o.dx, 0.004, o.dz); holder.rotation.y = (-o.rot * Math.PI) / 180;
          this.scene.add(holder);
          this.pic = holder;
          this.applyPicture(); resolve();
        };
        img.onerror = () => resolve();
        img.src = `${base}/solar?lat=${lat}&lng=${lng}`;
      }));
    }
    await Promise.all(jobs);
    if (this.disposed) return;
    try {
      sharpen(sg, src.width, src.height, 0.4);
      g.drawImage(src, 0, 0, canvas.width, canvas.height);
      tex.needsUpdate = true;
    } catch { /* keep the plain picture */ }
    this.dirty = true;
  }

  // Which picture lies under the layout. Not set: the Google Solar API picture, unless it was taken in poor light.
  setPicture(choice?: 'auto' | 'solar' | 'tiles') { this.picChoice = choice; this.applyPicture(); }
  private applyPicture() {
    const p = this.picInfo;
    if (!p) return;
    const shown = this.picChoice === 'solar' || (this.picChoice !== 'tiles' && !p.dark);
    if (this.pic) this.pic.visible = shown;
    this.credit = shown ? p.credit : p.tilesCredit;
    this.events.onImagery?.({ credit: this.credit, warning: p.warning, provider: p.provider, zoom: p.zoom, solar: { shown } });
    this.dirty = true;
  }

  // ---------- data ----------
  setData(design: Design, mods: ModuleSpec[], results: Results | null) {
    this.design = design; this.mods = mods; this.results = results;
    this.rebuild();
  }

  private tex(orientation: string, blue: boolean) {
    const k = `${orientation}-${blue}`;
    if (!this.textures[k]) this.textures[k] = orientation === 'portrait' ? panelTexture(6, 12, blue) : panelTexture(12, 6, blue);
    return this.textures[k];
  }

  private clearContent() {
    this.content.traverse((o: any) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose());
    });
    this.content.clear();
    this.pickables = []; this.outlines = []; this.ghosts = []; this.handles = [];
  }

  private rebuild() {
    const d = this.design;
    this.clearContent();
    if (!d) return;
    const colored = this.colorMode !== 'normal';
    let maxIrr = 0;
    if (this.results) for (const v of Object.values(this.results.poaByBlock || {})) maxIrr = Math.max(maxIrr, v);
    const side = new THREE.MeshLambertMaterial({ color: '#2b3440' });
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();

    for (const b of d.blocks) {
      const m = findModule(this.mods, b.moduleId);
      const { L, active: on, ghost: off } = blockSlots(b, m, d);
      const group = new THREE.Group();
      group.position.set(b.x, 0, b.z);
      group.rotation.y = blockYaw(b.azimuth);
      group.userData.sel = { kind: 'block', id: b.id };
      const onShed = !!b.shedId && (d.sheds || []).some((s) => s.id === b.shedId);
      const geo = new THREE.BoxGeometry(L.Lu, PANEL_THICK, L.Lv);
      const top = new THREE.MeshLambertMaterial({ map: this.tex(b.orientation, !colored) });
      const access = this.results?.access?.[b.id] || {};
      const blockIrr = this.results?.poaByBlock?.[b.id] ?? 0;
      if (on.length) {
        const mesh = new THREE.InstancedMesh(geo, [side, side, top, side, side, side], on.length);
        on.forEach((s, i) => {
          dummy.position.set(s.lx, s.ly, s.lz); dummy.rotation.set(L.tilt, 0, 0); dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          const a = access[s.key] ?? 1;
          if (this.colorMode === 'access') ramp(ACCESS_RAMP, (a - 0.5) * 2, col);
          else if (this.colorMode === 'irradiance') ramp(IRR_RAMP, maxIrr ? ((blockIrr * a) / maxIrr - 0.6) / 0.4 : 1, col);
          else col.setRGB(1, 1, 1);
          mesh.setColorAt(i, col);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData = { sel: group.userData.sel, keys: on.map((s) => s.key), action: 'remove' };
        mesh.computeBoundingSphere();
        group.add(mesh); this.pickables.push(mesh);
      }
      if (off.length) {
        const ghost = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.32, depthWrite: false }), off.length);
        off.forEach((s, i) => { dummy.position.set(s.lx, s.ly, s.lz); dummy.rotation.set(L.tilt, 0, 0); dummy.updateMatrix(); ghost.setMatrixAt(i, dummy.matrix); });
        ghost.userData = { sel: group.userData.sel, keys: off.map((s) => s.key), action: 'add' };
        ghost.visible = this.tool === 'panels';
        ghost.computeBoundingSphere();
        group.add(ghost); this.ghosts.push(ghost); this.pickables.push(ghost);
      }
      // support posts so raised panels do not look like they float
      if (b.mountHeight >= 0.3 && !onShed) {
        const nx = Math.max(1, Math.round(L.width / 4));
        const backH = b.mounting === 'flush' ? L.topY : b.mountHeight + L.Lv * Math.sin(L.tilt);
        const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1, 0.08), new THREE.MeshLambertMaterial({ color: '#8d969e' }), (nx + 1) * 2);
        let k = 0;
        for (let i = 0; i <= nx; i++) for (const [zz, h] of [[L.depth / 2 - 0.05, b.mountHeight], [-L.depth / 2 + 0.05, backH]]) {
          dummy.position.set(-L.width / 2 + (L.width * i) / nx, h / 2 - 0.02, zz); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, Math.max(h - 0.04, 0.01), 1); dummy.updateMatrix();
          posts.setMatrixAt(k++, dummy.matrix);
        }
        dummy.scale.set(1, 1, 1);
        posts.castShadow = true;
        group.add(posts);
      }
      // outline follows the panel plane: high edge at the back, low edge at the front
      const hw = L.width / 2 + 0.12, hd = L.depth / 2 + 0.12, y = L.topY + 0.08;
      const yf = b.mounting === 'flush' ? b.mountHeight + 0.08 : y;
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-hw, y, -hd), new THREE.Vector3(hw, y, -hd), new THREE.Vector3(hw, yf, hd), new THREE.Vector3(-hw, yf, hd)]),
        new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthTest: false }));
      line.renderOrder = 5;
      group.add(line);
      this.outlines.push({ line, kind: 'block', id: b.id });
      this.content.add(group);
    }

    // sheds: a see-through building under the panels, drawn from the outline the user clicked
    const shape = (pts: Pt[]) => new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    type Y = (x: number, z: number) => number;
    const loop = (pts: Pt[], y: Y, color: string) => {
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, y(x, z), z))),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }));
      line.renderOrder = 6;
      return line;
    };
    const addHandles = (kind: DrawKind, id: string, pts: Pt[], y: Y) => {
      if (!this.opts.interactive || this.selected?.kind !== kind || this.selected.id !== id) return;
      pts.forEach(([x, z], index) => {
        const h = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), new THREE.MeshBasicMaterial({ color: '#ff8a00', depthTest: false }));
        h.position.set(x, y(x, z), z); h.renderOrder = 8;
        h.userData.vertex = { kind, id, index };
        this.content.add(h); this.handles.push(h);
      });
    };
    for (const sh of d.sheds || []) {
      if (sh.points.length < 3) continue;
      const hgt = Math.max(sh.height, 0.05);
      const geo = new THREE.ExtrudeGeometry(shape(sh.points), { depth: hgt, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      if ((sh.tilt || 0) > 0) { // sloped roof: lift the top of the building to the roof plane
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) if (pos.getY(i) > hgt / 2) pos.setY(i, Math.max(shedRoofY(sh, pos.getX(i), pos.getZ(i)), 0.05));
        pos.needsUpdate = true;
        geo.computeVertexNormals();
      }
      const roofY: Y = (x, z) => Math.max(shedRoofY(sh, x, z), 0.05) + 0.05;
      // the roof (and floor) stays see-through so the satellite picture shows in the plan; the walls are solid
      const mesh = new THREE.Mesh(geo, [
        new THREE.MeshLambertMaterial({ color: '#dfe6ee', transparent: true, opacity: 0.42, depthWrite: false }),
        new THREE.MeshLambertMaterial({ color: '#c5ced7' }), // outer faces only: seen through the roof, the inside of the far walls would make the shed look like an open box
      ]);
      mesh.castShadow = true;
      mesh.userData.sel = { kind: 'shed', id: sh.id };
      mesh.userData.locked = true;
      const line = loop(sh.points, roofY, '#ffffff');
      this.outlines.push({ line, kind: 'shed', id: sh.id });
      // a line up every corner, so the plain walls read as separate faces
      const corners = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(sh.points.flatMap(([x, z]) => [new THREE.Vector3(x, 0, z), new THREE.Vector3(x, roofY(x, z) - 0.05, z)])),
        new THREE.LineBasicMaterial({ color: '#86909b' }));
      this.content.add(mesh, line, corners); this.pickables.push(mesh);
      addHandles('shed', sh.id, sh.points, roofY);
    }
    for (const k of d.keepouts || []) {
      if (k.points.length < 3) continue;
      const [cx, cz] = polyCentre(k.points);
      const under = (d.sheds || []).filter((sh) => pointInPoly(cx, cz, sh.points));
      const ky: Y = (x, z) => under.reduce((h, sh) => Math.max(h, shedRoofY(sh, x, z)), 0) + 0.14; // lies on the roof it is drawn over
      const geo = new THREE.ShapeGeometry(shape(k.points));
      geo.rotateX(-Math.PI / 2);
      { const pos = geo.attributes.position; for (let i = 0; i < pos.count; i++) pos.setY(i, ky(pos.getX(i), pos.getZ(i))); pos.needsUpdate = true; }
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#e5484d', transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }));
      mesh.renderOrder = 3;
      mesh.userData.sel = { kind: 'keepout', id: k.id };
      mesh.userData.locked = true;
      const line = loop(k.points, (x, z) => ky(x, z) + 0.02, '#e5484d');
      this.outlines.push({ line, kind: 'keepout', id: k.id });
      this.content.add(mesh, line); this.pickables.push(mesh);
      addHandles('keepout', k.id, k.points, (x, z) => ky(x, z) + 0.02);
    }

    const box = (o: { id: string; x: number; z: number; w: number; l: number; h: number; rotation: number }, kind: 'obstruction' | 'walkway') => {
      const isWalk = kind === 'walkway';
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, isWalk ? 0.06 : o.h, o.l), new THREE.MeshLambertMaterial({ color: isWalk ? '#e3d9a8' : '#a7b0b9' }));
      // On a shed these sit on the roof: a walkway lies on the roof surface and follows its tilt, an obstruction stands on it.
      const roof = shedUnder(d, o.x, o.z);
      const base = roof ? shedRoofY(roof, o.x, o.z) : 0;
      const up = new THREE.Vector3(0, 1, 0);
      const turn = new THREE.Quaternion().setFromAxisAngle(up, -rad(o.rotation));
      if (roof) {
        const n = new THREE.Vector3(...shedNormal(roof));
        // a walkway lies just above the panels, straight over its place on the plan; an obstruction stands on the roof with its foot at that place
        if (isWalk) mesh.position.set(o.x, base + 0.2, o.z);
        else mesh.position.set(o.x, base, o.z).addScaledVector(n, o.h / 2);
        mesh.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(up, n).multiply(turn));
      } else {
        mesh.position.set(o.x, isWalk ? o.h + 0.03 : o.h / 2, o.z);
        mesh.quaternion.copy(turn);
      }
      mesh.castShadow = !isWalk; mesh.receiveShadow = true;
      mesh.userData.sel = { kind, id: o.id };
      const hw = o.w / 2 + 0.1, hl = o.l / 2 + 0.1, y = (isWalk ? 0.03 : o.h / 2) + 0.08;
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-hw, y, -hl), new THREE.Vector3(hw, y, -hl), new THREE.Vector3(hw, y, hl), new THREE.Vector3(-hw, y, hl)]),
        new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthTest: false }));
      line.renderOrder = 5;
      mesh.add(line);
      this.outlines.push({ line, kind, id: o.id });
      this.content.add(mesh); this.pickables.push(mesh);
    };
    d.obstructions.forEach((o) => box(o, 'obstruction'));
    d.walkways.forEach((o) => box(o, 'walkway'));
    this.applySelection();
    this.applySun();
    this.dirty = true;
  }

  // ---------- state ----------
  setSelected(s: Selection) {
    const shapes = (x: Selection) => !!x && (x.kind === 'shed' || x.kind === 'keepout');
    const redo = shapes(s) || shapes(this.selected);
    this.selected = s;
    if (redo) this.rebuild(); else this.applySelection(); // corner handles belong to the selected outline
    this.dirty = true;
  }
  setAlso(list: NonNullable<Selection>[]) { this.also = list; this.applySelection(); this.dirty = true; }
  private applySelection() {
    for (const o of this.outlines) {
      const sel = (!!this.selected && this.selected.kind === o.kind && this.selected.id === o.id) || this.also.some((a) => a.kind === o.kind && a.id === o.id);
      const mat = o.line.material as THREE.LineBasicMaterial;
      mat.color.set(sel ? '#ff8a00' : o.kind === 'keepout' ? '#e5484d' : '#ffffff');
      mat.opacity = sel ? 1 : o.kind === 'block' ? 0.55 : o.kind === 'shed' || o.kind === 'keepout' ? 0.9 : 0.4;
      o.line.visible = o.line.userData.quiet ? sel : this.opts.interactive || sel || o.kind === 'shed' || o.kind === 'keepout';
    }
  }
  setTool(t: Tool) {
    this.tool = t;
    if (this.draw) this.cancelDraw();
    this.ghosts.forEach((g) => (g.visible = t === 'panels'));
    this.renderer.domElement.style.cursor = 'default';
    this.dirty = true;
  }
  setColorMode(m: ColorMode) { if (m !== this.colorMode) { this.colorMode = m; this.rebuild(); } }
  setResults(r: Results | null) { this.results = r; if (this.colorMode !== 'normal') this.rebuild(); }
  setSun(dir: [number, number, number] | null) { this.sunDir = dir; this.applySun(); this.dirty = true; }

  private applySun() {
    const dir = this.sunDir;
    if (!dir) { this.ambient.intensity = Math.PI; this.sunLight.intensity = 0; this.sunLight.castShadow = false; return; }
    if (dir[1] <= 0.02) { this.ambient.intensity = Math.PI * 0.28; this.sunLight.intensity = 0; this.sunLight.castShadow = false; return; }
    const b = designBounds(this.design || ({ blocks: [], obstructions: [], walkways: [] } as any), this.mods);
    const R = b.size * 0.8 + 40;
    this.ambient.intensity = Math.PI * 0.42;
    this.sunLight.intensity = (Math.PI * 0.62) / Math.max(dir[1], 0.3);
    this.sunLight.castShadow = true;
    this.sunLight.target.position.set(b.cx, 0, b.cz);
    this.sunLight.position.set(b.cx + dir[0] * 800, dir[1] * 800, b.cz + dir[2] * 800);
    const cam = this.sunLight.shadow.camera;
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 10; cam.far = 2000;
    cam.updateProjectionMatrix();
  }

  // ---------- cameras ----------
  private makeControls() {
    const target = this.controls ? this.controls.target.clone() : new THREE.Vector3();
    this.controls?.dispose();
    const c = new OrbitControls(this.camera as any, this.renderer.domElement);
    c.target.copy(target);
    c.zoomToCursor = true;
    if (this.view === '2d') {
      c.enableRotate = false; c.screenSpacePanning = true;
      c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
      c.minZoom = 0.2; c.maxZoom = 40;
    } else {
      c.screenSpacePanning = false; c.maxPolarAngle = 1.5; c.minDistance = 3; c.maxDistance = 1500;
    }
    c.addEventListener('change', () => {
      this.dirty = true;
      this.events.onAzimuth?.(this.view === '3d' ? THREE.MathUtils.radToDeg(c.getAzimuthalAngle()) : 0);
    });
    this.controls = c;
    c.update();
  }

  setView(v: '2d' | '3d') {
    if (v === this.view) return;
    const target = this.controls.target.clone(); target.y = 0;
    this.view = v;
    if (v === '2d') {
      this.camera = this.ortho;
      this.ortho.position.set(target.x, 600, target.z);
      this.ortho.zoom = 1;
    } else {
      this.camera = this.persp;
      const dist = Math.max(this.orthoSize / Math.max(this.ortho.zoom, 0.01), 12);
      this.persp.position.set(target.x, dist * 0.75, target.z + dist * 0.85);
    }
    this.controls.target.copy(target);
    this.makeControls();
    if (v === '2d') { this.ortho.lookAt(target); this.fit(); }
    this.resize();
    this.events.onAzimuth?.(v === '3d' ? THREE.MathUtils.radToDeg(this.controls.getAzimuthalAngle()) : 0);
  }

  fit() {
    const b = designBounds(this.design || ({ blocks: [], obstructions: [], walkways: [] } as any), this.mods);
    const size = b.empty ? 70 : b.size * 1.5 + 12;
    this.controls.target.set(b.cx, 0, b.cz);
    if (this.view === '2d') {
      this.orthoSize = size; this.ortho.zoom = 1;
      this.ortho.position.set(b.cx, 600, b.cz);
      this.ortho.lookAt(b.cx, 0, b.cz);
    } else {
      this.persp.position.set(b.cx, size * 0.7, b.cz + size * 0.85);
    }
    this.resize();
    this.controls.update();
    this.dirty = true;
  }

  viewCentre(): { x: number; z: number } { return { x: this.controls.target.x, z: this.controls.target.z }; }

  private resize() {
    const w = Math.max(this.el.clientWidth, 10), h = Math.max(this.el.clientHeight, 10);
    this.renderer.setSize(w, h);
    const a = w / h;
    this.persp.aspect = a; this.persp.updateProjectionMatrix();
    const half = this.orthoSize / 2;
    this.ortho.left = -half * a; this.ortho.right = half * a; this.ortho.top = half; this.ortho.bottom = -half;
    this.ortho.updateProjectionMatrix();
    this.dirty = true;
  }

  // ---------- pointer ----------
  private ray = new THREE.Raycaster();
  private ndc(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  private pick(e: PointerEvent) {
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const hits = this.ray.intersectObjects(this.pickables.filter((p) => p.visible), false);
    // panels, obstructions and walkways win over the shed or no-panel area they sit on
    const flat = (h: THREE.Intersection) => { const k = h.object.userData.sel?.kind; return k === 'shed' || k === 'keepout'; };
    return hits.find((h) => !flat(h)) || hits[0] || null;
  }
  // Point under the pointer on the level plane at height y (0 = the ground).
  private groundPoint(e: PointerEvent, y = 0) {
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p) ? p : null;
  }
  private rootOf(o: THREE.Object3D) {
    let r = o;
    while (r.parent && r.parent !== this.content) r = r.parent;
    return r;
  }

  // ---------- drawing an outline by clicking its corners ----------
  startDraw(kind: DrawKind) {
    this.draw = { kind, pts: [], cursor: null };
    this.renderer.domElement.style.cursor = 'crosshair';
    this.redrawPreview();
    this.events.onDraw?.({ kind, points: [], cursor: null });
  }
  cancelDraw() {
    if (!this.draw) return;
    this.draw = null;
    this.redrawPreview();
    this.renderer.domElement.style.cursor = 'default';
    this.events.onDraw?.(null);
  }
  finishDraw() {
    const d = this.draw;
    if (!d || d.pts.length < 3) return false;
    this.draw = null;
    this.redrawPreview();
    this.renderer.domElement.style.cursor = 'default';
    this.events.onDraw?.(null);
    this.events.onDrawDone?.(d.kind, d.pts);
    return true;
  }
  undoDrawPoint() {
    if (!this.draw || !this.draw.pts.length) return;
    this.draw.pts.pop();
    this.redrawPreview();
    this.events.onDraw?.({ kind: this.draw.kind, points: [...this.draw.pts], cursor: this.draw.cursor });
  }
  private closeRadius() { // metres that count as "clicked the first corner again"
    if (this.view === '2d') return Math.max((this.orthoSize / Math.max(this.ortho.zoom, 0.01) / Math.max(this.el.clientHeight, 1)) * 14, 0.15);
    return 0.8;
  }
  private redrawPreview() {
    this.drawGroup.traverse((o: any) => { o.geometry?.dispose(); o.material?.dispose(); });
    this.drawGroup.clear();
    const d = this.draw;
    if (d && d.pts.length) {
      const color = d.kind === 'shed' ? '#ffb000' : '#ff5a5f';
      const pts = [...d.pts, ...(d.cursor ? [d.cursor] : [])];
      const v = pts.map(([x, z]) => new THREE.Vector3(x, 0.3, z));
      if (pts.length >= 3) v.push(v[0].clone());
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineBasicMaterial({ color, depthTest: false }));
      line.renderOrder = 9;
      this.drawGroup.add(line);
      const r = Math.max(this.closeRadius() * 0.45, 0.2);
      d.pts.forEach(([x, z], i) => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(i === 0 ? r * 1.5 : r, 14, 10), new THREE.MeshBasicMaterial({ color: i === 0 ? '#ffffff' : color, depthTest: false }));
        m.position.set(x, 0.3, z); m.renderOrder = 10;
        this.drawGroup.add(m);
      });
    }
    this.dirty = true;
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.down = { x: e.clientX, y: e.clientY };
    if (this.draw) return;
    if (!this.opts.interactive || this.tool !== 'select') return;
    if (this.handles.length) {
      this.ray.setFromCamera(this.ndc(e), this.camera);
      const hh = this.ray.intersectObjects(this.handles, false)[0];
      if (hh) {
        this.vdrag = { mesh: hh.object as THREE.Mesh, y: hh.object.position.y };
        this.controls.enabled = false;
        this.renderer.domElement.setPointerCapture(e.pointerId);
        return;
      }
    }
    const hit = this.pick(e);
    const sel = hit?.object.userData.sel as NonNullable<Selection> | undefined;
    if (hit && sel) {
      const add = e.ctrlKey || e.metaKey || e.shiftKey;
      // the drag is measured at the height where the item was grabbed, so on a roof it stays under the pointer in 3D too
      const gy = Math.max(hit.point.y, 0);
      const gp = hit.object.userData.locked || add ? null : this.groundPoint(e, gy); // Ctrl+click only selects, it never drags
      const obj = this.rootOf(hit.object);
      if (add) { this.controls.enabled = false; setTimeout(() => { if (!this.drag && !this.vdrag) this.controls.enabled = true; }, 0); }
      if (gp) {
        this.drag = { sel, obj, ox: obj.position.x, oz: obj.position.z, gx: gp.x, gz: gp.z, gy, moved: false, placed: false };
        this.controls.enabled = false;
        this.renderer.domElement.setPointerCapture(e.pointerId);
      }
      this.events.onSelect?.(sel, add);
    }
  };

  private onMove = (e: PointerEvent) => {
    if (this.vdrag) {
      this.ray.setFromCamera(this.ndc(e), this.camera);
      const p = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.vdrag.y), p)) {
        this.vdrag.mesh.position.set(p.x, this.vdrag.y, p.z);
        this.dirty = true;
      }
      return;
    }
    if (this.draw) {
      const gp = this.groundPoint(e);
      this.draw.cursor = gp ? [gp.x, gp.z] : null;
      this.redrawPreview();
      this.events.onDraw?.({ kind: this.draw.kind, points: [...this.draw.pts], cursor: this.draw.cursor });
      return;
    }
    if (this.drag) {
      if (!this.drag.moved && this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 4) return;
      const gp = this.groundPoint(e, this.drag.gy);
      if (!gp) return;
      this.drag.moved = true;
      this.renderer.domElement.style.cursor = 'grabbing';
      const dr = this.drag, o = dr.obj.position, r = (v: number) => Math.round(v * 100) / 100;
      const nx = r(dr.ox + gp.x - dr.gx), nz = r(dr.oz + gp.z - dr.gz);
      const ok = (x: number, z: number) => !this.events.canMove || this.events.canMove(dr.sel, x, z);
      // a place the item may not stand on is skipped; it slides along the limit where it can
      const to = ok(nx, nz) ? [nx, nz] : nx !== o.x && ok(nx, o.z) ? [nx, o.z] : nz !== o.z && ok(o.x, nz) ? [o.x, nz] : null;
      if (to) { o.x = to[0]; o.z = to[1]; dr.placed = true; this.dirty = true; }
      return;
    }
    if (e.buttons) return;
    const hit = this.pick(e);
    if (this.tool === 'panels') {
      const action = hit?.object.userData.action as 'remove' | 'add' | undefined;
      this.renderer.domElement.style.cursor = action ? 'pointer' : 'default';
      this.events.onHover?.(action ? { action, x: e.clientX, y: e.clientY } : null);
    } else if (this.opts.interactive) {
      this.renderer.domElement.style.cursor = hit?.object.userData.sel ? (hit.object.userData.locked ? 'pointer' : 'grab') : 'default';
    }
  };

  private onUp = (e: PointerEvent) => {
    const click = !!this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 4;
    this.down = null;
    if (this.vdrag) {
      const v = this.vdrag, u = v.mesh.userData.vertex;
      this.vdrag = null;
      this.controls.enabled = true;
      this.events.onVertexMove?.(u.kind, u.id, u.index, Math.round(v.mesh.position.x * 100) / 100, Math.round(v.mesh.position.z * 100) / 100);
      return;
    }
    if (this.draw) {
      if (!click || e.button !== 0) return;
      const gp = this.groundPoint(e);
      if (!gp) return;
      const d = this.draw, pt: Pt = [Math.round(gp.x * 100) / 100, Math.round(gp.z * 100) / 100];
      if (d.pts.length >= 3 && Math.hypot(pt[0] - d.pts[0][0], pt[1] - d.pts[0][1]) < this.closeRadius()) { this.finishDraw(); return; }
      const last = d.pts[d.pts.length - 1];
      if (last && Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 0.05) return; // second click of a double-click
      d.pts.push(pt);
      this.redrawPreview();
      this.events.onDraw?.({ kind: d.kind, points: [...d.pts], cursor: pt });
      return;
    }
    if (this.drag) {
      const d = this.drag;
      this.drag = null;
      this.controls.enabled = true;
      this.renderer.domElement.style.cursor = 'grab';
      if (d.moved && d.placed) this.events.onMove?.(d.sel, Math.round(d.obj.position.x * 100) / 100, Math.round(d.obj.position.z * 100) / 100);
      return;
    }
    if (!click || e.button !== 0) return;
    const hit = this.pick(e);
    if (this.tool === 'panels') {
      const u = hit?.object.userData;
      if (hit && u?.keys && hit.instanceId != null) this.events.onTogglePanel?.(u.sel.id, u.keys[hit.instanceId], u.action);
      return;
    }
    if (this.opts.interactive && !hit) this.events.onSelect?.(null);
  };

  // ---------- pictures ----------
  // Top-down picture of the whole layout, north up. Used for thumbnails and the report.
  snapshot(o: { size?: number; sun?: [number, number, number] | null; colorMode?: ColorMode; quality?: number } = {}): string {
    const size = o.size || 900;
    const keep = { sun: this.sunDir, mode: this.colorMode, sel: this.selected, tool: this.tool };
    this.selected = null;
    this.tool = 'select';
    if ((o.colorMode || 'normal') !== this.colorMode) { this.colorMode = o.colorMode || 'normal'; }
    this.sunDir = o.sun === undefined ? null : o.sun;
    this.rebuild();
    this.outlines.forEach((x) => (x.line.visible = false));
    const b = designBounds(this.design || ({ blocks: [], obstructions: [], walkways: [] } as any), this.mods);
    const half = Math.max(b.size * 0.72 + 10, 28);
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, 3000);
    cam.up.set(0, 0, -1);
    cam.position.set(b.cx, 600, b.cz);
    cam.lookAt(b.cx, 0, b.cz);
    const pr = this.renderer.getPixelRatio();
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.renderer.render(this.scene, cam);
    const url = this.renderer.domElement.toDataURL('image/jpeg', o.quality || 0.88);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(Math.max(w, 10), Math.max(h, 10));
    this.sunDir = keep.sun; this.colorMode = keep.mode; this.selected = keep.sel; this.tool = keep.tool;
    this.rebuild();
    this.ghosts.forEach((g) => (g.visible = this.tool === 'panels'));
    this.renderer.render(this.scene, this.camera);
    return url;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.clearContent();
    Object.values(this.textures).forEach((t) => t.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
