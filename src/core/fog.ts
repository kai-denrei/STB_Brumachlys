// Fog-of-war visibility computation. Pure function.
// Per BRUMACHLYS.md §6.2 / DECISIONS §C.5: terrain is always visible; only
// enemy units are hidden. This function returns the set of hex keys that the
// given faction can see — the UI uses it to filter which enemy units to draw.

import { hexesWithin, key } from './hex.ts';
import type { GameState, FactionId, UnitType } from './types.ts';

export function visibleHexesFor(
  state: GameState,
  faction: FactionId,
  unitTypes: Record<string, UnitType>,
): Set<string> {
  const visible = new Set<string>();
  for (const unit of Object.values(state.units)) {
    if (unit.faction !== faction) continue;
    const ut = unitTypes[unit.type];
    if (!ut) continue;
    for (const h of hexesWithin(unit.hex, ut.vision)) {
      visible.add(key(h));
    }
  }
  return visible;
}
