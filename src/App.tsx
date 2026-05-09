import { useEffect, useMemo } from 'react';
import threeWaysXml from '../data/maps/three-ways.xml?raw';
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
  const initGame = useStore((s) => s.initGame);
  const selectedUnitId = useStore((s) => s.selectedUnitId);
  const selectUnit = useStore((s) => s.selectUnit);
  const queueOrder = useStore((s) => s.queueOrder);
  const handoffStage = useStore((s) => s.handoffStage);
  const finishReplay = useStore((s) => s.finishReplay);
  const newGame = useStore((s) => s.newGame);

  useEffect(() => {
    if (!game) initGame(threeWaysXml);
  }, [game, initGame]);

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
  const plannedDest =
    queuedMoveForSelected && queuedMoveForSelected.kind === 'move'
      ? queuedMoveForSelected.path[queuedMoveForSelected.path.length - 1] ?? null
      : null;
  const plannedAttack =
    queuedAttackForSelected && queuedAttackForSelected.kind === 'attack'
      ? queuedAttackForSelected.targetHex
      : null;

  // Effective attacking position = planned move dest if any, else current hex
  const effectiveAttackPos: Hex | null = selectedUnit
    ? plannedDest ?? selectedUnit.hex
    : null;

  const reachable = useMemo(() => {
    if (!game || !selectedUnit || !selectedUnitType || planner === null) return new Set<string>();
    if (queuedMoveForSelected) return new Set<string>(); // hide range once a move is queued
    const m = reachableHexes(game.map, game.units, selectedUnit.hex, selectedUnitType, planner);
    return new Set<string>(m.keys());
  }, [game, selectedUnit, selectedUnitType, planner, queuedMoveForSelected]);

  const attackable = useMemo(() => {
    if (!game || !selectedUnit || !selectedUnitType || !effectiveAttackPos || planner === null)
      return new Set<string>();
    const fog = visibleHexesFor(game, planner, unitTypes);
    const out = new Set<string>();
    for (const u of Object.values(game.units)) {
      if (u.faction === planner) continue;
      const k = hexKey(u.hex);
      if (!fog.has(k)) continue;
      const d = distance(effectiveAttackPos, u.hex);
      if (d < selectedUnitType.minRange || d > selectedUnitType.maxRange) continue;
      // Verify attacker can engage this armor type
      const defType = unitTypes[u.type];
      if (!defType) continue;
      if (selectedUnitType.attackStrengths[defType.armorType] <= 0) continue;
      out.add(k);
    }
    return out;
  }, [game, selectedUnit, selectedUnitType, effectiveAttackPos, planner, unitTypes]);

  // ── Tap handling ─────────────────────────────────────────────────────────
  function onTapHex(hex: Hex) {
    if (!game || planner === null || game.phase !== 'planning') return;
    const k = hexKey(hex);

    // Tap on a unit at this hex
    const unitHere = Object.values(game.units).find(
      (u) => u.hex.q === hex.q && u.hex.r === hex.r,
    );

    // No unit selected yet: tap a friendly unit to select
    if (!selectedUnit) {
      if (unitHere && unitHere.faction === planner) {
        selectUnit(unitHere.id);
      }
      return;
    }

    // Tap the same unit again → deselect
    if (unitHere && unitHere.id === selectedUnit.id) {
      selectUnit(null);
      return;
    }

    // Tap another friendly unit → switch selection
    if (unitHere && unitHere.faction === planner) {
      selectUnit(unitHere.id);
      return;
    }

    // Tap a visible enemy in attack range → queue attack
    if (unitHere && unitHere.faction !== planner && attackable.has(k)) {
      queueOrder(planner, { kind: 'attack', unitId: selectedUnit.id, targetHex: hex });
      selectUnit(null);
      return;
    }

    // Tap a reachable empty hex → queue move
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
      <Hud round={game.round} phase={game.phase} player={planner} pendingCount={pendingCount} />
      <Board
        state={game}
        unitTypes={unitTypes}
        perspective={planner}
        highlights={{
          selectedHex: selectedUnit?.hex ?? null,
          reachableHexes: reachable,
          attackableHexes: attackable,
          plannedDest,
          plannedAttack,
        }}
        onTapHex={onTapHex}
      />
      {planner !== null && (
        <OrderPanel
          selectedUnit={selectedUnit}
          unitType={selectedUnitType}
          pendingOrders={game.pendingOrders[planner]}
          faction={planner}
        />
      )}
      {handoffStage !== 'none' && <Handoff />}
      {game.phase === 'over' && (
        <WinBanner state={game} onNewGame={() => newGame()} />
      )}
      <PwaToasts installEligible={game.round > 1} />
    </main>
  );
}
