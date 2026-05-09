// Zustand root store — sliced game / ui / replay.
// All UI state mutations live here. The pure resolver in core/ never touches it.

import { create } from 'zustand';
import { resolveRound } from '../core/resolver.ts';
import { visibleHexesFor } from '../core/fog.ts';
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
  hoveredHex: Hex | null;

  // Handoff / replay state
  handoffStage: 'none' | 'awaiting-tap' | 'awaiting-confirm';
  replayCursor: number;
  replaySpeed: ReplaySpeed;
  replayPaused: boolean;

  // Actions
  initGame: (mapXml: string, seed?: number, mapId?: string) => void;
  startGameByMapId: (mapId: string, seed?: number) => void;
  selectUnit: (id: string | null) => void;
  setHover: (hex: Hex | null) => void;

  queueOrder: (faction: FactionId, order: Order) => void;
  removeOrderForUnit: (
    faction: FactionId,
    unitId: string,
    kind: Order['kind'],
  ) => void;
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
  hoveredHex: null,

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
    };
    set({
      game,
      currentMapId: mapId ?? null,
      initialUnitsSnapshot: structuredClone(units),
      discovered: seedDiscovered(game, get().unitTypes),
      selectedUnitId: null,
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

  selectUnit: (id) => set({ selectedUnitId: id }),
  setHover: (hex) => set({ hoveredHex: hex }),

  // ── Order queue ─────────────────────────────────────────────────────────
  queueOrder: (faction, order) => {
    const game = get().game;
    if (!game) return;
    const list = game.pendingOrders[faction].filter(
      (o) => !(o.unitId === order.unitId && o.kind === order.kind),
    );
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
      (o) => !(o.unitId === unitId && o.kind === kind),
    );
    set({
      game: {
        ...game,
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
      (o) => !(o.unitId === unitId && o.kind === 'stance'),
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
      // P1 done → handoff to P2
      set({
        handoffStage: 'awaiting-tap',
        selectedUnitId: null,
      });
    } else if (game.activePlanner === 1) {
      // Both committed → resolve
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
    };
    set({
      game,
      discovered: seedDiscovered(game, get().unitTypes),
      selectedUnitId: null,
      hoveredHex: null,
      handoffStage: 'none',
      replayCursor: 0,
      replayPaused: true,
    });
  },
}));
