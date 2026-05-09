// The deterministic resolver. Pure function.
//
// Phase A — Movement: every queued `move` order processed in init order.
//   Conflict rules:
//     • pass-through friendly hex allowed mid-path; cannot land on a friendly
//     • enemy hexes are valid destinations — entering one terminates the
//       path there, and the resulting stack is resolved in Phase A.5
//
// Phase A.5 — Mêlée: any hex with units of more than one faction triggers
//   a brawl. Units take alternating strikes (attacker = highest-init, target
//   = highest-init enemy on that hex) using the standard combat math without
//   a range gate. Loops until only one faction remains, or until both sides
//   deal zero damage on a strike (mutual-immunity stalemate, e.g. a ground
//   unit stacked with a unit it can't damage and vice versa).
//
// Phase B — Combat: queued attacks + aggressive auto-attacks, in init order.
//   Counter-attack happens within attacker's slot (§3.3).
//   Stance semantics per DECISIONS.md §B.13:
//     • aggressive   → fires queued attack, else auto-attacks closest enemy in range; counters
//     • defensive    → fires queued attack only (no auto); counters
//     • hold-fire    → no offensive fire; no counter (silent)

import { distance, key as hexKey } from './hex.ts';
import { initTieKey } from './rng.ts';
import {
  attackDamage,
  battleExchange,
  gangUpBonus,
} from './combat.ts';
import type {
  GameState,
  ResolutionEvent,
  UnitInstance,
  UnitType,
  Hex,
  TerrainKey,
  FactionId,
} from './types.ts';
import type { Order } from './orders.ts';

export type ResolveResult = {
  newState: GameState;
  log: ResolutionEvent[];
};

