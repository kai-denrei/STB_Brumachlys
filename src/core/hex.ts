// Pure hex math. No game knowledge. No module state.
// Convention: odd-r offset coordinates (q = column, r = row), matching Zetawar.
//
// Odd rows (r & 1 === 1) are shifted right by half a hex on the screen.
// All math goes via cube coordinates internally for correctness.

import type { Hex } from './types.ts';

export type Cube = { x: number; y: number; z: number };

export function key(h: Hex): string {
  return `${h.q},${h.r}`;
}

export function equals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function offsetToCube(h: Hex): Cube {
  const x = h.q - (h.r - (h.r & 1)) / 2;
  const z = h.r;
  const y = -x - z;
  return { x, y, z };
}

export function cubeToOffset(c: Cube): Hex {
  const q = c.x + (c.z - (c.z & 1)) / 2;
  const r = c.z;
  return { q, r };
}

export function distance(a: Hex, b: Hex): number {
  const ac = offsetToCube(a);
  const bc = offsetToCube(b);
  return (Math.abs(ac.x - bc.x) + Math.abs(ac.y - bc.y) + Math.abs(ac.z - bc.z)) / 2;
}

export function adjacent(a: Hex, b: Hex): boolean {
  return distance(a, b) === 1;
}

// Six neighbour directions for odd-r offset.
// Even rows: NW, NE, W, E, SW, SE = (-1,-1), (0,-1), (-1,0), (1,0), (-1,1), (0,1)
// Odd rows:  NW, NE, W, E, SW, SE = ( 0,-1), (1,-1), (-1,0), (1,0), ( 0,1), (1,1)
const ODD_R_NEIGHBORS_EVEN: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
];
const ODD_R_NEIGHBORS_ODD: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

export function neighbors(h: Hex): Hex[] {
  const table = (h.r & 1) === 1 ? ODD_R_NEIGHBORS_ODD : ODD_R_NEIGHBORS_EVEN;
  const out: Hex[] = [];
  for (const [dq, dr] of table) {
    out.push({ q: h.q + dq, r: h.r + dr });
  }
  return out;
}

// All hexes within `radius` of `center` (inclusive of center). Uses BFS so it
// works correctly for odd-r offset without converting to cube. O(radius²).
export function hexesWithin(center: Hex, radius: number): Hex[] {
  if (radius < 0) return [];
  const seen = new Set<string>([key(center)]);
  const out: Hex[] = [center];
  let frontier: Hex[] = [center];
  for (let r = 0; r < radius; r++) {
    const next: Hex[] = [];
    for (const h of frontier) {
      for (const n of neighbors(h)) {
        const k = key(n);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return out;
}

// True if `defender` lies on the straight line between `a` and `c` in cube space,
// equidistant from both. Used for the gang-up "opposite" classification (§3.2).
// Returns false if a === c (degenerate).
export function opposite(a: Hex, defender: Hex, c: Hex): boolean {
  if (equals(a, c)) return false;
  const ac = offsetToCube(a);
  const dc = offsetToCube(defender);
  const cc = offsetToCube(c);
  // a + c == 2 * defender (componentwise) means defender is the midpoint.
  return (
    ac.x + cc.x === 2 * dc.x &&
    ac.y + cc.y === 2 * dc.y &&
    ac.z + cc.z === 2 * dc.z
  );
}
