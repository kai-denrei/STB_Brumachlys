import { describe, expect, test } from 'vitest';
import {
  attackDamage,
  battleExchange,
  classifyPriorAttack,
  gangUpBonus,
  roundDamage,
} from '../src/core/combat.ts';
import { loadUnits } from '../src/io/data-loader.ts';
import type { UnitInstance, UnitType, Hex } from '../src/core/types.ts';

const units = loadUnits();
const INF = units.infantry!;
const TNK = units.tank!;

function inst(
  id: string,
  type: 'infantry' | 'tank',
  faction: 0 | 1,
  hex: Hex,
  count = 10,
): UnitInstance {
  return {
    id,
    type,
    faction,
    hex,
    count,
    stance: 'aggressive',
    attackedFromHexes: [],
  };
}

describe('roundDamage (DECISIONS §B.1)', () => {
  test('Math.round half-up for non-negatives', () => {
    expect(roundDamage(4.5)).toBe(5);
    expect(roundDamage(4.4)).toBe(4);
    expect(roundDamage(0)).toBe(0);
    expect(roundDamage(2.5)).toBe(3); // half-up, NOT banker's
  });
});

describe('attackDamage — spec fixtures (§11.2)', () => {
  test('infantry(10) → tank(10), both plains, no gang-up → damage 4', () => {
    const att = inst('a', 'infantry', 0, { q: 0, r: 0 }, 10);
    const def = inst('d', 'tank', 1, { q: 1, r: 0 }, 10);
    expect(attackDamage(att, def, INF, TNK, 'plains', 'plains', 0)).toBe(4);
  });

  test('tank(10) counter → infantry(10), both plains, no gang-up → damage 5 (half-up)', () => {
    const att = inst('a', 'tank', 0, { q: 0, r: 0 }, 10);
    const def = inst('d', 'infantry', 1, { q: 1, r: 0 }, 10);
    expect(attackDamage(att, def, TNK, INF, 'plains', 'plains', 0)).toBe(5);
  });

  test('opposite gang-up: B=3, second hit on tank(6) → damage 3', () => {
    const att = inst('a', 'infantry', 0, { q: 1, r: 0 }, 10);
    const tank = inst('d', 'tank', 1, { q: 0, r: 0 }, 6); // already softened
    expect(attackDamage(att, tank, INF, TNK, 'plains', 'plains', 3)).toBe(3);
  });
});

describe('attackDamage — clamp + zero-attack edges', () => {
  test('p clamps to 1 when bonus is huge', () => {
    const att = inst('a', 'infantry', 0, { q: 0, r: 0 }, 10);
    const def = inst('d', 'tank', 1, { q: 1, r: 0 }, 10);
    expect(attackDamage(att, def, INF, TNK, 'plains', 'plains', 100)).toBe(10);
  });

  test('p clamps to 0 when penalty is huge', () => {
    const att = inst('a', 'infantry', 0, { q: 0, r: 0 }, 10);
    const def = inst('d', 'tank', 1, { q: 1, r: 0 }, 10);
    expect(attackDamage(att, def, INF, TNK, 'plains', 'plains', -100)).toBe(0);
  });

  test('attackStrength of 0 against armor type → damage 0 regardless of count', () => {
    // Infantry has attackStrengths.naval = 0. Build a synthetic naval defender.
    const naval: UnitType = {
      ...TNK,
      armorType: 'naval',
      key: 'frigate',
    };
    const att = inst('a', 'infantry', 0, { q: 0, r: 0 }, 10);
    const def = inst('d', 'tank', 1, { q: 1, r: 0 }, 10);
    expect(attackDamage(att, def, INF, naval, 'plains', 'plains', 0)).toBe(0);
  });

  test('attacker count of 0 produces 0 damage', () => {
    const att = inst('a', 'infantry', 0, { q: 0, r: 0 }, 0);
    const def = inst('d', 'tank', 1, { q: 1, r: 0 }, 10);
    expect(attackDamage(att, def, INF, TNK, 'plains', 'plains', 0)).toBe(0);
  });
});

