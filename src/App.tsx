import { useEffect, useMemo } from 'react';
import { DEFAULT_MAP_ID } from './io/maps.ts';
import { useStore } from './state/store.ts';
import { Board } from './ui/Board.tsx';
import { Hud } from './ui/Hud.tsx';
import { OrderPanel } from './ui/OrderPanel.tsx';
import { Handoff } from './ui/Handoff.tsx';
import { Replay } from './ui/Replay.tsx';
import { WinBanner } from './ui/WinBanner.tsx';
import { PwaToasts } from './ui/PwaToasts.tsx';
import { findPath, reachableHexes } from './core/pathing.ts';
import { distance, key as hexKey } from './core/hex.ts';
import { visibleHexesFor } from './core/fog.ts';
import type { Hex } from './core/types.ts';

export function App() {
  const game = useStore((s) => s.game);
  const unitTypes = useStore((s) => s.unitTypes);
  const startGameByMapId = useStore((s) => s.startGameByMapId);
  const selectedUnitId = useStore((s) => s.selectedUnitId);
  const selectedBaseHex = useStore((s) => s.selectedBaseHex);
  const selectUnit = useStore((s) => s.selectUnit);
  const selectBase = useStore((s) => s.selectBase);
  const queueOrder = useStore((s) => s.queueOrder);
  const handoffStage = useStore((s) => s.handoffStage);
  const finishReplay = useStore((s) => s.finishReplay);
  const newGame = useStore((s) => s.newGame);
  const discoveredByFaction = useStore((s) => s.discovered);

  useEffect(() => {
    if (!game) startGameByMapId(DEFAULT_MAP_ID);
  }, [game, startGameByMapId]);

  // ── Derived state for highlights ─────────────────────────────────────────
  const planner = game?.activePlanner ?? null;
  const selectedUnit =
    game && selectedUnitId ? game.units[selectedUnitId] ?? null : null;
  const selectedUnitType = selectedUnit ? unitTypes[selectedUnit.type] ?? null : null;

  const queuedOrders =
    game && planner !== null ? game.pendingOrders[planner] : [];
  const queuedMoveForSelected = queuedOrders.find(
    (o) => o.kind === 'move' && o.unitId === selectedUnitId,
  );
  const queuedAttackForSelected = queuedOrders.find(
    (o) => o.kind === 'attack' && o.unitId === selectedUnitId,
  );
  // Path arrow per queued move for the active planner. We derive from the
  // pendingOrders list (not the selected unit) so the arrow stays on screen
  // after queueing — selectUnit(null) fires after queueOrder, which used to
  // wipe the visualisation until the user re-selected.
  const plannedPaths: Hex[][] = useMemo(() => {
    if (!game || planner === null) return [];
    const out: Hex[][] = [];
    for (const order of game.pendingOrders[planner]) {
      if (order.kind !== 'move') continue;
      const unit = game.units[order.unitId];
      if (!unit) continue;
      out.push([unit.hex, ...order.path]);
    }
    return out;
  }, [game, planner]);

  const plannedAttack =
    queuedAttackForSelected && queuedAttackForSelected.kind === 'attack'
      ? queuedAttackForSelected.targetHex
      : null;

  // Effective attacking position = the selected unit's queued move destination
  // if any, else its current hex.
  const effectiveAttackPos: Hex | null = (() => {
    if (!selectedUnit) return null;
    if (queuedMoveForSelected && queuedMoveForSelected.kind === 'move') {
      const path = queuedMoveForSelected.path;
      return path[path.length - 1] ?? selectedUnit.hex;
    }
    return selectedUnit.hex;
  })();

  const reachable = useMemo(() => {
    if (!game || !selectedUnit || !selectedUnitType || planner === null) return new Set<string>();
    if (queuedMoveForSelected) return new Set<string>(); // hide range once a move is queued
    const m = reachableHexes(game.map, game.units, selectedUnit.hex, selectedUnitType, planner);
    return new Set<string>(m.keys());
  }, [game, selectedUnit, selectedUnitType, planner, queuedMoveForSelected]);

  const currentVisible = useMemo(() => {
    if (!game || planner === null) return new Set<string>();
    return visibleHexesFor(game, planner, unitTypes);
  }, [game, planner, unitTypes]);

  const attackable = useMemo(() => {
    if (!game || !selectedUnit || !selectedUnitType || !effectiveAttackPos || planner === null)
      return new Set<string>();
    const out = new Set<string>();
    for (const u of Object.values(game.units)) {
      if (u.faction === planner) continue;
      const k = hexKey(u.hex);
      if (!currentVisible.has(k)) continue;
      const d = distance(effectiveAttackPos, u.hex);
      if (d < selectedUnitType.minRange || d > selectedUnitType.maxRange) continue;
      // Verify attacker can engage this armor type
      const defType = unitTypes[u.type];
      if (!defType) continue;
      if (selectedUnitType.attackStrengths[defType.armorType] <= 0) continue;
      out.add(k);
    }
    return out;
  }, [game, selectedUnit, selectedUnitType, effectiveAttackPos, planner, unitTypes, currentVisible]);

  // ── Tap handling ─────────────────────────────────────────────────────────
  function onTapHex(hex: Hex) {
    if (!game || planner === null || game.phase !== 'planning') return;
    const k = hexKey(hex);

    const unitHere = Object.values(game.units).find(
      (u) => u.hex.q === hex.q && u.hex.r === hex.r,
    );
    const baseHere = game.map.startingBases.find(
      (b) => b.hex.q === hex.q && b.hex.r === hex.r,
    );
    const isOwnEmptyBase = baseHere?.faction === planner && !unitHere;

    // ─ No unit/base selected ─────────────────────────────────────────────
    if (!selectedUnit && !selectedBaseHex) {
      if (unitHere && unitHere.faction === planner) {
        selectUnit(unitHere.id);
      } else if (isOwnEmptyBase) {
        selectBase(hex);
      }
      return;
    }

    // ─ Base is selected (build mode) ─────────────────────────────────────
    if (selectedBaseHex) {
      // Tap same base → deselect
      if (selectedBaseHex.q === hex.q && selectedBaseHex.r === hex.r) {
        selectBase(null);
        return;
      }
      // Tap a friendly unit → switch to unit selection
      if (unitHere && unitHere.faction === planner) {
        selectUnit(unitHere.id);
        return;
      }
      // Tap another own empty base → switch to that base
      if (isOwnEmptyBase) {
        selectBase(hex);
        return;
      }
      // Anything else → deselect
      selectBase(null);
      return;
    }

    // ─ Unit is selected (existing flow) ──────────────────────────────────
    if (!selectedUnit) return;

    if (unitHere && unitHere.id === selectedUnit.id) {
      selectUnit(null);
      return;
    }

    if (unitHere && unitHere.faction === planner) {
      selectUnit(unitHere.id);
      return;
    }

    if (unitHere && unitHere.faction !== planner && attackable.has(k)) {
      queueOrder(planner, { kind: 'attack', unitId: selectedUnit.id, targetHex: hex });
      selectUnit(null);
      return;
    }

    if (!unitHere && reachable.has(k) && selectedUnitType) {
      const pathResult = findPath(
        game.map,
        game.units,
        selectedUnit.hex,
        hex,
        selectedUnitType,
        planner,
      );
      if (pathResult) {
        queueOrder(planner, {
          kind: 'move',
          unitId: selectedUnit.id,
          path: pathResult.path,
        });
        selectUnit(null);
      }
      return;
    }

    // Tap an own empty base while a unit is selected (and the base is not
    // reachable) → switch to build mode on that base.
    if (isOwnEmptyBase) {
      selectBase(hex);
      return;
    }
  }

  if (!game) {
    return (
      <main className="boot-shell">
        <span className="scaffold-mark">✦</span>
        <h1 style={{ marginTop: '0.5rem' }}>Brumachlys</h1>
        <p className="boot-tagline">Loading map…</p>
      </main>
    );
  }

  const pendingCount = planner !== null ? game.pendingOrders[planner].length : 0;
  const plannerCredits = planner !== null ? game.credits[planner] : undefined;

  // ── Replay phase: animate the resolver's event log ──────────────────────
  if (game.phase === 'replay') {
    return (
      <main className="game-shell">
        <Hud round={game.round} phase={game.phase} player={null} pendingCount={0} />
        <Replay
          oldState={game}
          log={game.log}
          unitTypes={unitTypes}
          onDone={finishReplay}
        />
      </main>
    );
  }

  return (
    <main className="game-shell">
      <Hud
        round={game.round}
        phase={game.phase}
        player={planner}
        pendingCount={pendingCount}
        credits={plannerCredits}
      />
      <Board
        state={game}
        unitTypes={unitTypes}
        perspective={planner}
        currentVisible={currentVisible}
        discovered={planner !== null ? discoveredByFaction[planner] : undefined}
        highlights={{
          selectedHex: selectedUnit?.hex ?? selectedBaseHex ?? null,
          reachableHexes: reachable,
          attackableHexes: attackable,
          plannedPaths,
          plannedAttack,
        }}
        onTapHex={onTapHex}
      />
      {planner !== null && (
        <OrderPanel
          selectedUnit={selectedUnit}
          unitType={selectedUnitType}
          selectedBaseHex={selectedBaseHex}
          pendingOrders={game.pendingOrders[planner]}
          faction={planner}
          credits={game.credits[planner]}
          unitTypes={unitTypes}
        />
      )}
      {handoffStage !== 'none' && <Handoff />}
      {game.phase === 'over' && (
        <WinBanner state={game} onNewGame={(mapId) => newGame(mapId)} />
      )}
      <PwaToasts installEligible={game.round > 1} />
    </main>
  );
}
