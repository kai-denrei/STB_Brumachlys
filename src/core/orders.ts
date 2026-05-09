// Order types and validation predicates.
// Orders are immutable. One move + one attack + one stance per unit per round.

import type { Hex, Stance, GameState } from './types.ts';

export type Order =
  | { kind: 'move'; unitId: string; path: Hex[] } // destination hexes only, not start
  | { kind: 'attack'; unitId: string; targetHex: Hex }
  | { kind: 'stance'; unitId: string; stance: Stance }
  // 'buy' is faction-implicit (lives in pendingOrders[faction]). baseHex is
  // the dedup key (one buy per base per round). `unitId` is optional: when
  // present (production flow), the store has already pre-spawned the unit at
  // queue time and deducted credits, so the resolver detects an existing
  // unit at that ID and skips the spawn but still emits a `unit-spawned`
  // event for replay-log consistency. When omitted (test fixtures and any
  // legacy/synthetic paths), the resolver generates the ID and applies the
  // full spawn at end-of-round.
  | { kind: 'buy'; baseHex: Hex; unitTypeKey: string; unitId?: string };

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

// TODO(phase-7): full validation per spec §4.2.
// - move: path reachable given movement budget + terrain costs (assume plains for fogged tiles)
// - attack: target hex contains visible enemy AND in range
// - stance: always valid
// Resolver re-checks at execution time; this is the order-entry gate.
export function validateOrder(_order: Order, _state: GameState, _byFaction: 0 | 1): ValidationResult {
  throw new Error('TODO(phase-7): validateOrder');
}