describe('classifyPriorAttack (§3.2)', () => {
  // Defender at (1,0). Current attacker at (0,0) (west of defender).
  const def = { q: 1, r: 0 };
  const cur = { q: 0, r: 0 };

  test('prior not adjacent to defender → ranged', () => {
    const prior = { q: 5, r: 0 };
    expect(classifyPriorAttack(cur, def, prior)).toBe('ranged');
  });

  test('prior on the hex opposite current across defender → opposite', () => {
    const prior = { q: 2, r: 0 }; // east of defender, mirror of current
    expect(classifyPriorAttack(cur, def, prior)).toBe('opposite');
  });

  test('prior adjacent to defender AND adjacent to current → adjacent', () => {
    // Defender (1,0); current (0,0) is even-row neighbour (W).
    // (0,1) is adjacent to (0,0) (SE for even-row) and adjacent to (1,0) — yes for even-row.
    const prior = { q: 0, r: 1 };
    expect(classifyPriorAttack(cur, def, prior)).toBe('adjacent');
  });

  test('prior adjacent to defender but not current and not opposite → flanking', () => {
    // (1,1) is adjacent to (1,0) (SE for odd-row of (1,1)? r=1 odd, so SE means (1+1, 1-1)? wait neighbours of (1,1) for odd-r: NW(0,0), NE(1,0), W(0,1), E(2,1), SW(0,2), SE(1,2). So (1,1) adjacent to (1,0)?yes (NE).)
    // (1,1) adjacent to (0,0) (current)? Neighbours of (0,0) (even-r): NW(-1,-1), NE(0,-1), W(-1,0), E(1,0), SW(-1,1), SE(0,1). So (1,1) is NOT adjacent to (0,0).
    // Not opposite of (0,0) across (1,0).
    // → flanking.
    const prior = { q: 1, r: 1 };
    expect(classifyPriorAttack(cur, def, prior)).toBe('flanking');
  });
});

describe('gangUpBonus (§3.2 weighted sum)', () => {
  const def = { q: 1, r: 0 };
  const cur = { q: 0, r: 0 };

  test('no priors → 0', () => {
    expect(gangUpBonus(cur, def, [])).toBe(0);
  });

  test('one ranged prior → +1', () => {
    expect(gangUpBonus(cur, def, [{ q: 5, r: 0 }])).toBe(1);
  });

  test('one opposite prior → +3', () => {
    expect(gangUpBonus(cur, def, [{ q: 2, r: 0 }])).toBe(3);
  });

  test('one adjacent prior → +1', () => {
    expect(gangUpBonus(cur, def, [{ q: 0, r: 1 }])).toBe(1);
  });

  test('one flanking prior → +2', () => {
    expect(gangUpBonus(cur, def, [{ q: 1, r: 1 }])).toBe(2);
  });

  test('mixed priors sum correctly', () => {
    const priors = [
      { q: 5, r: 0 }, // ranged +1
      { q: 2, r: 0 }, // opposite +3
      { q: 1, r: 1 }, // flanking +2
    ];
    expect(gangUpBonus(cur, def, priors)).toBe(6);
  });
});

describe('battleExchange (§3.3)', () => {
  test('mutual loss applied against starting counts (one tick)', () => {
    // Infantry attacks tank, both plains, count 10 each, B=0.
    // attacker hit dmg = 4 (vs tank).
    // counter dmg = 5 (tank vs infantry, B=0).
    // Both applied: attacker.count = 10 - 5 = 5; defender.count = 10 - 4 = 6.
    const att = inst('a', 'infantry', 0, { q: 0, r: 0 }, 10);
    const def = inst('d', 'tank', 1, { q: 1, r: 0 }, 10);
    const result = battleExchange(att, def, INF, TNK, 'plains', 'plains', 0);
    expect(result.attackerCount).toBe(5);
    expect(result.defenderCount).toBe(6);
    expect(result.attackerDamageDealt).toBe(4);
    expect(result.defenderCounterDealt).toBe(5);
    expect(result.counterFired).toBe(true);
  });

  test('counter does not fire if defender out of range', () => {
    // Synthetic ranged defender with min/max range 0 (cannot counter at distance 1).
    const ranged: UnitType = { ...TNK, minRange: 2, maxRange: 3 };
    const att = inst('a', 'infantry', 0, { q: 0, r: 0 }, 10);
    const def = inst('d', 'tank', 1, { q: 1, r: 0 }, 10);
    const result = battleExchange(att, def, INF, ranged, 'plains', 'plains', 0);
    expect(result.counterFired).toBe(false);
    expect(result.defenderCounterDealt).toBe(0);
    expect(result.attackerCount).toBe(10); // attacker untouched
    expect(result.defenderCount).toBe(6);
  });

  test('counter does not fire if defender cannot attack attacker armor type', () => {
    // Defender with all attackStrengths = 0.
    const pacifist: UnitType = {
      ...TNK,
      attackStrengths: { personnel: 0, armored: 0, naval: 0, air: 0 },
    };
    const att = inst('a', 'infantry', 0, { q: 0, r: 0 }, 10);
    const def = inst('d', 'tank', 1, { q: 1, r: 0 }, 10);
    const result = battleExchange(att, def, INF, pacifist, 'plains', 'plains', 0);
    expect(result.counterFired).toBe(false);
    expect(result.attackerCount).toBe(10);
  });

  test('count cannot go below zero', () => {
    const att = inst('a', 'infantry', 0, { q: 0, r: 0 }, 1);
    const def = inst('d', 'tank', 1, { q: 1, r: 0 }, 1);
    const result = battleExchange(att, def, INF, TNK, 'plains', 'plains', 100);
    expect(result.attackerCount).toBeGreaterThanOrEqual(0);
    expect(result.defenderCount).toBeGreaterThanOrEqual(0);
  });
});
