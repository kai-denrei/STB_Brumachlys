import { describe, expect, test } from 'vitest';
import { findPath } from '../src/core/pathing.ts';
import { loadUnits } from '../src/io/data-loader.ts';
import type { GameMap, UnitInstance, TerrainKey, Hex } from '../src/core/types.ts';

const units = loadUnits();
const INF = units.infantry!;
const TNK = units.tank!;

function makeMap(spec: Record<string, TerrainKey>): GameMap {
  return {
    name: 'test',
    width: 99,
    height: 99,
    initialCredits: 0,
    perBaseCredits: 0,
    tiles: new Map(Object.entries(spec)),
    startingUnits: [],
    startingBases: [],
  };
}

function placeUnit(
  id: string,
  faction: 0 | 1,
  hex: Hex,
  type = 'infantry',
): UnitInstance {
  return {
    id,
    type,
    faction,
    hex,
    count: 10,
    stance: 'aggressive',
    attackedFromHexes: [],
  };
}

function unitsAt(units: UnitInstance[]): Record<string, UnitInstance> {
  return Object.fromEntries(units.map((u) => [u.id, u]));
}

// A 4-tile horizontal strip of plains: (0,0) (1,0) (2,0) (3,0). Plains cost 3.
const STRIP = makeMap({
  '0,0': 'plains',
  '1,0': 'plains',
  '2,0': 'plains',
  '3,0': 'plains',
});

describe('findPath — basics', () => {
  test('from === to returns empty path with cost 0', () => {
    const r = findPath(STRIP, {}, { q: 0, r: 0 }, { q: 0, r: 0 }, INF, 0);
    expect(r).toEqual({ path: [], totalCost: 0 });
  });

  test('one step on plains costs 3 (tenths)', () => {
    const r = findPath(STRIP, {}, { q: 0, r: 0 }, { q: 1, r: 0 }, INF, 0);
    expect(r).toEqual({ path: [{ q: 1, r: 0 }], totalCost: 3 });
  });

  test('infantry walks 3 plains tiles (movement 9 = 3 plains)', () => {
    const r = findPath(STRIP, {}, { q: 0, r: 0 }, { q: 3, r: 0 }, INF, 0);
    expect(r).not.toBeNull();
    expect(r!.totalCost).toBe(9);
    expect(r!.path).toHaveLength(3);
    expect(r!.path[r!.path.length - 1]).toEqual({ q: 3, r: 0 });
  });

  test('exceeding movement budget returns null', () => {
    // Infantry on plains: budget 9, but a strip of 4 tiles = cost 12 > 9.
    const longStrip = makeMap({
      '0,0': 'plains',
      '1,0': 'plains',
      '2,0': 'plains',
      '3,0': 'plains',
      '4,0': 'plains',
    });
    const r = findPath(longStrip, {}, { q: 0, r: 0 }, { q: 4, r: 0 }, INF, 0);
    expect(r).toBeNull();
  });

  test('off-map destination returns null', () => {
    const r = findPath(STRIP, {}, { q: 0, r: 0 }, { q: 99, r: 99 }, INF, 0);
    expect(r).toBeNull();
  });
});

describe('findPath — terrain cost preferences', () => {
  test('Dijkstra prefers cheaper terrain', () => {
    // Two-row map: top row is woods (cost 4), bottom row is plains (cost 3).
    // From (0,0) to (2,0) the direct plains route should cost 6, not 8.
    const m = makeMap({
      '0,0': 'plains', '1,0': 'plains', '2,0': 'plains',
      '0,1': 'woods', '1,1': 'woods', '2,1': 'woods',
    });
    const r = findPath(m, {}, { q: 0, r: 0 }, { q: 2, r: 0 }, INF, 0);
    expect(r!.totalCost).toBe(6);
  });

  test('detours through cheaper terrain when direct path is expensive', () => {
    // Direct path (0,0)→(1,0) crosses mountains (cost 6 for infantry).
    // Detour via (0,1)→(1,1)→(1,0) plains plains plains = cost 9 (still cheaper).
    const m = makeMap({
      '0,0': 'plains',
      '1,0': 'mountains',
      '2,0': 'plains',
      '0,1': 'plains',
      '1,1': 'plains',
      '2,1': 'plains',
    });
    // Direct (0,0)→(1,0)→(2,0) costs 6 + 3 = 9. Detour (0,0)→(0,1)→(1,1)→(2,0): 3+3+3=9. Tie.
    // Make mountains worse to force detour.
    const m2 = makeMap({ ...Object.fromEntries(m.tiles), '1,0': 'swamp' }); // swamp cost 8 for infantry
    // Direct: 8+3=11, Detour: 9. Detour wins.
    const r = findPath(m2, {}, { q: 0, r: 0 }, { q: 2, r: 0 }, INF, 0);
    expect(r!.totalCost).toBe(9);
  });
});

