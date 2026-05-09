// Core game types. Pure data shapes — no logic, no module state.
// See BRUMACHLYS.md §4 for the canonical definitions.

export type Hex = { q: number; r: number };

export type FactionId = 0 | 1;

export type Stance = 'aggressive' | 'defensive' | 'hold-fire';

export type ArmorType = 'personnel' | 'armored' | 'naval' | 'air';

export type TerrainKey = 'plains' | 'mountains' | 'woods' | 'swamp' | 'water' | 'base';

export type GamePhase =
  | 'planning'
  | 'planning-handoff'
  | 'resolution'
  | 'replay'
  | 'over';

export type UnitInstance = {
  id: string;
  type: string; // key into UnitType registry, e.g. 'infantry'
  faction: FactionId;
  hex: Hex;
  count: number; // 1..10
  stance: Stance;
  attackedFromHexes: Hex[]; // gang-up accumulator, cleared per round
};

export type TerrainEffect = {
  movementCost: number; // tenths; 99 = impassable for this unit type
  attackBonus: number; // Ta in the formula
  armorBonus: number; // Td in the formula
};

export type UnitType = {
  key: string;
  description: string;
  cost: number; // unused in PoC
  movement: number; // total movement points (tenths)
  initiative: number;
  armor: number; // D in the formula
  armorType: ArmorType;
  minRange: number;
  maxRange: number;
  vision: number;
  attackStrengths: Record<ArmorType, number>; // 0 = cannot attack that armor type
  terrainEffects: Record<TerrainKey, TerrainEffect>;
};

export type TerrainType = {
  key: TerrainKey;
  description: string;
  passable: ArmorType[];
};

export type GameMap = {
  width: number;
  height: number;
  name: string;
  tiles: Map<string, TerrainKey>; // key = `${q},${r}`
  startingUnits: Array<{ hex: Hex; unitTypeKey: string; faction: FactionId }>;
  startingBases: Array<{ hex: Hex; faction: FactionId | null }>; // null = neutral
};

// Discriminated event log emitted by the resolver. Replay UI consumes this.
export type ResolutionEvent =
  | { type: 'stance'; unitId: string; stance: Stance }
  | { type: 'move'; unitId: string; from: Hex; to: Hex; pathTaken: Hex[] }
  | { type: 'path-truncated'; unitId: string; planned: Hex; actual: Hex }
  | { type: 'attack'; attackerId: string; defenderId: string; damage: number; bonusB: number }
  | { type: 'counter'; attackerId: string; defenderId: string; damage: number }
  | { type: 'kill'; unitId: string }
  | { type: 'lost-target'; attackerId: string; targetHex: Hex };

export type GameState = {
  round: number; // 1-indexed
  phase: GamePhase;
  activePlanner: FactionId | null;
  map: GameMap;
  units: Record<string, UnitInstance>;
  pendingOrders: Record<FactionId, import('./orders.ts').Order[]>;
  rngSeed: number; // xorshift32 state
  log: ResolutionEvent[];
};
