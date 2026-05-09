// Movement-cost-weighted Dijkstra over the hex grid. Pure function.
// Treats fogged tiles as their actual terrain at this layer — fog assumptions
// are applied by the caller when building the map view (DECISIONS §B.5).
//
// Conventions:
//   • Path returned is the list of hexes traversed AFTER `from` (not including it).
//   • Step cost is the terrain movementCost of each ENTERED hex (in tenths).
//   • Friendly units are pass-through but cannot be the destination.
//   • Enemy units block traversal entirely (must stop adjacent — see §2.4).

import { neighbors, key as hexKey } from './hex.ts';
import type { Hex, GameMap, UnitInstance, UnitType, FactionId } from './types.ts';

export type PathResult = {
  path: Hex[];
  totalCost: number; // tenths
};

export function findPath(
  map: GameMap,
  units: Record<string, UnitInstance>,
  from: Hex,
  to: Hex,
  unitType: UnitType,
  faction: FactionId,
): PathResult | null {
  if (from.q === to.q && from.r === to.r) return { path: [], totalCost: 0 };

  const toKey = hexKey(to);
  if (!map.tiles.has(toKey)) return null;

  // Build occupancy excluding any unit standing on `from` (presumed to be us).
  const enemyHexes = new Set<string>();
  const friendlyHexes = new Set<string>();
  for (const u of Object.values(units)) {
    if (u.hex.q === from.q && u.hex.r === from.r) continue;
    const k = hexKey(u.hex);
    if (u.faction === faction) friendlyHexes.add(k);
    else enemyHexes.add(k);
  }
  if (enemyHexes.has(toKey) || friendlyHexes.has(toKey)) return null;

  const distances = new Map<string, number>();
  const previous = new Map<string, Hex>();
  distances.set(hexKey(from), 0);

  // Simple priority queue: sorted-on-pop. Adequate for the PoC's ~340-hex grid.
  type Item = { hex: Hex; cost: number };
  const queue: Item[] = [{ hex: from, cost: 0 }];

  while (queue.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i]!.cost < queue[bestIdx]!.cost) bestIdx = i;
    }
    const current = queue.splice(bestIdx, 1)[0]!;
    const ck = hexKey(current.hex);

    if (ck === toKey) {
      const path: Hex[] = [];
      let cur: Hex | undefined = to;
      while (cur && !(cur.q === from.q && cur.r === from.r)) {
        path.unshift(cur);
        cur = previous.get(hexKey(cur));
      }
      return { path, totalCost: current.cost };
    }

    if (current.cost > (distances.get(ck) ?? Infinity)) continue; // stale

    for (const n of neighbors(current.hex)) {
      const nk = hexKey(n);
      if (!map.tiles.has(nk)) continue;
      if (enemyHexes.has(nk)) continue;

      const tile = map.tiles.get(nk)!;
      const stepCost = unitType.terrainEffects[tile]?.movementCost ?? 99;
      if (stepCost >= 99) continue;

      const newCost = current.cost + stepCost;
      if (newCost > unitType.movement) continue;

      // Friendly tiles are traversable but cannot be the final destination.
      if (friendlyHexes.has(nk) && nk === toKey) continue;

      if (newCost < (distances.get(nk) ?? Infinity)) {
        distances.set(nk, newCost);
        previous.set(nk, current.hex);
        queue.push({ hex: n, cost: newCost });
      }
    }
  }

  return null;
}

// All hexes a unit could MOVE TO from `from` within its movement budget.
// Excludes `from` itself, friendly-occupied hexes (cannot land on them),
// enemy-occupied hexes, and impassable terrain. Friendly hexes are still
// traversable (their cost is included in path-finding) but cannot be a
// destination — see DECISIONS §B.5 for the conservative-planner rationale.
export function reachableHexes(
  map: GameMap,
  units: Record<string, UnitInstance>,
  from: Hex,
  unitType: UnitType,
  faction: FactionId,
): Map<string, number> {
  const enemyHexes = new Set<string>();
  const friendlyHexes = new Set<string>();
  for (const u of Object.values(units)) {
    if (u.hex.q === from.q && u.hex.r === from.r) continue;
    const k = hexKey(u.hex);
    if (u.faction === faction) friendlyHexes.add(k);
    else enemyHexes.add(k);
  }

  const distances = new Map<string, number>();
  distances.set(hexKey(from), 0);
  type Item = { hex: Hex; cost: number };
  const queue: Item[] = [{ hex: from, cost: 0 }];

  while (queue.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i]!.cost < queue[bestIdx]!.cost) bestIdx = i;
    }
    const current = queue.splice(bestIdx, 1)[0]!;
    const ck = hexKey(current.hex);
    if (current.cost > (distances.get(ck) ?? Infinity)) continue;

    for (const n of neighbors(current.hex)) {
      const nk = hexKey(n);
      if (!map.tiles.has(nk)) continue;
      if (enemyHexes.has(nk)) continue;
      const tile = map.tiles.get(nk)!;
      const stepCost = unitType.terrainEffects[tile]?.movementCost ?? 99;
      if (stepCost >= 99) continue;
      const newCost = current.cost + stepCost;
      if (newCost > unitType.movement) continue;
      if (newCost < (distances.get(nk) ?? Infinity)) {
        distances.set(nk, newCost);
        queue.push({ hex: n, cost: newCost });
      }
    }
  }

  // Strip from-hex and any friendly hex from the final destination set.
  distances.delete(hexKey(from));
  for (const fk of friendlyHexes) distances.delete(fk);
  return distances;
}
