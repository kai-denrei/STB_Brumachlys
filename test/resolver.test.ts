import { describe, expect, test } from 'vitest';
import { resolveRound } from '../src/core/resolver.ts';
import { loadUnits } from '../src/io/data-loader.ts';
import type {
  GameState,
  GameMap,
  UnitInstance,
  TerrainKey,
  Hex,
  Stance,
} from '../src/core/types.ts';
import type { Order } from '../src/core/orders.ts';

const unitTypes = loadUnits();

function makeMap(spec: Record<string, TerrainKey>): GameMap {
  return {
    name: 'test',
    width: 99,
    height: 99,
    tiles: new Map(Object.entries(spec)),
    startingUnits: [],
    startingBases: [],
  };
}

function unit(
  id: string,
  type: 'infantry' | 'tank',
  faction: 0 | 1,
  hex: Hex,
  count = 10,
  stance: Stance = 'aggressive',
): UnitInstance {
  return { id, type, faction, hex, count, stance, attackedFromHexes: [] };
}

function plainsField(width: number, height: number): Record<string, TerrainKey> {
  const out: Record<string, TerrainKey> = {};
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) out[`${q},${r}`] = 'plains';
  }
  return out;
}

function state(units: UnitInstance[], map?: GameMap): GameState {
  return {
    round: 1,
    phase: 'resolution',
    activePlanner: null,
    map: map ?? makeMap(plainsField(20, 5)),
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 1,
    log: [],
  };
}

describe('resolveRound — stance changes', () => {
  test('stance order applied at start of round; emits stance event', () => {
    const u = unit('u', 'infantry', 0, { q: 0, r: 0 });
    const s = state([u]);
    const orders: Order[] = [{ kind: 'stance', unitId: 'u', stance: 'hold-fire' }];
    const { newState, log } = resolveRound(s, orders, [], unitTypes);
    expect(newState.units.u!.stance).toBe('hold-fire');
    expect(log.find((e) => e.type === 'stance' && e.unitId === 'u')).toBeDefined();
  });
});

describe('resolveRound — Phase A movement', () => {
  test('simple move: unit walks to destination and emits move event', () => {
    const u = unit('u', 'infantry', 0, { q: 0, r: 0 });
    const s = state([u]);
    const orders: Order[] = [
      { kind: 'move', unitId: 'u', path: [{ q: 1, r: 0 }, { q: 2, r: 0 }] },
    ];
    const { newState, log } = resolveRound(s, orders, [], unitTypes);
    expect(newState.units.u!.hex).toEqual({ q: 2, r: 0 });
    const move = log.find((e) => e.type === 'move');
    expect(move).toBeDefined();
    if (move?.type === 'move') {
      expect(move.from).toEqual({ q: 0, r: 0 });
      expect(move.to).toEqual({ q: 2, r: 0 });
    }
  });

  test('movement budget exhaustion → unit stops where budget runs out', () => {
    // Infantry budget 9. 4 plains cost 12. Unit should stop at index 2 (cost 9).
    const u = unit('u', 'infantry', 0, { q: 0, r: 0 });
    const s = state([u]);
    const orders: Order[] = [
      {
        kind: 'move',
        unitId: 'u',
        path: [
          { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: 0 },
        ],
      },
    ];
    const { newState, log } = resolveRound(s, orders, [], unitTypes);
    expect(newState.units.u!.hex).toEqual({ q: 3, r: 0 });
    // Path-truncated event emitted
    expect(log.some((e) => e.type === 'path-truncated')).toBe(true);
  });

  test('two units want the same hex → higher init wins, lower stops one back', () => {
    // Infantry init 8, Tank init 6. Both want (2,0). Infantry wins.
    const inf = unit('inf', 'infantry', 0, { q: 0, r: 0 });
    const tnk = unit('tnk', 'tank', 1, { q: 4, r: 0 });
    const s = state([inf, tnk]);
    const ordersP0: Order[] = [
      { kind: 'move', unitId: 'inf', path: [{ q: 1, r: 0 }, { q: 2, r: 0 }] },
    ];
    const ordersP1: Order[] = [
      // Tank moves W into (3,0) then (2,0). Tank movement 12, plains cost 3, plenty of budget.
      { kind: 'move', unitId: 'tnk', path: [{ q: 3, r: 0 }, { q: 2, r: 0 }] },
    ];
    const { newState } = resolveRound(s, ordersP0, ordersP1, unitTypes);
    expect(newState.units.inf!.hex).toEqual({ q: 2, r: 0 });
    // Tank should be at (3,0) — stopped one back
    expect(newState.units.tnk!.hex).toEqual({ q: 3, r: 0 });
  });

  test('move blocked by enemy → unit stops at last empty hex along path', () => {
    const me = unit('me', 'infantry', 0, { q: 0, r: 0 });
    const enemy = unit('e', 'infantry', 1, { q: 2, r: 0 });
    const s = state([me, enemy]);
    const orders: Order[] = [
      { kind: 'move', unitId: 'me', path: [{ q: 1, r: 0 }, { q: 2, r: 0 }] },
    ];
    const { newState } = resolveRound(s, orders, [], unitTypes);
    expect(newState.units.me!.hex).toEqual({ q: 1, r: 0 });
  });
});

