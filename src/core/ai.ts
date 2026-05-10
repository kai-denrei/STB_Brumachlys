// Stub-tier AI for solo / troubleshoot play. Pure function — no Math.random,
// no Date.now, no module state. Determinism contract holds.
//
// Behaviour: for each AI unit, find the nearest enemy and either
//   • attack it (when already in range with an effective armor match)
//   • path toward it as far as movement budget allows (entering the enemy
//     hex if the path lands there triggers Phase A.5 mêlée; ending one
//     short queues an attack from the adjacent hex if effective)
//   • if no direct path exists (e.g. blocked by terrain), pick the
//     reachable hex closest to the enemy
//
// "Always in attack mode": queues a `stance: aggressive` order if the unit
// has somehow drifted off aggressive. Aggressive is the spawn default so
// this is defensive rather than necessary — but explicit is cheap.

import { distance } from './hex.ts';
import { findPath, reachableHexes } from './pathing.ts';
import type { GameState, FactionId, UnitType, UnitInstance, Hex } from './types.ts';
import type { Order } from './orders.ts';

export function generateAIOrders(
  state: GameState,
  faction: FactionId,
  unitTypes: Record<string, UnitType>,
): Order[] {
  const orders: Order[] = [];
  const myUnits = Object.values(state.units).filter((u) => u.faction === faction && u.count > 0);
  const enemies = Object.values(state.units).filter((u) => u.faction !== faction && u.count > 0);

  // ── Movement / attack orders (per-unit) ───────────────────────────────────
  // Skip the per-unit loop if there are no enemies on the map — nothing to
  // path toward — but still fall through to the buy block so the AI keeps
  // spending credits on early-game empty maps.
  for (const u of enemies.length > 0 ? myUnits : []) {
    const ut = unitTypes[u.type];
    if (!ut) continue;

    if (u.stance !== 'aggressive') {
      orders.push({ kind: 'stance', unitId: u.id, stance: 'aggressive' });
    }

    const nearest = nearestEnemy(u, enemies);
    if (!nearest) continue;

    const enemyType = unitTypes[nearest.type];
    if (!enemyType) continue;
    const canEngageArmor = ut.attackStrengths[enemyType.armorType] > 0;
    const distNow = distance(u.hex, nearest.hex);

    // Already in attack range and able to damage this armor type → fire.
    if (canEngageArmor && distNow >= ut.minRange && distNow <= ut.maxRange) {
      orders.push({ kind: 'attack', unitId: u.id, targetHex: nearest.hex });
      continue;
    }

    // Try to path directly at the enemy. With mêlée stacking the enemy hex
    // itself is a valid destination (the resolver brawls them in Phase A.5).
    const direct = findPath(state.map, state.units, u.hex, nearest.hex, ut, faction);
    if (direct) {
      orders.push({ kind: 'move', unitId: u.id, path: direct.path });
      const finalHex = direct.path[direct.path.length - 1] ?? u.hex;
      const dFinal = distance(finalHex, nearest.hex);
      // If we land adjacent (and can engage), queue the ranged attack too.
      // If we land ON the enemy (distance 0), mêlée handles it — no attack.
      if (canEngageArmor && dFinal >= ut.minRange && dFinal <= ut.maxRange) {
        orders.push({ kind: 'attack', unitId: u.id, targetHex: nearest.hex });
      }
      continue;
    }

    // No direct path — pick the reachable hex that's closest to the enemy.
    const reach = reachableHexes(state.map, state.units, u.hex, ut, faction);
    let best: Hex | null = null;
    let bestDist = distNow;
    for (const k of reach.keys()) {
      const idx = k.indexOf(',');
      const h: Hex = { q: Number(k.slice(0, idx)), r: Number(k.slice(idx + 1)) };
      const d = distance(h, nearest.hex);
      if (d < bestDist) {
        bestDist = d;
        best = h;
      }
    }
    if (best) {
      const sub = findPath(state.map, state.units, u.hex, best, ut, faction);
      if (sub) {
        orders.push({ kind: 'move', unitId: u.id, path: sub.path });
        if (canEngageArmor && bestDist >= ut.minRange && bestDist <= ut.maxRange) {
          orders.push({ kind: 'attack', unitId: u.id, targetHex: nearest.hex });
        }
      }
    }
  }

  // ── Buy orders (one per empty owned base, while affordable) ───────────────
  // Predict post-move occupancy: a unit that's queuing a move vacates its
  // origin and lands at the move's destination. That lets the AI buy at
  // bases its own units are about to leave THIS round (the resolver's buy
  // phase runs after movement, so the base is empty by then).
  const occupiedAfterMove = new Set<string>();
  for (const u of myUnits) {
    const move = orders.find(
      (o): o is Extract<Order, { kind: 'move' }> => o.kind === 'move' && o.unitId === u.id,
    );
    if (move) {
      const dest = move.path[move.path.length - 1] ?? u.hex;
      occupiedAfterMove.add(`${dest.q},${dest.r}`);
    } else {
      occupiedAfterMove.add(`${u.hex.q},${u.hex.r}`);
    }
  }
  for (const e of enemies) {
    occupiedAfterMove.add(`${e.hex.q},${e.hex.r}`);
  }

  // Cheapest type the AI can build — keeps the production stream going.
  // Defaults to infantry (¢75) since with ¢100 starting / ¢base income the AI
  // can usually afford one per turn. Can pick smarter later.
  const candidates = Object.values(unitTypes)
    .filter((t) => t.cost > 0)
    .sort((a, b) => a.cost - b.cost);
  const cheapest = candidates[0];
  if (cheapest) {
    let credits = state.credits[faction] ?? 0;
    for (const base of state.map.startingBases) {
      if (base.faction !== faction) continue;
      const bk = `${base.hex.q},${base.hex.r}`;
      if (occupiedAfterMove.has(bk)) continue;
      if (credits < cheapest.cost) break;
      orders.push({ kind: 'buy', baseHex: base.hex, unitTypeKey: cheapest.key });
      credits -= cheapest.cost;
      // The bought unit will spawn AT the base after Phase E, so future
      // bases this round shouldn't try to buy at the same hex (they won't —
      // we don't repeat the same base). No need to mark base hex as
      // occupied; one base produces at most one unit per round.
    }
  }

  return orders;
}

function nearestEnemy(u: UnitInstance, enemies: UnitInstance[]): UnitInstance | null {
  let best: UnitInstance | null = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    const d = distance(u.hex, e.hex);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}
