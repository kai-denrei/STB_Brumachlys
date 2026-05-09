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
    initialCredits: 0,
    perBaseCredits: 0,
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

function state(
  units: UnitInstance[],
  map?: GameMap,
  credits: Record<0 | 1, number> = { 0: 0, 1: 0 },
): GameState {
  return {
    round: 1,
    phase: 'resolution',
    activePlanner: null,
    map: map ?? makeMap(plainsField(20, 5)),
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    pendingOrders: { 0: [], 1: [] },
    rngSeed: 1,
    log: [],
    credits,
    unitIdCounter: 100,
  };
}

function makeMapWithBases(
  spec: Record<string, TerrainKey>,
  bases: Array<{ hex: { q: number; r: number }; faction: 0 | 1 | null }>,
  perBaseCredits = 100,
  initialCredits = 200,
): GameMap {
  return {
    name: 'test',
    width: 99,
    height: 99,
    initialCredits,
    perBaseCredits,
    tiles: new Map(Object.entries(spec)),
    startingUnits: [],
    startingBases: bases,
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

  test('two enemy units want the same hex → both enter, mêlée resolves the stack', () => {
    // Infantry init 8, Tank init 6. Both want (2,0). With mêlée stacking:
    // both land at (2,0) (in init order), then Phase A.5 resolves the brawl.
    const inf = unit('inf', 'infantry', 0, { q: 0, r: 0 });
    const tnk = unit('tnk', 'tank', 1, { q: 4, r: 0 });
    const s = state([inf, tnk]);
    const ordersP0: Order[] = [
      { kind: 'move', unitId: 'inf', path: [{ q: 1, r: 0 }, { q: 2, r: 0 }] },
    ];
    const ordersP1: Order[] = [
      { kind: 'move', unitId: 'tnk', path: [{ q: 3, r: 0 }, { q: 2, r: 0 }] },
    ];
    const { newState, log } = resolveRound(s, ordersP0, ordersP1, unitTypes);
    // Both moves landed at (2,0); the move events show the contested hex.
    const moveEvents = log.filter((e) => e.type === 'move');
    expect(moveEvents.some((e) => e.type === 'move' && e.unitId === 'inf' && e.to.q === 2 && e.to.r === 0)).toBe(true);
    expect(moveEvents.some((e) => e.type === 'move' && e.unitId === 'tnk' && e.to.q === 2 && e.to.r === 0)).toBe(true);
    // Mêlée fired — at least one attack at the stacked hex.
    expect(log.some((e) => e.type === 'attack')).toBe(true);
    // Survivors (if any) sit on (2,0).
    for (const u of Object.values(newState.units)) {
      expect(u.hex).toEqual({ q: 2, r: 0 });
    }
  });

  test('move into enemy hex enters and triggers mêlée (no longer "stop one back")', () => {
    const me = unit('me', 'infantry', 0, { q: 0, r: 0 });
    const enemy = unit('e', 'infantry', 1, { q: 2, r: 0 });
    const s = state([me, enemy]);
    const orders: Order[] = [
      { kind: 'move', unitId: 'me', path: [{ q: 1, r: 0 }, { q: 2, r: 0 }] },
    ];
    const { newState, log } = resolveRound(s, orders, [], unitTypes);
    // The move event lands at (2,0).
    const moveEv = log.find((e) => e.type === 'move' && e.unitId === 'me');
    expect(moveEv && moveEv.type === 'move' && moveEv.to).toEqual({ q: 2, r: 0 });
    // Mêlée fires at the stacked hex — at least one attack event (init tie:
    // both infantry, same round, FNV-1a tiebreaks deterministically).
    expect(log.some((e) => e.type === 'attack')).toBe(true);
    // Surviving units (if any) are at (2,0).
    for (const u of Object.values(newState.units)) {
      expect(u.hex).toEqual({ q: 2, r: 0 });
    }
  });
});