describe('findPath — impassable for unit type', () => {
  test('tank cannot enter mountains (movementCost 99)', () => {
    const m = makeMap({
      '0,0': 'plains',
      '1,0': 'mountains',
    });
    const r = findPath(m, {}, { q: 0, r: 0 }, { q: 1, r: 0 }, TNK, 0);
    expect(r).toBeNull();
  });

  test('any unit cannot enter water (cost 99 for non-naval)', () => {
    const m = makeMap({
      '0,0': 'plains',
      '1,0': 'water',
      '2,0': 'plains',
    });
    const r = findPath(m, {}, { q: 0, r: 0 }, { q: 2, r: 0 }, INF, 0);
    expect(r).toBeNull();
  });
});

describe('findPath — unit interactions (§2.4)', () => {
  test('pass-through friendly unit is allowed', () => {
    const friendly = placeUnit('f1', 0, { q: 1, r: 0 });
    const r = findPath(
      STRIP,
      unitsAt([friendly]),
      { q: 0, r: 0 },
      { q: 2, r: 0 },
      INF,
      0,
    );
    expect(r).not.toBeNull();
    expect(r!.totalCost).toBe(6);
  });

  test('cannot land on a hex occupied by friendly', () => {
    const friendly = placeUnit('f1', 0, { q: 1, r: 0 });
    const r = findPath(
      STRIP,
      unitsAt([friendly]),
      { q: 0, r: 0 },
      { q: 1, r: 0 }, // dest is friendly's hex
      INF,
      0,
    );
    expect(r).toBeNull();
  });

  test('enemy unit blocks traversal', () => {
    const enemy = placeUnit('e1', 1, { q: 1, r: 0 });
    const r = findPath(
      STRIP,
      unitsAt([enemy]),
      { q: 0, r: 0 },
      { q: 2, r: 0 },
      INF,
      0,
    );
    // Strip is 1D so going around is impossible.
    expect(r).toBeNull();
  });

  test('CAN land on enemy hex (mêlée stacking — entering triggers Phase A.5 brawl)', () => {
    const enemy = placeUnit('e1', 1, { q: 1, r: 0 });
    const r = findPath(
      STRIP,
      unitsAt([enemy]),
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      INF,
      0,
    );
    expect(r).not.toBeNull();
    expect(r!.path).toEqual([{ q: 1, r: 0 }]);
  });

  test('cannot path PAST an enemy hex — enemies terminate further pathing', () => {
    const enemy = placeUnit('e1', 1, { q: 1, r: 0 });
    const r = findPath(
      STRIP,
      unitsAt([enemy]),
      { q: 0, r: 0 },
      { q: 2, r: 0 }, // past the enemy
      INF,
      0,
    );
    // STRIP is 1D so going around is impossible.
    expect(r).toBeNull();
  });

  test('a unit standing on the from hex does not block its own path', () => {
    const self = placeUnit('me', 0, { q: 0, r: 0 });
    const r = findPath(
      STRIP,
      unitsAt([self]),
      { q: 0, r: 0 },
      { q: 2, r: 0 },
      INF,
      0,
    );
    expect(r).not.toBeNull();
    expect(r!.totalCost).toBe(6);
  });
});
