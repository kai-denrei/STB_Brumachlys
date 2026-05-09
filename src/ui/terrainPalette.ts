// Terrain fill colours for the canvas board. Editorial dark palette,
// distinguishable but never high-contrast (so units pop on top).

import type { TerrainKey } from '../core/types.ts';

export const TERRAIN_FILL: Record<TerrainKey, string> = {
  plains: '#232619',     // warm dark olive
  water: '#0F1F33',      // deep navy
  mountains: '#3A2C20',  // brown
  woods: '#1A2A1F',      // dark forest
  swamp: '#2C2138',      // purple-brown
  base: '#332B1C',       // warm slate (faction ring overlay added on top)
};

export const TERRAIN_STROKE = '#0E0F10'; // bg-base; inter-tile hairlines
