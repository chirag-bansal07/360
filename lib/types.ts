export type ModuleSpec = { id: string; name: string; watt: number; length: number; width: number; custom?: boolean };

// Sunmount mounting structure a panel set sits on. It decides the panel orientation.
export type StructureId = 'longrail' | 'monorail' | 'minirail' | 'reverse';

export type Block = {
  id: string;
  name: string;
  x: number; // metres east of the project point
  z: number; // metres south of the project point
  azimuth: number; // compass direction the panels face, 180 = south
  rows: number;
  cols: number;
  orientation: 'portrait' | 'landscape';
  moduleId: string;
  mounting: 'flush' | 'rows'; // flush = one tilted plane (shed roof), rows = every row tilted on its own
  tilt: number; // degrees
  mountHeight: number; // metres, height of the lowest panel edge
  gapH: number; // metres between panels side by side
  gapV: number; // metres between rows
  aisleRowsEvery: number; // 0 = none
  aisleRowsGap: number;
  aisleColsEvery: number;
  aisleColsGap: number;
  removed: string[]; // "row-col" keys of panels taken out by hand
  shedId?: string; // when set, the grid is fitted to this shed and confined to its outline
  structure?: StructureId;
  ownTilt?: boolean; // on a sloped shed: the set keeps its own tilt and direction instead of lying on the roof
  roofRise?: [number, number]; // with ownTilt: how fast the roof under the set rises, per metre along a row and per metre towards the facing side
};

export type Pt = [number, number]; // [east, south] in metres
// height = roof height at its lowest edge. tilt (degrees) and slopeAz (compass direction the roof slopes down towards) describe a sloped roof.
export type Shed = { id: string; name: string; points: Pt[]; height: number; setback: number; tilt?: number; slopeAz?: number };
export type Keepout = { id: string; name: string; points: Pt[] };

export type Obstruction = { id: string; name: string; x: number; z: number; w: number; l: number; h: number; rotation: number };
export type Walkway = { id: string; name: string; x: number; z: number; w: number; l: number; h: number; rotation: number };

export type MonthRow = {
  month: string; direct: number; diffuse: number; effective: number;
  dc: number; ac: number; specific: number; pr: number;
};
export type LossRow = { label: string; value: number; unit: string; pct: number | null; stage: 'irradiance' | 'dc' | 'ac' };

export type Results = {
  calculatedAt: string;
  source: string;
  kwp: number;
  acKw: number;
  annualAc: number; // kWh
  pr: number; // %
  specific: number; // kWh/kWp/year
  shadeFreePct: number;
  monthly: MonthRow[];
  losses: LossRow[];
  access: Record<string, Record<string, number>>; // blockId -> slot key -> 0..1
  poaByBlock: Record<string, number>; // kWh/m2/year on the panel plane
  signature: string;
};

export type Design = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  defaultModuleId: string;
  inverter: { name: string; kw: number; qty: number };
  structureName: string;
  defaultStructure?: StructureId; // structure given to new panel sets
  sheds: Shed[];
  keepouts: Keepout[];
  blocks: Block[];
  obstructions: Obstruction[];
  walkways: Walkway[];
  results: Results | null;
  thumb?: string;
};

export type Weather = {
  source: string;
  fetchedAt: string;
  ghi: number[]; // kWh/m2/day, 12 months
  dhi: number[]; // kWh/m2/day
  temp: number[]; // deg C
};

export type Project = {
  id: string;
  number: number;
  name: string;
  clientName: string;
  phone: string;
  email: string;
  address: string;
  displayAddress: string;
  type: 'residential' | 'commercial';
  lat: number;
  lng: number;
  utcOffset: number;
  noMap?: boolean; // made from shed dimensions: no satellite picture; lat/lng (a nearby town, or central India) only feed sun and weather
  createdAt: string;
  weather: Weather | null;
  designs: Design[];
};

export type LossSettings = {
  irradianceAdjust: number; // % applied to weather irradiance, for calibration
  soiling: number; lid: number; mismatch: number; dcWiring: number;
  inverterEff: number; acWiring: number; unavailability: number;
  tempCoeff: number; // %/degC, negative
  degradation: number; // %/year
};

export type Settings = {
  company: { name: string; email: string; phone: string; logo: string };
  customModules: ModuleSpec[];
  losses: LossSettings;
  googleMapsKey: string; // optional, for sharper Google satellite imagery
};

export type Db = { nextNumber: number; projects: Project[]; settings: Settings };
