import { describe, expect, test } from 'vitest';
import { generateAIOrders } from '../src/core/ai.ts';
import { loadUnits } from '../src/io/data-loader.ts';
import type { GameMap, GameState, UnitInstance, TerrainKey, Hex } from '../src/core/types.ts';

const unitTypes = loadUnits();

function plainsField(width: number, height: number): Record<string, TerrainKey> {
  const out: Record<string, TerrainKey> = {};
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) out[`${q},${r}`] = 'plains';
  }
  return out;
}

function makeMap(): GameMap {
  return {
    name: 'test',
    width: 99,
    height: 99,
    initialCredits: 0,
    perBaseCredits: 0,
    tiles: new Map(Object.entries(plainsField(20, 5))),
    startingUnits: [],
    startingBases: [],
  };
}

function unit(id: string, type: 'infantry' | 'tank', faction: 0 | 1, hex: Hex): UnitInstance {
  return { id, type, faction, hex, count: 10, stance: 'aggressive', attackedFromHexes: [] };
}

function state(units: UnitInstance[]): GameState {
  return {
    round: 1,
    phase: 'planning',
    activePlanner: 1,
    map: makeMap(),
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 1,
    log: [],
    credits: { 0: 0, 1: 0 },
    unitIdCounter: 0,
  };
}

describe('generateAIOrders — basic behaviour for solo / troubleshoot AI', () => {
  test('no enemies → no orders', () => {
    const ai = unit('a', 'infantry', 1, { q: 5, r: 0 });
    const ally = unit('b', 'infantry', 1, { q: 6, r: 0 });
    const orders = generateAIOrders(state([ai, ally]), 1, unitTypes);
    expect(orders).toEqual([]);
  });

  test('AI in attack range of enemy → queues an attack, no move', () => {
    const enemy = unit('e', 'infantry', 0, { q: 5, r: 0 });
    const ai = unit('a', 'infantry', 1, { q: 6, r: 0 }); // adjacent
    const orders = generateAIOrders(state([enemy, ai]), 1, unitTypes);
    expect(orders.some((o) => o.kind === 'attack' && o.unitId === 'a')).toBe(true);
    expect(orders.some((o) => o.kind === 'move' && o.unitId === 'a')).toBe(false);
  });

  test('AI not in range → queues a move toward the nearest enemy', () => {
    const enemy = unit('e', 'infantry', 0, { q: 0, r: 0 });
    const ai = unit('a', 'infantry', 1, { q: 9, r: 0 });
    const orders = generateAIOrders(state([enemy, ai]), 1, unitTypes);
    const moveOrder = orders.find((o) => o.kind === 'move' && o.unitId === 'a');
    expect(moveOrder).toBeDefined();
    if (moveOrder && moveOrder.kind === 'move') {
      // Path should reduce distance to the enemy.
      const last = moveOrder.path[moveOrder.path.length - 1]!;
      expect(last.q).toBeLessThan(9);
    }
  });

  test('AI picks the NEAREST enemy when multiple are present', () => {
    const far = unit('far', 'infantry', 0, { q: 0, r: 0 });
    const near = unit('near', 'infantry', 0, { q: 7, r: 0 });
    const ai = unit('a', 'infantry', 1, { q: 8, r: 0 });
    const orders = generateAIOrders(state([far, near, ai]), 1, unitTypes);
    // Already adjacent to `near`, should attack it (not the further `far`)
    const atk = orders.find((o) => o.kind === 'attack' && o.unitId === 'a');
    expect(atk).toBeDefined();
    if (atk && atk.kind === 'attack') {
      expect(atk.targetHex).toEqual({ q: 7, r: 0 });
    }
  });

  test('multiple AI units all generate orders independently', () => {
    const enemy = unit('e', 'infantry', 0, { q: 0, r: 0 });
    const a1 = unit('a1', 'infantry', 1, { q: 4, r: 0 });
    const a2 = unit('a2', 'infantry', 1, { q: 5, r: 0 });
    const orders = generateAIOrders(state([enemy, a1, a2]), 1, unitTypes);
    expect(orders.some((o) => o.kind === 'move' && o.unitId === 'a1')).toBe(true);
    expect(orders.some((o) => o.kind === 'move' && o.unitId === 'a2')).toBe(true);
  });
});

