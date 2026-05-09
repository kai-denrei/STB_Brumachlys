import { describe, expect, test } from 'vitest';
import { visibleHexesFor } from '../src/core/fog.ts';
import type { GameState, UnitInstance, UnitType } from '../src/core/types.ts';

// Minimal unit-type registry. Only `vision` matters for fog.
const unitTypes: Record<string, UnitType> = {
  infantry: { vision: 2 } as UnitType,
  recon: { vision: 3 } as UnitType,
};

function unit(id: string, faction: 0 | 1, q: number, r: number, type = 'infantry'): UnitInstance {
  return {
    id,
    type,
    faction,
    hex: { q, r },
    count: 10,
    stance: 'aggressive',
    attackedFromHexes: [],
  };
}

function stateWith(units: UnitInstance[]): GameState {
  const map = new Map<string, UnitInstance>();
  for (const u of units) map.set(u.id, u);
  return { units: Object.fromEntries(map) } as GameState;
}

describe('visibleHexesFor (§11.4)', () => {
  test('5 hexes apart, vision 2 → enemy not visible', () => {
    const friendly = unit('f0a', 0, 0, 0);
    const enemy = unit('f1a', 1, 5, 0);
    const visible = visibleHexesFor(stateWith([friendly, enemy]), 0, unitTypes);
    expect(visible.has(`${enemy.hex.q},${enemy.hex.r}`)).toBe(false);
  });

  test('4 hexes apart, vision 2 → still not visible', () => {
    const friendly = unit('f0a', 0, 0, 0);
    const enemy = unit('f1a', 1, 4, 0);
    const visible = visibleHexesFor(stateWith([friendly, enemy]), 0, unitTypes);
    expect(visible.has(`${enemy.hex.q},${enemy.hex.r}`)).toBe(false);
  });

  test('2 hexes apart, vision 2 → visible', () => {
    const friendly = unit('f0a', 0, 0, 0);
    const enemy = unit('f1a', 1, 2, 0);
    const visible = visibleHexesFor(stateWith([friendly, enemy]), 0, unitTypes);
    expect(visible.has(`${enemy.hex.q},${enemy.hex.r}`)).toBe(true);
  });

  test('exactly at vision distance is visible (≤ vision, not <)', () => {
    const friendly = unit('f0a', 0, 0, 0, 'recon'); // vision 3
    const enemy = unit('f1a', 1, 3, 0);
    const visible = visibleHexesFor(stateWith([friendly, enemy]), 0, unitTypes);
    expect(visible.has(`${enemy.hex.q},${enemy.hex.r}`)).toBe(true);
  });
});

describe('visibleHexesFor — set semantics', () => {
  test('union over multiple friendly units', () => {
    const a = unit('a', 0, 0, 0); // sees within 2 of (0,0)
    const b = unit('b', 0, 10, 10); // sees within 2 of (10,10)
    const visible = visibleHexesFor(stateWith([a, b]), 0, unitTypes);
    // Both centers are visible (distance 0)
    expect(visible.has('0,0')).toBe(true);
    expect(visible.has('10,10')).toBe(true);
    // Neighbours of each are visible
    expect(visible.has('1,0')).toBe(true);
    expect(visible.has('11,10')).toBe(true);
    // Mid-point between them is NOT visible (out of range of both)
    expect(visible.has('5,5')).toBe(false);
  });

  test('only friendly units contribute', () => {
    const friendly = unit('f', 0, 0, 0);
    const enemy = unit('e', 1, 100, 100);
    const visible = visibleHexesFor(stateWith([friendly, enemy]), 0, unitTypes);
    // Hexes near the enemy are NOT visible to faction 0 because that's faction 1's unit.
    expect(visible.has('100,100')).toBe(false);
    expect(visible.has('101,100')).toBe(false);
  });

  test('a faction with no units sees nothing', () => {
    const enemy = unit('e', 1, 0, 0);
    const visible = visibleHexesFor(stateWith([enemy]), 0, unitTypes);
    expect(visible.size).toBe(0);
  });

  test('returns "q,r" string keys', () => {
    const u = unit('u', 0, 3, -2);
    const visible = visibleHexesFor(stateWith([u]), 0, unitTypes);
    expect(visible.has('3,-2')).toBe(true); // self
    // Sample shape: arbitrary key from set is "q,r"
    for (const k of visible) {
      expect(k).toMatch(/^-?\d+,-?\d+$/);
    }
  });
});

describe('hexesWithin (helper, used by fog)', () => {
  test('radius 0 returns just the center', async () => {
    const { hexesWithin } = await import('../src/core/hex.ts');
    expect(hexesWithin({ q: 5, r: 7 }, 0)).toEqual([{ q: 5, r: 7 }]);
  });

  test('radius 1 returns 7 hexes (center + 6 neighbours)', async () => {
    const { hexesWithin } = await import('../src/core/hex.ts');
    expect(hexesWithin({ q: 5, r: 7 }, 1)).toHaveLength(7);
  });

  test('radius 2 returns 19 hexes', async () => {
    const { hexesWithin } = await import('../src/core/hex.ts');
    // 1 + 6 + 12 = 19
    expect(hexesWithin({ q: 0, r: 0 }, 2)).toHaveLength(19);
  });
});
