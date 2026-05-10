// Zustand root store — sliced game / ui / replay.
// All UI state mutations live here. The pure resolver in core/ never touches it.

import { create } from 'zustand';
import { resolveRound } from '../core/resolver.ts';
import { visibleHexesFor } from '../core/fog.ts';
import { generateAIOrders } from '../core/ai.ts';
import { parseWeewarMap } from '../io/weewar-xml.ts';
import { loadUnits, loadTerrain } from '../io/data-loader.ts';
import { mapById } from '../io/maps.ts';
import type {
  GameState,
  GameMap,
  UnitInstance,
  UnitType,
  TerrainType,
  TerrainKey,
  FactionId,
  Hex,
  Stance,
} from '../core/types.ts';
import type { Order } from '../core/orders.ts';

type ReplaySpeed = 0.5 | 1 | 2 | 'instant';

type Store = {
  // Registries (read-only after load)
  unitTypes: Record<string, UnitType>;
  terrainTypes: Record<TerrainKey, TerrainType>;

  // Game state
  game: GameState | null;
  currentMapId: string | null;
  initialUnitsSnapshot: Record<string, UnitInstance> | null; // for new-game reset

  // Per-faction memory of explored hexes. UI-only — not part of core GameState
  // because it's a perspective concept, not a resolver input. Grows monotonically
  // each round from the union of visibleHexesFor() at end-of-round.
  discovered: Record<FactionId, Set<string>>;

  // UI state
  selectedUnitId: string | null;
  selectedBaseHex: Hex | null;
  hoveredHex: Hex | null;

  // Hover-info mode: when on, taps on hexes show stats in an InfoPanel
  // instead of queuing actions. Persists across rounds; toggled via HUD.
  hoverInfoMode: boolean;

  // Game mode: hot-seat (two human players, with handoff overlay) or
  // solo (P1 is a stub AI, no handoff, P0 commits → resolution).
  // Persists across newGame; takes effect at the next P0 commit.
  gameMode: 'hot-seat' | 'solo';

  // Handoff / replay state
  handoffStage: 'none' | 'awaiting-tap' | 'awaiting-confirm';
  replayCursor: number;
  replaySpeed: ReplaySpeed;
  replayPaused: boolean;

  // Actions
  initGame: (mapXml: string, seed?: number, mapId?: string) => void;
  startGameByMapId: (mapId: string, seed?: number) => void;
  selectUnit: (id: string | null) => void;
  selectBase: (hex: Hex | null) => void;
  setHover: (hex: Hex | null) => void;
  toggleHoverInfo: () => void;
  setGameMode: (mode: 'hot-seat' | 'solo') => void;

  queueOrder: (faction: FactionId, order: Order) => void;
  removeOrderForUnit: (
    faction: FactionId,
    unitId: string,
    kind: Order['kind'],
  ) => void;
  removeBuyAt: (faction: FactionId, baseHex: Hex) => void;
  cycleStance: (unitId: string) => void;

  commitOrders: () => void;       // P1 commits → starts handoff
  startHandoffConfirm: () => void; // first tap on handoff overlay
  resolveHandoff: () => void;      // second tap: P2 begins planning OR resolve if both committed
  resolveAndReplay: () => void;    // both committed → run resolver, enter replay phase

  // Replay controls
  setReplaySpeed: (s: ReplaySpeed) => void;
  toggleReplayPause: () => void;
  advanceReplay: (delta: number) => void;
  finishReplay: () => void;        // skip to end and enter next round's planning
  newGame: (mapId?: string) => void; // reset to round 1 with the same or specified map
};

// ── Helpers ────────────────────────────────────────────────────────────────
function buildInitialUnits(map: GameMap): Record<string, UnitInstance> {
  const out: Record<string, UnitInstance> = {};
  let idx = 0;
  for (const su of map.startingUnits) {
    const id = `u${su.faction}-${idx++}`;
    out[id] = {
      id,
      type: su.unitTypeKey,
      faction: su.faction,
      hex: { q: su.hex.q, r: su.hex.r },
      count: 10,
      stance: 'aggressive',
      attackedFromHexes: [],
    };
  }
  return out;
}