describe('resolveRound — Phase A.5 mêlée stacking', () => {
  test('two enemies starting stacked brawl until at least one is dead OR mutually-immune', () => {
    // Pre-stacked: no movement orders, but mêlée still fires at end of Phase A.
    const a = unit('a', 'infantry', 0, { q: 1, r: 1 });
    const b = unit('b', 'infantry', 1, { q: 1, r: 1 });
    const s = state([a, b]);
    const { newState, log } = resolveRound(s, [], [], unitTypes);

    // At least one attack landed.
    expect(log.some((e) => e.type === 'attack')).toBe(true);
    // No movement events (nobody moved).
    expect(log.some((e) => e.type === 'move')).toBe(false);
    // Outcome — survivors only, all on (1,1). Equal-stat infantry vs infantry
    // stalemate is possible since both deal the same damage; the brawl exits
    // when both deal zero on a strike.
    for (const u of Object.values(newState.units)) {
      expect(u.hex).toEqual({ q: 1, r: 1 });
    }
  });

  test('infantry vs naval-armored stalemate exits without infinite loop (no mutual damage)', () => {
    // Synthesise an "armored-naval-like" type that infantry can't damage AND
    // that can't damage infantry: use an empty attackStrengths matrix.
    const synth = {
      ...unitTypes.infantry!,
      key: 'untouchable',
      armorType: 'naval' as const,
      attackStrengths: { personnel: 0, armored: 0, naval: 0, air: 0 },
    };
    const types = { ...unitTypes, untouchable: synth };
    const inf = unit('inf', 'infantry', 0, { q: 0, r: 0 });
    const ghost = { ...unit('ghost', 'infantry', 1, { q: 0, r: 0 }), type: 'untouchable' };
    const s = state([inf, ghost]);
    const { newState, log } = resolveRound(s, [], [], types);
    // Both alive, no kills, exactly one attack + one counter (or just one
    // attack if counter is gated out) before stalemate exit.
    expect(Object.values(newState.units).length).toBe(2);
    expect(log.filter((e) => e.type === 'kill').length).toBe(0);
    expect(log.filter((e) => e.type === 'attack').length).toBeLessThanOrEqual(1);
  });

  test('phase A.5 fires AFTER movement, so a unit moving in then triggers the brawl in the same round', () => {
    const me = unit('me', 'tank', 0, { q: 0, r: 0 });
    const enemy = unit('enemy', 'infantry', 1, { q: 1, r: 0 });
    const s = state([me, enemy]);
    const orders: Order[] = [
      { kind: 'move', unitId: 'me', path: [{ q: 1, r: 0 }] },
    ];
    const { log } = resolveRound(s, orders, [], unitTypes);
    // First the move event, then the brawl events — order matters.
    const idxMove = log.findIndex((e) => e.type === 'move');
    const idxAttack = log.findIndex((e) => e.type === 'attack');
    expect(idxMove).toBeGreaterThanOrEqual(0);
    expect(idxAttack).toBeGreaterThan(idxMove);
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

describe('resolveRound — Phase E economy', () => {
  test('per-owned-base income added at end of round', () => {
    const map = makeMapWithBases(
      { '0,0': 'base', '1,0': 'base', '2,0': 'base' },
      [
        { hex: { q: 0, r: 0 }, faction: 0 },
        { hex: { q: 1, r: 0 }, faction: 1 },
        { hex: { q: 2, r: 0 }, faction: null }, // neutral, no income
      ],
      150,
    );
    const s = state([], map, { 0: 50, 1: 50 });
    const { newState, log } = resolveRound(s, [], [], unitTypes);
    expect(newState.credits[0]).toBe(50 + 150);
    expect(newState.credits[1]).toBe(50 + 150);
    const incomeEvents = log.filter((e) => e.type === 'income');
    expect(incomeEvents.length).toBe(2);
  });

  test('buy spawns a unit at the owned base and deducts cost', () => {
    const baseHex = { q: 0, r: 0 };
    const map = makeMapWithBases(
      { '0,0': 'base', '1,0': 'plains' },
      [{ hex: baseHex, faction: 0 }],
      0,
    );
    const s = state([], map, { 0: 200, 1: 0 });
    const { newState, log } = resolveRound(
      s,
      [{ kind: 'buy', baseHex, unitTypeKey: 'infantry' }],
      [],
      unitTypes,
    );
    // Infantry costs 75 → credits 200 - 75 = 125
    expect(newState.credits[0]).toBe(125);
    const spawned = Object.values(newState.units);
    expect(spawned.length).toBe(1);
    expect(spawned[0]!.faction).toBe(0);
    expect(spawned[0]!.type).toBe('infantry');
    expect(spawned[0]!.hex).toEqual(baseHex);
    expect(spawned[0]!.count).toBe(10);
    const evt = log.find((e) => e.type === 'unit-spawned');
    expect(evt).toBeDefined();
  });

  test('buy at base owned by another faction fizzles', () => {
    const baseHex = { q: 0, r: 0 };
    const map = makeMapWithBases(
      { '0,0': 'base' },
      [{ hex: baseHex, faction: 1 }],
      0,
    );
    const s = state([], map, { 0: 500, 1: 0 });
    const { newState, log } = resolveRound(
      s,
      [{ kind: 'buy', baseHex, unitTypeKey: 'infantry' }],
      [],
      unitTypes,
    );
    expect(newState.credits[0]).toBe(500);
    expect(Object.values(newState.units).length).toBe(0);
    expect(log.some((e) => e.type === 'buy-fizzled')).toBe(true);
  });

  test('buy fizzles when insufficient credits', () => {
    const baseHex = { q: 0, r: 0 };
    const map = makeMapWithBases(
      { '0,0': 'base' },
      [{ hex: baseHex, faction: 0 }],
      0,
    );
    const s = state([], map, { 0: 10, 1: 0 }); // < 75 (infantry cost)
    const { newState, log } = resolveRound(
      s,
      [{ kind: 'buy', baseHex, unitTypeKey: 'infantry' }],
      [],
      unitTypes,
    );
    expect(newState.credits[0]).toBe(10);
    expect(Object.values(newState.units).length).toBe(0);
    expect(log.some((e) => e.type === 'buy-fizzled')).toBe(true);
  });

  test('buy fizzles when base hex is occupied at end of resolver', () => {
    const baseHex = { q: 0, r: 0 };
    const map = makeMapWithBases(
      { '0,0': 'base', '1,0': 'plains' },
      [{ hex: baseHex, faction: 0 }],
      0,
    );
    const sitter = unit('sitter', 'infantry', 0, baseHex);
    const s = state([sitter], map, { 0: 500, 1: 0 });
    const { newState, log } = resolveRound(
      s,
      [{ kind: 'buy', baseHex, unitTypeKey: 'infantry' }],
      [],
      unitTypes,
    );
    expect(newState.credits[0]).toBe(500);
    // Only the sitter — no spawn
    expect(Object.keys(newState.units).length).toBe(1);
    expect(log.some((e) => e.type === 'buy-fizzled')).toBe(true);
  });

  test('income arrives BEFORE round increment so next round planner sees it', () => {
    const baseHex = { q: 0, r: 0 };
    const map = makeMapWithBases(
      { '0,0': 'base' },
      [{ hex: baseHex, faction: 0 }],
      75, // exactly one infantry's cost
    );
    const s = state([], map, { 0: 0, 1: 0 });
    // Cannot buy on round 1 (zero credits), but can next round
    const { newState } = resolveRound(s, [], [], unitTypes);
    expect(newState.credits[0]).toBe(75);
  });

  test('determinism with economy: same input → same output', () => {
    const baseHex = { q: 0, r: 0 };
    const map = makeMapWithBases(
      { '0,0': 'base', '1,0': 'plains' },
      [{ hex: baseHex, faction: 0 }],
      100,
    );
    const s = state([], map, { 0: 200, 1: 200 });
    const orders0 = [
      { kind: 'buy' as const, baseHex, unitTypeKey: 'infantry' },
    ];
    const r1 = resolveRound(s, orders0, [], unitTypes);
    const r2 = resolveRound(s, orders0, [], unitTypes);
    expect(JSON.stringify(r1.log)).toBe(JSON.stringify(r2.log));
    expect(r1.newState.credits).toEqual(r2.newState.credits);
  });
});
