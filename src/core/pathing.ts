// Movement-cost-weighted Dijkstra over the hex grid. Pure function.
// Treats fogged tiles as their actual terrain at this layer — fog assumptions
// are applied by the caller when building the map view (DECISIONS §B.5).
//
// Conventions:
//   • Path returned is the list of hexes traversed AFTER `from` (not including it).
//   • Step cost is the terrain movementCost of each ENTERED hex (in tenths).
//   • Friendly units are pass-through but cannot be the destination.
//   • Enemy units terminate the path: you can MOVE INTO an enemy hex (which
//     triggers mêlée combat in the resolver's Phase A.5), but you cannot
//     traverse PAST one. So enemy hexes are valid destinations but block
//     further pathing.

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
  // Enemy hexes are now valid destinations (mêlée combat happens on arrival)
  // but cannot be traversed past. Friendly hexes are pass-through but can't
  // be a final landing.
  const enemyHexes = new Set<string>();
  const friendlyHexes = new Set<string>();
  for (const u of Object.values(units)) {
    if (u.hex.q === from.q && u.hex.r === from.r) continue;
    const k = hexKey(u.hex);
    if (u.faction === faction) friendlyHexes.add(k);
    else enemyHexes.add(k);
  }
  if (friendlyHexes.has(toKey)) return null;

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
    // Enemy hexes terminate further pathing: don't expand neighbours past one.
    if (ck !== hexKey(from) && enemyHexes.has(ck)) continue;

    for (const n of neighbors(current.hex)) {
      const nk = hexKey(n);
      if (!map.tiles.has(nk)) continue;

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
// and impassable terrain. Enemy-occupied hexes ARE valid destinations
// (entering them triggers mêlée combat) but cannot be traversed past, so
// neighbours of enemy hexes are not expanded.
// Friendly hexes are still traversable (their cost is included in
// path-finding) but cannot be a destination — see DECISIONS §B.5 for the
// conservative-planner rationale.
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
    // Enemy hexes terminate further pathing — don't expand past them.
    if (ck !== hexKey(from) && enemyHexes.has(ck)) continue;

    for (const n of neighbors(current.hex)) {
      const nk = hexKey(n);
      if (!map.tiles.has(nk)) continue;
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
  // Enemy hexes stay — they're valid mêlée destinations.
  distances.delete(hexKey(from));
  for (const fk of friendlyHexes) distances.delete(fk);
  return distances;
}