function emptyOrders(): Record<FactionId, Order[]> {
  return { 0: [], 1: [] };
}

function seedDiscovered(
  state: GameState,
  unitTypes: Record<string, UnitType>,
): Record<FactionId, Set<string>> {
  return {
    0: visibleHexesFor(state, 0, unitTypes),
    1: visibleHexesFor(state, 1, unitTypes),
  };
}

function unionDiscovered(
  prev: Record<FactionId, Set<string>>,
  state: GameState,
  unitTypes: Record<string, UnitType>,
): Record<FactionId, Set<string>> {
  const next: Record<FactionId, Set<string>> = { 0: new Set(prev[0]), 1: new Set(prev[1]) };
  for (const f of [0, 1] as const) {
    for (const k of visibleHexesFor(state, f, unitTypes)) next[f].add(k);
  }
  return next;
}

const STANCE_CYCLE: Record<Stance, Stance> = {
  aggressive: 'defensive',
  defensive: 'hold-fire',
  'hold-fire': 'aggressive',
};

// ── Store ──────────────────────────────────────────────────────────────────
export const useStore = create<Store>((set, get) => ({
  unitTypes: loadUnits(),
  terrainTypes: loadTerrain(),

  game: null,
  currentMapId: null,
  initialUnitsSnapshot: null,
  discovered: { 0: new Set(), 1: new Set() },

  selectedUnitId: null,
  selectedBaseHex: null,
  hoveredHex: null,
  hoverInfoMode: false,
  gameMode: 'hot-seat',

  handoffStage: 'none',
  replayCursor: 0,
  replaySpeed: 1,
  replayPaused: true,

  // ── Init ────────────────────────────────────────────────────────────────
  initGame: (mapXml, seed = 1, mapId = null as string | null as unknown as string) => {
    const map = parseWeewarMap(mapXml);
    const units = buildInitialUnits(map);
    const game: GameState = {
      round: 1,
      phase: 'planning',
      activePlanner: 0,
      map,
      units,
      pendingOrders: emptyOrders(),
      rngSeed: seed,
      log: [],
      credits: { 0: map.initialCredits, 1: map.initialCredits },
      // Start the spawn counter past any starting-unit IDs (`u0-0`, `u1-1`, …)
      // to prevent collisions when bought units are added.
      unitIdCounter: Object.keys(units).length + 100,
    };
    set({
      game,
      currentMapId: mapId ?? null,
      initialUnitsSnapshot: structuredClone(units),
      discovered: seedDiscovered(game, get().unitTypes),
      selectedUnitId: null,
      selectedBaseHex: null,
      hoveredHex: null,
      handoffStage: 'none',
      replayCursor: 0,
      replayPaused: true,
    });
  },

  startGameByMapId: (mapId, seed = 1) => {
    const entry = mapById(mapId);
    if (!entry) {
      console.warn(`startGameByMapId: unknown map "${mapId}"`);
      return;
    }
    get().initGame(entry.xml, seed, mapId);
  },

  selectUnit: (id) => set({ selectedUnitId: id, selectedBaseHex: null }),
  selectBase: (hex) => set({ selectedBaseHex: hex, selectedUnitId: null }),
  setHover: (hex) => set({ hoveredHex: hex }),
  toggleHoverInfo: () => set((s) => ({ hoverInfoMode: !s.hoverInfoMode, hoveredHex: null })),
  setGameMode: (mode) => set({ gameMode: mode }),

  // ── Order queue ─────────────────────────────────────────────────────────
  queueOrder: (faction, order) => {
    const game = get().game;
    if (!game) return;

    // Buy: pre-spawn the unit and deduct credits at queue time so the player
    // sees the new unit immediately. The resolver still processes the order
    // at end of round (idempotently — it skips the spawn when the unit is
    // already in state) so the replay log stays uniform.
    if (order.kind === 'buy') {
      const unitTypes = get().unitTypes;
      const ut = unitTypes[order.unitTypeKey];
      if (!ut) return;
      // Validate: own base, empty hex, sufficient credits.
      const base = game.map.startingBases.find(
        (b) => b.hex.q === order.baseHex.q && b.hex.r === order.baseHex.r,
      );
      if (!base || base.faction !== faction) return;
      const occupant = Object.values(game.units).find(
        (u) => u.hex.q === order.baseHex.q && u.hex.r === order.baseHex.r,
      );
      if (occupant) return;
      if (game.credits[faction] < ut.cost) return;

      const newId = `u${faction}-${game.unitIdCounter}`;
      const newUnit: UnitInstance = {
        id: newId,
        type: order.unitTypeKey,
        faction,
        hex: { q: order.baseHex.q, r: order.baseHex.r },
        count: 10,
        stance: 'aggressive',
        attackedFromHexes: [],
      };
      // Dedup: at most one buy per base. Replacing a queued buy at the same
      // base also rolls back its pre-spawned unit + refund.
      const existing = game.pendingOrders[faction].find(
        (o) =>
          o.kind === 'buy' &&
          o.baseHex.q === order.baseHex.q &&
          o.baseHex.r === order.baseHex.r,
      ) as Extract<Order, { kind: 'buy' }> | undefined;

      const filteredUnits = { ...game.units };
      let refundedCredits = game.credits[faction];
      if (existing) {
        const prevUt = unitTypes[existing.unitTypeKey];
        if (existing.unitId && filteredUnits[existing.unitId]) {
          delete filteredUnits[existing.unitId];
        }
        if (prevUt) refundedCredits += prevUt.cost;
      }
      const list = game.pendingOrders[faction].filter(
        (o) =>
          !(
            o.kind === 'buy' &&
            o.baseHex.q === order.baseHex.q &&
            o.baseHex.r === order.baseHex.r
          ),
      );
      list.push({ ...order, unitId: newId });

      set({
        game: {
          ...game,
          units: { ...filteredUnits, [newId]: newUnit },
          credits: { ...game.credits, [faction]: refundedCredits - ut.cost },
          unitIdCounter: game.unitIdCounter + 1,
          pendingOrders: { ...game.pendingOrders, [faction]: list },
        },
      });
      return;
    }

    // Non-buy orders: dedup by (unitId, kind), no state mutation beyond the queue.
    const list = game.pendingOrders[faction].filter((o) => {
      if (o.kind === 'buy') return true;
      return !(o.unitId === order.unitId && o.kind === order.kind);
    });
    list.push(order);
    set({
      game: {
        ...game,
        pendingOrders: { ...game.pendingOrders, [faction]: list },
      },
    });
  },

  removeOrderForUnit: (faction, unitId, kind) => {
    const game = get().game;
    if (!game) return;
    const list = game.pendingOrders[faction].filter(
      (o) => o.kind === 'buy' || !(o.unitId === unitId && o.kind === kind),
    );
    set({
      game: {
        ...game,
        pendingOrders: { ...game.pendingOrders, [faction]: list },
      },
    });
  },

  removeBuyAt: (faction, baseHex) => {
    const game = get().game;
    if (!game) return;
    // Find the buy order at this base; un-spawn the unit and refund credits.
    const buy = game.pendingOrders[faction].find(
      (o) =>
        o.kind === 'buy' && o.baseHex.q === baseHex.q && o.baseHex.r === baseHex.r,
    ) as Extract<Order, { kind: 'buy' }> | undefined;

    const list = game.pendingOrders[faction].filter(
      (o) =>
        !(o.kind === 'buy' && o.baseHex.q === baseHex.q && o.baseHex.r === baseHex.r),
    );

    let units = game.units;
    let credits = game.credits;
    if (buy) {
      const ut = get().unitTypes[buy.unitTypeKey];
      if (buy.unitId && game.units[buy.unitId]) {
        const { [buy.unitId]: _removed, ...rest } = game.units;
        units = rest;
      }
      if (ut) {
        credits = { ...game.credits, [faction]: game.credits[faction] + ut.cost };
      }
    }

    set({
      game: {
        ...game,
        units,
        credits,
        pendingOrders: { ...game.pendingOrders, [faction]: list },
      },
    });
  },

  cycleStance: (unitId) => {
    const game = get().game;
    if (!game) return;
    const u = game.units[unitId];
    if (!u) return;
    const nextStance = STANCE_CYCLE[u.stance];
    // Queue a stance order rather than mutating directly — applied in resolver.
    const faction = u.faction;
    const list = game.pendingOrders[faction].filter(
      (o) => !(o.kind === 'stance' && o.unitId === unitId),
    );
    list.push({ kind: 'stance', unitId, stance: nextStance });
    set({
      game: {
        ...game,
        pendingOrders: { ...game.pendingOrders, [faction]: list },
        // Also reflect the new stance in UI immediately for player feedback;
        // the resolver re-applies it deterministically next round.
        units: { ...game.units, [unitId]: { ...u, stance: nextStance } },
      },
    });
  },

  // ── Phase transitions ───────────────────────────────────────────────────
  commitOrders: () => {
    const game = get().game;
    if (!game) return;
    if (game.activePlanner === 0) {
      if (get().gameMode === 'solo') {
        // Solo: P0 done → AI plans for P1, then resolution. No handoff.
        const aiOrders = generateAIOrders(game, 1, get().unitTypes);
        set({
          game: {
            ...game,
            pendingOrders: { ...game.pendingOrders, 1: aiOrders },
            activePlanner: 1,
          },
          selectedUnitId: null,
          selectedBaseHex: null,
        });
        get().resolveAndReplay();
      } else {
        // Hot-seat: P0 done → handoff to P1
        set({
          handoffStage: 'awaiting-tap',
          selectedUnitId: null,
        });
      }
    } else if (game.activePlanner === 1) {
      // Both committed → resolve (hot-seat path; solo skips this branch)
      get().resolveAndReplay();
    }
  },

  startHandoffConfirm: () => set({ handoffStage: 'awaiting-confirm' }),

  resolveHandoff: () => {
    const game = get().game;
    if (!game) return;
    set({
      game: { ...game, activePlanner: 1, phase: 'planning' },
      handoffStage: 'none',
      selectedUnitId: null,
    });
  },

  resolveAndReplay: () => {
    const game = get().game;
    if (!game) return;
    const { newState, log } = resolveRound(
      game,
      game.pendingOrders[0],
      game.pendingOrders[1],
      get().unitTypes,
    );
    // Show resolution from old state with log; UI animates events one at a time.
    set({
      game: { ...game, phase: 'replay', log },
      // We stash newState alongside log for finishReplay to apply.
      __pendingResolution: newState,
      replayCursor: 0,
      replayPaused: false,
    } as unknown as Partial<Store>);
  },

  setReplaySpeed: (s) => set({ replaySpeed: s }),
  toggleReplayPause: () => set((s) => ({ replayPaused: !s.replayPaused })),

  advanceReplay: (delta) => {
    set((s) => ({ replayCursor: Math.max(0, s.replayCursor + delta) }));
  },

  finishReplay: () => {
    const game = get().game;
    if (!game) return;
    const pending = (get() as unknown as { __pendingResolution?: GameState })
      .__pendingResolution;
    if (!pending) return;
    // Memory grows from end-of-round positions: each faction's last visible
    // sweep lands in `discovered` before we transition into the next planning.
    const grown = unionDiscovered(get().discovered, pending, get().unitTypes);
    set({
      game: pending,
      discovered: grown,
      replayCursor: 0,
      replayPaused: true,
      __pendingResolution: undefined,
    } as unknown as Partial<Store>);
  },

  newGame: (mapId) => {
    if (mapId) {
      get().startGameByMapId(mapId);
      return;
    }
    // Reuse the current map but reset units/round/orders.
    const cur = get().game;
    const snapshot = get().initialUnitsSnapshot;
    if (!cur || !snapshot) return;
    const game: GameState = {
      round: 1,
      phase: 'planning',
      activePlanner: 0,
      map: cur.map,
      units: structuredClone(snapshot),
      pendingOrders: emptyOrders(),
      rngSeed: 1,
      log: [],
      credits: { 0: cur.map.initialCredits, 1: cur.map.initialCredits },
      unitIdCounter: Object.keys(snapshot).length + 100,
    };
    set({
      game,
      discovered: seedDiscovered(game, get().unitTypes),
      selectedUnitId: null,
      selectedBaseHex: null,
      hoveredHex: null,
      handoffStage: 'none',
      replayCursor: 0,
      replayPaused: true,
    });
  },
}));
