import type { ModuleSpec, Settings, Block, Design, LossSettings, StructureId } from './types';

// Generic module sizes. Add your own exact models in Settings.
export const BUILTIN_MODULES: ModuleSpec[] = [
  { id: 'm540', name: 'Mono PERC 540 W', watt: 540, length: 2.278, width: 1.134 },
  { id: 'm550', name: 'Mono PERC 550 W', watt: 550, length: 2.278, width: 1.134 },
  { id: 'm580', name: 'TOPCon 580 W', watt: 580, length: 2.278, width: 1.134 },
  { id: 'm590', name: 'TOPCon 590 W', watt: 590, length: 2.278, width: 1.134 },
  { id: 'm600', name: 'TOPCon 600 W', watt: 600, length: 2.382, width: 1.134 },
  { id: 'm620', name: 'TOPCon 620 W', watt: 620, length: 2.382, width: 1.134 },
];

export const DEFAULT_LOSSES: LossSettings = {
  irradianceAdjust: 0, soiling: 2, lid: 1.5, mismatch: 1.5, dcWiring: 1,
  inverterEff: 96, acWiring: 1, unavailability: 0, tempCoeff: -0.32, degradation: 1.5,
};

export const DEFAULT_SETTINGS: Settings = {
  company: { name: 'SunCraft3D', email: '', phone: '', logo: '' },
  customModules: [],
  losses: DEFAULT_LOSSES,
  googleMapsKey: '',
};

export function allModules(settings?: Settings | null): ModuleSpec[] {
  return [...BUILTIN_MODULES, ...((settings?.customModules || []).map((m) => ({ ...m, custom: true })))];
}
export function findModule(mods: ModuleSpec[], id: string): ModuleSpec {
  return mods.find((m) => m.id === id) || mods[0];
}

export const STRUCTURE_BRAND = 'Sunmount mounting structure';
// tilt is set only for the structure that tilts the panels by itself
// gapV = the clear gap between rows a new set of this structure starts with
export const STRUCTURES: { id: StructureId; name: string; orientation: Block['orientation']; tilt?: number; gapV?: number }[] = [
  { id: 'longrail', name: 'Long rail', orientation: 'landscape' },
  { id: 'monorail', name: 'Mono rail', orientation: 'portrait' },
  { id: 'minirail', name: 'Mini rail', orientation: 'landscape' },
  { id: 'seam', name: 'Standing seam', orientation: 'landscape' },
  { id: 'reverse', name: 'Reverse tilt', orientation: 'landscape', tilt: 12, gapV: 0.6 },
  { id: 'reversep', name: 'Reverse tilt', orientation: 'portrait', tilt: 12, gapV: 1 },
];
export const findStructure = (id?: StructureId) => STRUCTURES.find((s) => s.id === id) || STRUCTURES[0];
// Panel sets saved before structures existed are matched by their orientation. Mono rail and mini rail once had their
// orientations the other way round: a set saved then keeps its panels as drawn and takes the name that fits them.
export const structureOf = (b: Block) => {
  const st = findStructure(b.structure || (b.orientation === 'portrait' ? 'monorail' : 'longrail'));
  if ((st.id === 'monorail' || st.id === 'minirail') && st.orientation !== b.orientation) return findStructure(b.orientation === 'portrait' ? 'monorail' : 'minirail');
  return st;
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function newBlock(design: Design, x = 0, z = 0): Block {
  const n = design.blocks.length + 1, st = findStructure(design.defaultStructure || 'monorail');
  return {
    id: uid(), name: `Block ${n}`, x, z, azimuth: 180, rows: 1, cols: 1, orientation: st.orientation, structure: st.id,
    moduleId: design.defaultModuleId, mounting: st.tilt ? 'rows' : 'flush', tilt: st.tilt ?? 5, ownTilt: !!st.tilt, mountHeight: 1,
    gapH: 0.025, gapV: st.gapV ?? 0.025, aisleRowsEvery: 0, aisleRowsGap: 0.6, aisleColsEvery: 0, aisleColsGap: 0.6, removed: [],
  };
}

export function newDesign(name: string): Design {
  const now = new Date().toISOString();
  return {
    id: uid(), name, createdAt: now, updatedAt: now, defaultModuleId: 'm590',
    inverter: { name: 'String inverter', kw: 100, qty: 1 }, structureName: 'Standard mounting structure',
    sheds: [], keepouts: [], blocks: [], obstructions: [], walkways: [], results: null,
  };
}