describe('resolveRound — Phase B combat', () => {
  test('basic queued attack: damage applied, attack + counter events emitted', () => {
    const att = unit('att', 'infantry', 0, { q: 0, r: 0 });
    // Defender is defensive: counters but does not auto-attack — matches §11.2 fixture.
    const def = unit('def', 'tank', 1, { q: 1, r: 0 }, 10, 'defensive');
    const s = state([att, def]);
    const orders: Order[] = [
      { kind: 'attack', unitId: 'att', targetHex: { q: 1, r: 0 } },
    ];
    const { newState, log } = resolveRound(s, orders, [], unitTypes);
    // §11.2: inf vs tank dmg=4, tank vs inf dmg=5
    expect(newState.units.att!.count).toBe(5);
    expect(newState.units.def!.count).toBe(6);
    expect(log.some((e) => e.type === 'attack' && 'damage' in e && e.damage === 4)).toBe(true);
    expect(log.some((e) => e.type === 'counter' && 'damage' in e && e.damage === 5)).toBe(true);
  });

  test('hold-fire defender does NOT counter-attack', () => {
    const att = unit('att', 'infantry', 0, { q: 0, r: 0 });
    const def = unit('def', 'tank', 1, { q: 1, r: 0 }, 10, 'hold-fire');
    const s = state([att, def]);
    const orders: Order[] = [
      { kind: 'attack', unitId: 'att', targetHex: { q: 1, r: 0 } },
    ];
    const { newState, log } = resolveRound(s, orders, [], unitTypes);
    expect(newState.units.att!.count).toBe(10); // untouched
    expect(newState.units.def!.count).toBe(6); // hit by 4 damage
    expect(log.some((e) => e.type === 'counter')).toBe(false);
  });

  test('aggressive without queued attack auto-attacks closest enemy', () => {
    const att = unit('att', 'infantry', 0, { q: 0, r: 0 }, 10, 'aggressive');
    // Defensive defender so it counters but doesn't initiate its own auto-attack.
    const def = unit('def', 'tank', 1, { q: 1, r: 0 }, 10, 'defensive');
    const s = state([att, def]);
    const { newState } = resolveRound(s, [], [], unitTypes);
    expect(newState.units.def!.count).toBe(6); // hit by 4 dmg
  });

  test('defensive without queued attack does NOT auto-attack but still counters', () => {
    const att = unit('att', 'infantry', 0, { q: 0, r: 0 }, 10, 'defensive');
    const def = unit('def', 'tank', 1, { q: 1, r: 0 }, 10, 'defensive');
    const s = state([att, def]);
    const { newState, log } = resolveRound(s, [], [], unitTypes);
    // Neither initiated, so neither hit
    expect(newState.units.att!.count).toBe(10);
    expect(newState.units.def!.count).toBe(10);
    expect(log.some((e) => e.type === 'attack')).toBe(false);
  });

  test('out-of-range queued attack fizzles (lost-target)', () => {
    const att = unit('att', 'infantry', 0, { q: 0, r: 0 });
    const def = unit('def', 'tank', 1, { q: 5, r: 0 }); // far away
    const s = state([att, def]);
    const orders: Order[] = [
      { kind: 'attack', unitId: 'att', targetHex: { q: 5, r: 0 } },
    ];
    const { newState, log } = resolveRound(s, orders, [], unitTypes);
    expect(newState.units.def!.count).toBe(10);
    expect(log.some((e) => e.type === 'lost-target')).toBe(true);
  });

  test('killed unit removed; kill event emitted', () => {
    // Two infantry attack a fragile (count=2) defensive tank from opposite sides.
    // First hit: B=0, dmg=round(min(10,2)*0.4)=1. Tank 1.
    // Second hit: B=3, dmg=round(min(10,1)*0.55)=1. Tank 0 → killed.
    const a1 = unit('a1', 'infantry', 0, { q: 0, r: 0 });
    const a2 = unit('a2', 'infantry', 0, { q: 2, r: 0 });
    const tank = unit('tnk', 'tank', 1, { q: 1, r: 0 }, 2, 'defensive');
    const s = state([a1, a2, tank]);
    const orders: Order[] = [
      { kind: 'attack', unitId: 'a1', targetHex: { q: 1, r: 0 } },
      { kind: 'attack', unitId: 'a2', targetHex: { q: 1, r: 0 } },
    ];
    const { newState, log } = resolveRound(s, orders, [], unitTypes);
    expect(newState.units.tnk).toBeUndefined();
    expect(log.some((e) => e.type === 'kill' && 'unitId' in e && e.unitId === 'tnk')).toBe(true);
  });

  test('queued attack at empty hex fizzles (lost-target)', () => {
    const att = unit('att', 'infantry', 0, { q: 0, r: 0 }, 10, 'defensive');
    const s = state([att]);
    const orders: Order[] = [
      { kind: 'attack', unitId: 'att', targetHex: { q: 5, r: 5 } },
    ];
    const { log } = resolveRound(s, orders, [], unitTypes);
    expect(log.some((e) => e.type === 'lost-target')).toBe(true);
  });

  test('gang-up: opposite attacker contributes B=3 to second hit', () => {
    // Inf-A at (0,0), Inf-B at (2,0), Tank at (1,0). Both infantry attack tank.
    // Tank counter dmg=5 each — but applied after damage to A and B both.
    // A fires first (init tie broken by hash, but let's check both orderings).
    // First attacker hits with B=0; tank.attackedFromHexes = [(0,0)] (or (2,0)).
    // Second hits with B=3 (opposite).
    // First strike: dmg = round(min(10,10) * 0.4) = 4. Tank now 6.
    // Second strike: dmg = round(min(10,6) * 0.55) = round(3.3) = 3. Tank now 3.
    const a = unit('a', 'infantry', 0, { q: 0, r: 0 });
    const b = unit('b', 'infantry', 0, { q: 2, r: 0 });
    // Defensive tank: counters but does not auto-attack between the two infantry strikes.
    const tnk = unit('tnk', 'tank', 1, { q: 1, r: 0 }, 10, 'defensive');
    const s = state([a, b, tnk]);
    const orders: Order[] = [
      { kind: 'attack', unitId: 'a', targetHex: { q: 1, r: 0 } },
      { kind: 'attack', unitId: 'b', targetHex: { q: 1, r: 0 } },
    ];
    const { newState } = resolveRound(s, orders, [], unitTypes);
    expect(newState.units.tnk!.count).toBe(3);
  });
});

