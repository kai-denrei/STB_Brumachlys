import { describe, expect, test } from 'vitest';
import {
  distance,
  adjacent,
  opposite,
  neighbors,
  offsetToCube,
  cubeToOffset,
  key,
  equals,
} from '../src/core/hex.ts';

// Odd-r offset coordinates (matches Zetawar). See BRUMACHLYS.md §11.1.

describe('distance (odd-r offset)', () => {
  test('zero distance to self', () => {
    expect(distance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
  });

  test('east neighbour, same row', () => {
    expect(distance({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1);
  });

  test('south-east neighbour, next row', () => {
    expect(distance({ q: 0, r: 0 }, { q: 0, r: 1 })).toBe(1);
  });

  test('three hexes east', () => {
    expect(distance({ q: 0, r: 0 }, { q: 3, r: 0 })).toBe(3);
  });

  test('diagonal (3,3) — verified against cube conversion', () => {
    expect(distance({ q: 0, r: 0 }, { q: 3, r: 3 })).toBe(5);
  });

  test('symmetric', () => {
    expect(distance({ q: 5, r: 7 }, { q: 2, r: 3 })).toBe(
      distance({ q: 2, r: 3 }, { q: 5, r: 7 }),
    );
  });
});

describe('adjacent', () => {
  test('east neighbour is adjacent', () => {
    expect(adjacent({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(true);
  });

  test('two hexes east is not adjacent', () => {
    expect(adjacent({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe(false);
  });

  test('a hex is not adjacent to itself', () => {
    expect(adjacent({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(false);
  });

  test('all six neighbours of a center hex are adjacent', () => {
    const center = { q: 4, r: 4 };
    for (const n of neighbors(center)) {
      expect(adjacent(center, n)).toBe(true);
    }
  });
});

describe('neighbors (odd-r offset)', () => {
  test('returns exactly 6 distinct hexes', () => {
    const ns = neighbors({ q: 4, r: 4 });
    expect(ns).toHaveLength(6);
    const seen = new Set(ns.map(key));
    expect(seen.size).toBe(6);
  });

  test('each neighbour is at distance 1', () => {
    const center = { q: 3, r: 5 };
    for (const n of neighbors(center)) {
      expect(distance(center, n)).toBe(1);
    }
  });

  test('odd-row and even-row neighbours differ correctly', () => {
    // For odd-r: even rows shift left for upper/lower diagonals; odd rows shift right.
    // Sanity: from (0,0) (even row), upper-left should be (-1,-1) and upper-right (0,-1).
    const evenRow = neighbors({ q: 0, r: 0 }).map(key).sort();
    expect(evenRow).toEqual(['-1,-1', '-1,0', '-1,1', '0,-1', '0,1', '1,0'].sort());

    // From (0,1) (odd row), upper-left should be (0,0) and upper-right (1,0).
    const oddRow = neighbors({ q: 0, r: 1 }).map(key).sort();
    expect(oddRow).toEqual(['-1,1', '0,0', '0,2', '1,0', '1,1', '1,2'].sort());
  });
});

describe('opposite', () => {
  test('east-east-east: (0,0) defender (1,0) other (2,0)', () => {
    expect(opposite({ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 })).toBe(true);
  });

  test('not opposite when not collinear through defender', () => {
    expect(opposite({ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: 1 })).toBe(false);
  });

  test('symmetric in attacker and other-attacker', () => {
    const a = { q: 5, r: 5 };
    const d = { q: 6, r: 5 };
    const c = { q: 7, r: 5 };
    expect(opposite(a, d, c)).toBe(opposite(c, d, a));
  });

  test('two ranged attackers diametrically across defender', () => {
    // (0,0) and (4,0) are both 2 hexes from defender (2,0), on opposite sides.
    expect(opposite({ q: 0, r: 0 }, { q: 2, r: 0 }, { q: 4, r: 0 })).toBe(true);
  });

  test('attacker and other-attacker are the same hex → not opposite', () => {
    expect(opposite({ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 0 })).toBe(false);
  });
});

describe('cube conversions are inverses', () => {
  test.each([
    [{ q: 0, r: 0 }],
    [{ q: 1, r: 0 }],
    [{ q: 0, r: 1 }],
    [{ q: 3, r: 3 }],
    [{ q: 7, r: 12 }],
    [{ q: -4, r: -3 }],
  ])('round-trip %j', (h) => {
    const cube = offsetToCube(h);
    expect(cube.x + cube.y + cube.z).toBe(0);
    expect(cubeToOffset(cube)).toEqual(h);
  });
});

describe('key and equals', () => {
  test('key is "q,r"', () => {
    expect(key({ q: 3, r: -2 })).toBe('3,-2');
  });

  test('equals is reflexive and value-based', () => {
    expect(equals({ q: 1, r: 2 }, { q: 1, r: 2 })).toBe(true);
    expect(equals({ q: 1, r: 2 }, { q: 1, r: 3 })).toBe(false);
  });
});
