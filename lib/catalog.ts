import type { ModuleSpec, Settings, Block, Design, LossSettings } from './types';

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

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function newBlock(design: Design, x = 0, z = 0): Block {
  const n = design.blocks.length + 1;
  return {
    id: uid(), name: `Block ${n}`, x, z, azimuth: 180, rows: 4, cols: 10, orientation: 'portrait',
    moduleId: design.defaultModuleId, mounting: 'flush', tilt: 5, mountHeight: 1,
    gapH: 0.025, gapV: 0.025, aisleRowsEvery: 0, aisleRowsGap: 0.6, aisleColsEvery: 0, aisleColsGap: 0.6, removed: [],
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