describe('generateAIOrders — buy orders', () => {
  function stateWithBaseAndCredits(
    units: UnitInstance[],
    base: { hex: Hex; faction: 0 | 1 | null },
    credits: { 0: number; 1: number },
  ): GameState {
    const map = makeMap();
    map.startingBases = [base];
    return {
      ...state(units),
      map,
      credits,
    };
  }

  test('AI with empty owned base + sufficient credits queues an infantry buy', () => {
    const enemy = unit('e', 'infantry', 0, { q: 0, r: 0 });
    const s = stateWithBaseAndCredits(
      [enemy],
      { hex: { q: 10, r: 2 }, faction: 1 },
      { 0: 0, 1: 100 },
    );
    const orders = generateAIOrders(s, 1, unitTypes);
    const buy = orders.find((o) => o.kind === 'buy');
    expect(buy).toBeDefined();
    if (buy && buy.kind === 'buy') {
      expect(buy.unitTypeKey).toBe('infantry');
      expect(buy.baseHex).toEqual({ q: 10, r: 2 });
    }
  });

  test('AI with insufficient credits does NOT queue a buy', () => {
    const enemy = unit('e', 'infantry', 0, { q: 0, r: 0 });
    const s = stateWithBaseAndCredits(
      [enemy],
      { hex: { q: 10, r: 2 }, faction: 1 },
      { 0: 0, 1: 10 }, // less than infantry cost
    );
    const orders = generateAIOrders(s, 1, unitTypes);
    expect(orders.some((o) => o.kind === 'buy')).toBe(false);
  });

  test('AI does NOT buy at a base owned by the enemy', () => {
    const enemy = unit('e', 'infantry', 0, { q: 0, r: 0 });
    const s = stateWithBaseAndCredits(
      [enemy],
      { hex: { q: 10, r: 2 }, faction: 0 }, // enemy owned
      { 0: 0, 1: 1000 },
    );
    const orders = generateAIOrders(s, 1, unitTypes);
    expect(orders.some((o) => o.kind === 'buy')).toBe(false);
  });

  test('AI does NOT buy when its unit stays on the base (no move queued)', () => {
    // Enemy adjacent to the AI unit's current hex → AI queues an attack with
    // no move, so the unit doesn't vacate the base. Buy must be skipped.
    const enemy = unit('e', 'infantry', 0, { q: 11, r: 2 });
    const ai = unit('a', 'infantry', 1, { q: 10, r: 2 });
    const s = stateWithBaseAndCredits(
      [enemy, ai],
      { hex: { q: 10, r: 2 }, faction: 1 },
      { 0: 0, 1: 1000 },
    );
    const orders = generateAIOrders(s, 1, unitTypes);
    expect(orders.some((o) => o.kind === 'attack' && o.unitId === 'a')).toBe(true);
    expect(orders.some((o) => o.kind === 'move' && o.unitId === 'a')).toBe(false);
    expect(orders.some((o) => o.kind === 'buy')).toBe(false);
  });

  test('AI buys at a base its unit is leaving this round (post-move occupancy)', () => {
    // Unit at the base will move toward a distant enemy → vacates the base
    // → resolver buy phase happens after movement → AI can buy here.
    const enemy = unit('e', 'infantry', 0, { q: 0, r: 2 });
    const ai = unit('a', 'infantry', 1, { q: 10, r: 2 });
    const s = stateWithBaseAndCredits(
      [enemy, ai],
      { hex: { q: 10, r: 2 }, faction: 1 },
      { 0: 0, 1: 1000 },
    );
    const orders = generateAIOrders(s, 1, unitTypes);
    expect(orders.some((o) => o.kind === 'move' && o.unitId === 'a')).toBe(true);
    expect(orders.some((o) => o.kind === 'buy' && o.baseHex.q === 10 && o.baseHex.r === 2)).toBe(true);
  });
});