export function resolveRound(
  state: GameState,
  ordersP1: Order[],
  ordersP2: Order[],
  unitTypes: Record<string, UnitType>,
): ResolveResult {
  const next = cloneState(state);
  const log: ResolutionEvent[] = [];
  const allOrders: Order[] = [...ordersP1, ...ordersP2];

  // ── 1. Stance changes apply at the very start of the round ───────────────
  for (const o of allOrders) {
    if (o.kind !== 'stance') continue;
    const u = next.units[o.unitId];
    if (!u) continue;
    u.stance = o.stance;
    log.push({ type: 'stance', unitId: u.id, stance: o.stance });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  const round = next.round;

  const initRank = (u: UnitInstance): [number, number] => {
    const ut = unitTypes[u.type];
    return [ut?.initiative ?? 0, initTieKey(u.id, round)];
  };
  const cmpUnits = (a: UnitInstance, b: UnitInstance): number => {
    const [ai, ah] = initRank(a);
    const [bi, bh] = initRank(b);
    if (ai !== bi) return bi - ai; // init desc
    return ah - bh; // hash asc
  };

  const tileAt = (h: Hex): TerrainKey | undefined => next.map.tiles.get(hexKey(h));
  const blockerAt = (h: Hex, exceptId?: string): UnitInstance | undefined => {
    for (const u of Object.values(next.units)) {
      if (u.id === exceptId) continue;
      if (u.hex.q === h.q && u.hex.r === h.r) return u;
    }
    return undefined;
  };

  // ── 2. Phase A — Movement ────────────────────────────────────────────────
  const moveOrders: Array<{ unit: UnitInstance; order: Extract<Order, { kind: 'move' }> }> = [];
  for (const o of allOrders) {
    if (o.kind !== 'move') continue;
    const u = next.units[o.unitId];
    if (!u || u.count <= 0) continue;
    moveOrders.push({ unit: u, order: o });
  }
  moveOrders.sort((a, b) => cmpUnits(a.unit, b.unit));

  for (const { unit: u, order } of moveOrders) {
    const ut = unitTypes[u.type];
    if (!ut) continue;
    let budget = ut.movement;
    const pathTaken: Hex[] = [];

    for (const step of order.path) {
      const tile = tileAt(step);
      if (!tile) break;
      const stepCost = ut.terrainEffects[tile]?.movementCost ?? 99;
      if (stepCost >= 99) break;
      if (budget < stepCost) break;
      const blocker = blockerAt(step, u.id);
      // Enemy hex: enter it and stop (mêlée resolves in Phase A.5).
      // Friendly hex: pass through allowed; we still pay the cost and record the step.
      pathTaken.push(step);
      budget -= stepCost;
      if (blocker && blocker.faction !== u.faction) break;
    }

    // If we ended on a friendly hex (passed through and ran out / final), back up.
    while (pathTaken.length > 0) {
      const last = pathTaken[pathTaken.length - 1]!;
      const occ = blockerAt(last, u.id);
      if (occ && occ.faction === u.faction) {
        pathTaken.pop();
        continue;
      }
      break;
    }

    const finalPos: Hex = pathTaken.length > 0 ? pathTaken[pathTaken.length - 1]! : u.hex;
    const planned = order.path[order.path.length - 1];

    if (finalPos.q !== u.hex.q || finalPos.r !== u.hex.r) {
      log.push({
        type: 'move',
        unitId: u.id,
        from: u.hex,
        to: finalPos,
        pathTaken: pathTaken.slice(),
      });
      u.hex = finalPos;
    }
    if (planned && (finalPos.q !== planned.q || finalPos.r !== planned.r)) {
      log.push({ type: 'path-truncated', unitId: u.id, planned, actual: finalPos });
    }
  }

  // ── 2.5. Phase A.5 — Mêlée (stacked enemies brawl to last survivor) ──────
  // For each hex that contains units of more than one faction after movement,
  // run a brawl loop until only one faction remains or until both sides deal
  // zero damage on a strike (mutual-immunity stalemate). Strikes use the
  // standard combat math (no range gate, no gang-up) on the shared hex's
  // terrain. Counter fires from the same hex with the same terrain bonuses.
  const MELEE_MAX_STRIKES = 50; // hard safety cap; well above any realistic count
  const stackedHexKeys = new Set<string>();
  for (const u of Object.values(next.units)) {
    stackedHexKeys.add(hexKey(u.hex));
  }
  for (const hk of stackedHexKeys) {
    const here = (): UnitInstance[] =>
      Object.values(next.units).filter((u) => u.count > 0 && hexKey(u.hex) === hk);
    let units = here();
    if (units.length < 2) continue;
    const factions = new Set(units.map((u) => u.faction));
    if (factions.size < 2) continue;

    const tile = next.map.tiles.get(hk);
    if (!tile) continue;

    for (let strikes = 0; strikes < MELEE_MAX_STRIKES; strikes++) {
      units = here();
      if (units.length < 2) break;
      const facs = new Set(units.map((u) => u.faction));
      if (facs.size < 2) break;

      units.sort(cmpUnits);
      const att = units[0]!;
      const def = units.find((u) => u.faction !== att.faction);
      if (!def) break;

      const attType = unitTypes[att.type];
      const defType = unitTypes[def.type];
      if (!attType || !defType) break;

      const attDmg = attackDamage(att, def, attType, defType, tile, tile, 0);
      def.count = Math.max(0, def.count - attDmg);
      log.push({
        type: 'attack',
        attackerId: att.id,
        defenderId: def.id,
        damage: attDmg,
        bonusB: 0,
      });
      if (def.count <= 0) {
        log.push({ type: 'kill', unitId: def.id });
        delete next.units[def.id];
        continue; // re-evaluate stack
      }

      // Counter fires from the same hex; no range gate (we're stacked).
      const canCounter = defType.attackStrengths[attType.armorType] > 0;
      const counterDmg = canCounter
        ? attackDamage(def, att, defType, attType, tile, tile, 0)
        : 0;
      if (counterDmg > 0 || canCounter) {
        att.count = Math.max(0, att.count - counterDmg);
        log.push({
          type: 'counter',
          attackerId: def.id,
          defenderId: att.id,
          damage: counterDmg,
        });
        if (att.count <= 0) {
          log.push({ type: 'kill', unitId: att.id });
          delete next.units[att.id];
          continue;
        }
      }

      // Mutual-immunity stalemate: neither side dealt damage this strike.
      // Leave both alive, exit the brawl on this hex.
      if (attDmg === 0 && counterDmg === 0) break;
    }
  }

  // ── 3. Phase B — Combat ──────────────────────────────────────────────────
  type FireAction = {
    unit: UnitInstance;
    queuedTargetHex: Hex | null; // null means auto-target at fire time
  };
  const fireActions: FireAction[] = [];
  for (const u of Object.values(next.units)) {
    if (u.count <= 0) continue;
    if (u.stance === 'hold-fire') continue;
    const queued = allOrders.find(
      (o): o is Extract<Order, { kind: 'attack' }> => o.kind === 'attack' && o.unitId === u.id,
    );
    if (queued) {
      fireActions.push({ unit: u, queuedTargetHex: queued.targetHex });
    } else if (u.stance === 'aggressive') {
      fireActions.push({ unit: u, queuedTargetHex: null });
    }
  }
  fireActions.sort((a, b) => cmpUnits(a.unit, b.unit));

  for (const action of fireActions) {
    const att = next.units[action.unit.id];
    if (!att || att.count <= 0) continue;

    // Resolve target at fire time
    let target: UnitInstance | null = null;
    if (action.queuedTargetHex) {
      const found = blockerAt(action.queuedTargetHex, att.id);
      if (found && found.faction !== att.faction) target = found;
    } else {
      target = pickAutoTarget(att, next, unitTypes, round);
    }

    if (!target || target.count <= 0) {
      // Queued attacks at an empty/dead target log a fizzle.
      // Auto-attacks with no available target skip silently (no event).
      if (action.queuedTargetHex) {
        log.push({
          type: 'lost-target',
          attackerId: att.id,
          targetHex: action.queuedTargetHex,
        });
      }
      continue;
    }

    const attType = unitTypes[att.type];
    const defType = unitTypes[target.type];
    if (!attType || !defType) continue;

    const dist = distance(att.hex, target.hex);
    if (dist < attType.minRange || dist > attType.maxRange) {
      log.push({ type: 'lost-target', attackerId: att.id, targetHex: target.hex });
      continue;
    }

    const attTerrain = tileAt(att.hex);
    const defTerrain = tileAt(target.hex);
    if (!attTerrain || !defTerrain) continue;

    const B = gangUpBonus(att.hex, target.hex, target.attackedFromHexes);

    const allowCounter = target.stance !== 'hold-fire';
    let attackerDamageDealt: number;
    let defenderCounterDealt: number;
    let counterFired: boolean;
    if (allowCounter) {
      const r = battleExchange(att, target, attType, defType, attTerrain, defTerrain, B);
      attackerDamageDealt = r.attackerDamageDealt;
      defenderCounterDealt = r.defenderCounterDealt;
      counterFired = r.counterFired;
      att.count = r.attackerCount;
      target.count = r.defenderCount;
    } else {
      attackerDamageDealt = attackDamage(
        att,
        target,
        attType,
        defType,
        attTerrain,
        defTerrain,
        B,
      );
      defenderCounterDealt = 0;
      counterFired = false;
      target.count = Math.max(0, target.count - attackerDamageDealt);
    }

    target.attackedFromHexes.push({ q: att.hex.q, r: att.hex.r });

    log.push({
      type: 'attack',
      attackerId: att.id,
      defenderId: target.id,
      damage: attackerDamageDealt,
      bonusB: B,
    });
    if (counterFired) {
      log.push({
        type: 'counter',
        attackerId: target.id,
        defenderId: att.id,
        damage: defenderCounterDealt,
      });
    }
    if (target.count <= 0) {
      log.push({ type: 'kill', unitId: target.id });
      delete next.units[target.id];
    }
    if (att.count <= 0) {
      log.push({ type: 'kill', unitId: att.id });
      delete next.units[att.id];
    }
  }

  // ── 4. Phase E — Economy ─────────────────────────────────────────────────
  // Buys first (so the player spends THIS round's pre-existing credits),
  // then per-base income. Result: next round's planner sees leftover + income.
  const factionList: FactionId[] = [0, 1];
  for (const f of factionList) {
    const orders = f === 0 ? ordersP1 : ordersP2;
    for (const o of orders) {
      if (o.kind !== 'buy') continue;
      const ut = unitTypes[o.unitTypeKey];
      if (!ut) {
        log.push({
          type: 'buy-fizzled',
          faction: f,
          baseHex: o.baseHex,
          unitTypeKey: o.unitTypeKey,
          reason: 'unknown unit type',
        });
        continue;
      }
      const base = next.map.startingBases.find(
        (b) => b.hex.q === o.baseHex.q && b.hex.r === o.baseHex.r,
      );
      if (!base || base.faction !== f) {
        log.push({
          type: 'buy-fizzled',
          faction: f,
          baseHex: o.baseHex,
          unitTypeKey: o.unitTypeKey,
          reason: 'base not owned',
        });
        continue;
      }
      const occupant = Object.values(next.units).find(
        (u) => u.hex.q === o.baseHex.q && u.hex.r === o.baseHex.r,
      );
      if (occupant) {
        log.push({
          type: 'buy-fizzled',
          faction: f,
          baseHex: o.baseHex,
          unitTypeKey: o.unitTypeKey,
          reason: 'base occupied',
        });
        continue;
      }
      // Pre-spawned path (production): the order carries a `unitId` and the
      // store already mutated state at queue time. Skip the spawn + the
      // credit deduction (both already applied), but still log the event so
      // replay logic stays uniform.
      if (o.unitId && next.units[o.unitId]) {
        log.push({
          type: 'unit-spawned',
          unitId: o.unitId,
          faction: f,
          unitTypeKey: o.unitTypeKey,
          hex: { q: o.baseHex.q, r: o.baseHex.r },
          cost: ut.cost,
        });
        continue;
      }
      // Fresh-spawn path (test fixtures / legacy without pre-spawn). Validate
      // affordability since credits weren't deducted yet.
      if (next.credits[f] < ut.cost) {
        log.push({
          type: 'buy-fizzled',
          faction: f,
          baseHex: o.baseHex,
          unitTypeKey: o.unitTypeKey,
          reason: 'insufficient credits',
        });
        continue;
      }
      const newId = o.unitId ?? `u${f}-${next.unitIdCounter++}`;
      next.units[newId] = {
        id: newId,
        type: o.unitTypeKey,
        faction: f,
        hex: { q: o.baseHex.q, r: o.baseHex.r },
        count: 10,
        stance: 'aggressive',
        attackedFromHexes: [],
      };
      next.credits[f] -= ut.cost;
      log.push({
        type: 'unit-spawned',
        unitId: newId,
        faction: f,
        unitTypeKey: o.unitTypeKey,
        hex: { q: o.baseHex.q, r: o.baseHex.r },
        cost: ut.cost,
      });
    }
  }

  for (const f of factionList) {
    let owned = 0;
    for (const b of next.map.startingBases) {
      if (b.faction === f) owned++;
    }
    if (owned === 0) continue;
    const amount = owned * next.map.perBaseCredits;
    if (amount === 0) continue;
    next.credits[f] += amount;
    log.push({ type: 'income', faction: f, amount, bases: owned });
  }

  // ── 5. End-of-round bookkeeping ──────────────────────────────────────────
  for (const u of Object.values(next.units)) u.attackedFromHexes = [];

  next.round = state.round + 1;
  next.pendingOrders = { 0: [], 1: [] };
  next.phase = isGameOver(next) ? 'over' : 'planning';
  next.activePlanner = next.phase === 'over' ? null : 0;
  next.log = log;

  return { newState: next, log };
}

function isGameOver(s: GameState): boolean {
  let f0 = 0;
  let f1 = 0;
  for (const u of Object.values(s.units)) {
    if (u.faction === 0) f0++;
    else f1++;
  }
  return f0 === 0 || f1 === 0;
}

function pickAutoTarget(
  attacker: UnitInstance,
  state: GameState,
  unitTypes: Record<string, UnitType>,
  round: number,
): UnitInstance | null {
  const attType = unitTypes[attacker.type];
  if (!attType) return null;

  const candidates: UnitInstance[] = [];
  for (const u of Object.values(state.units)) {
    if (u.faction === attacker.faction) continue;
    if (u.count <= 0) continue;
    const dist = distance(attacker.hex, u.hex);
    if (dist < attType.minRange || dist > attType.maxRange) continue;
    if (attType.attackStrengths[unitTypes[u.type]?.armorType ?? 'personnel'] <= 0) continue;
    candidates.push(u);
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const dA = distance(attacker.hex, a.hex);
    const dB = distance(attacker.hex, b.hex);
    if (dA !== dB) return dA - dB; // closest first
    const iA = unitTypes[a.type]?.initiative ?? 0;
    const iB = unitTypes[b.type]?.initiative ?? 0;
    if (iA !== iB) return iB - iA; // highest initiative first
    return initTieKey(a.id, round) - initTieKey(b.id, round); // FNV-1a tiebreak
  });
  return candidates[0]!;
}

function cloneState(s: GameState): GameState {
  // structuredClone handles Map, plain objects, and arrays; deterministic copy.
  return structuredClone(s);
}

// Re-export type for FactionId-aware consumers.
export type { FactionId };
