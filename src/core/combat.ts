// Combat math. Pure functions. No module state, no Math.random.
// See BRUMACHLYS.md §3 for the formula and gang-up rules,
// and DECISIONS.md §B.1 (rounding) and §B.6 (integer counts).

import { adjacent, distance, opposite } from './hex.ts';
import type { Hex, UnitInstance, UnitType, TerrainKey } from './types.ts';

// All damage values route through this single rounding function so a future
// swap (e.g. to banker's rounding) is a one-line change.
export const roundDamage = (raw: number): number => Math.round(raw);

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export type GangUpClass = 'ranged' | 'opposite' | 'adjacent' | 'flanking';

// Classify a single prior-attacker hex relative to the current attacker and
// the defender. The four-way decision tree from §3.2:
//   • not adjacent to defender                       → ranged
//   • on the cube-line opposite current via defender → opposite
//   • adjacent to BOTH defender and current          → adjacent
//   • adjacent to defender only (and not opposite)   → flanking
export function classifyPriorAttack(
  currentAttackerHex: Hex,
  defenderHex: Hex,
  priorAttackerHex: Hex,
): GangUpClass {
  if (!adjacent(priorAttackerHex, defenderHex)) return 'ranged';
  if (opposite(currentAttackerHex, defenderHex, priorAttackerHex)) return 'opposite';
  if (adjacent(priorAttackerHex, currentAttackerHex)) return 'adjacent';
  return 'flanking';
}

const CLASS_WEIGHT: Record<GangUpClass, number> = {
  ranged: 1,
  adjacent: 1,
  flanking: 2,
  opposite: 3,
};

export function gangUpBonus(
  currentAttackerHex: Hex,
  defenderHex: Hex,
  priorAttackerHexes: Hex[],
): number {
  let total = 0;
  for (const prior of priorAttackerHexes) {
    total += CLASS_WEIGHT[classifyPriorAttack(currentAttackerHex, defenderHex, prior)];
  }
  return total;
}

// Headline formula from §3.1, with the §11.2 fixture clarification (DECISIONS §B.13)
// and the §B.16 minimum-damage floor:
//   p = clamp(0.5 + 0.05 * ((A + Ta) - (D + Td) + B), 0, 1)
//   raw = roundDamage(min(attackerCount, defenderCount) * p)
//   damage = (A > 0 && p > 0 && raw === 0) ? 1 : raw
//
// The "min" is canonical because the §3.1 formula text and the §11.2 worked
// example contradict each other; the example wins (third fixture: B=3, p=0.55,
// attacker count 10, defender count 6 → dmg 3 only holds with min). Thematic
// reading: the smaller count is the number of "engagements" in the duel.
//
// The floor (§B.16) prevents low-count defenders from becoming immortal. Without
// it, tank-10 vs infantry-1 yields min(10,1) * 0.45 = 0.45 → round 0 → defender
// never dies. With the floor, any valid attack (the attacker CAN damage that
// armor type, and p is nonzero) chips at least 1.
//
// A is looked up by the *defender's* armor type in the *attacker's* table.
// Ta is the attacker-type's terrain attack bonus on the attacker's terrain.
// Td is the defender-type's terrain armor bonus on the defender's terrain.
export function attackDamage(
  attacker: UnitInstance,
  defender: UnitInstance,
  attackerType: UnitType,
  defenderType: UnitType,
  attackerTerrain: TerrainKey,
  defenderTerrain: TerrainKey,
  bonusB: number,
): number {
  if (attacker.count <= 0 || defender.count <= 0) return 0;
  const A = attackerType.attackStrengths[defenderType.armorType];
  if (A <= 0) return 0; // cannot engage this armor type
  const D = defenderType.armor;
  const Ta = attackerType.terrainEffects[attackerTerrain]?.attackBonus ?? 0;
  const Td = defenderType.terrainEffects[defenderTerrain]?.armorBonus ?? 0;
  const p = clamp01(0.5 + 0.05 * ((A + Ta) - (D + Td) + bonusB));
  const engagements = Math.min(attacker.count, defender.count);
  const raw = roundDamage(engagements * p);
  // §B.16 minimum-damage floor: never round to 0 when the attacker can damage
  // this armor type and the formula gave any positive probability. Stops
  // weakened defenders becoming immortal stragglers.
  if (raw === 0 && p > 0) return 1;
  return raw;
}

export type ExchangeResult = {
  attackerCount: number;
  defenderCount: number;
  attackerDamageDealt: number;   // dmg attacker inflicted on defender
  defenderCounterDealt: number;  // dmg counter inflicted on attacker (0 if no counter)
  counterFired: boolean;
};

// Mutual exchange per §3.3:
//   1. attacker hits defender (with bonusB)
//   2. defender counters with B=0 if (a) in range and (b) can attack attacker's armor type
//   3. both damages applied against starting counts (one tick of mutual loss)
//   4. counts floor at 0
export function battleExchange(
  attacker: UnitInstance,
  defender: UnitInstance,
  attackerType: UnitType,
  defenderType: UnitType,
  attackerTerrain: TerrainKey,
  defenderTerrain: TerrainKey,
  bonusB: number,
): ExchangeResult {
  const attackerDamageDealt = attackDamage(
    attacker,
    defender,
    attackerType,
    defenderType,
    attackerTerrain,
    defenderTerrain,
    bonusB,
  );

  // Counter is gated on range AND ability to engage attacker's armor type.
  const dist = distance(attacker.hex, defender.hex);
  const inRange = dist >= defenderType.minRange && dist <= defenderType.maxRange;
  const canTarget = defenderType.attackStrengths[attackerType.armorType] > 0;
  const counterFired = inRange && canTarget && defender.count > 0;

  const defenderCounterDealt = counterFired
    ? attackDamage(
        defender,
        attacker,
        defenderType,
        attackerType,
        defenderTerrain,
        attackerTerrain,
        0, // counter has no gang-up
      )
    : 0;

  const attackerCount = Math.max(0, attacker.count - defenderCounterDealt);
  const defenderCount = Math.max(0, defender.count - attackerDamageDealt);

  return {
    attackerCount,
    defenderCount,
    attackerDamageDealt,
    defenderCounterDealt,
    counterFired,
  };
}
