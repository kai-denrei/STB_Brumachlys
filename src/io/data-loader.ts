// Loads JSON registries (units.json, terrain.json) into typed shapes.
// In Vite, JSON imports are first-class so this is mostly a typing wrapper.

import type { UnitType, TerrainType, TerrainKey } from '../core/types.ts';
import unitsJson from '../../data/units.json';
import terrainJson from '../../data/terrain.json';

export function loadUnits(): Record<string, UnitType> {
  // The JSON shape matches UnitType — assert via the type checker.
  return unitsJson as unknown as Record<string, UnitType>;
}

export function loadTerrain(): Record<TerrainKey, TerrainType> {
  return terrainJson as unknown as Record<TerrainKey, TerrainType>;
}