describe('resolveRound — determinism (§11.3)', () => {
  test('same input → byte-identical event log', () => {
    const a = unit('a', 'infantry', 0, { q: 0, r: 0 });
    const t = unit('t', 'tank', 1, { q: 1, r: 0 });
    const s = state([a, t]);
    const orders: Order[] = [{ kind: 'attack', unitId: 'a', targetHex: { q: 1, r: 0 } }];
    const r1 = resolveRound(s, orders, [], unitTypes);
    const r2 = resolveRound(s, orders, [], unitTypes);
    expect(JSON.stringify(r1.log)).toBe(JSON.stringify(r2.log));
  });

  test('order independence: shuffling input arrays does not change the log', () => {
    const a1 = unit('a1', 'infantry', 0, { q: 0, r: 0 });
    const a2 = unit('a2', 'infantry', 0, { q: 2, r: 0 });
    const t = unit('t', 'tank', 1, { q: 1, r: 0 });
    const s = state([a1, a2, t]);
    const orders0 = [
      { kind: 'attack' as const, unitId: 'a1', targetHex: { q: 1, r: 0 } },
      { kind: 'attack' as const, unitId: 'a2', targetHex: { q: 1, r: 0 } },
    ];
    const r1 = resolveRound(s, orders0, [], unitTypes);
    const r2 = resolveRound(s, orders0.slice().reverse(), [], unitTypes);
    expect(JSON.stringify(r1.log)).toBe(JSON.stringify(r2.log));
  });

  test('newState clears pendingOrders and increments round', () => {
    const u = unit('u', 'infantry', 0, { q: 0, r: 0 });
    const s = state([u]);
    s.pendingOrders[0] = [{ kind: 'stance', unitId: 'u', stance: 'defensive' }];
    const { newState } = resolveRound(s, s.pendingOrders[0], [], unitTypes);
    expect(newState.round).toBe(2);
    expect(newState.pendingOrders[0]).toEqual([]);
    expect(newState.pendingOrders[1]).toEqual([]);
  });

  test('attackedFromHexes accumulators cleared on new round', () => {
    const a = unit('a', 'infantry', 0, { q: 0, r: 0 });
    const t = unit('t', 'tank', 1, { q: 1, r: 0 });
    const s = state([a, t]);
    const { newState } = resolveRound(
      s,
      [{ kind: 'attack', unitId: 'a', targetHex: { q: 1, r: 0 } }],
      [],
      unitTypes,
    );
    if (newState.units.t) {
      expect(newState.units.t.attackedFromHexes).toEqual([]);
    }
  });
});
