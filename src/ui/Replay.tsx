// Replay timeline: animates events at the configured speed, mutates a working
// snapshot of GameState, and on completion flips to next round's planning.
//
// Per-event durations:
//   • move      — full pathTaken length × 250ms per step (clamped to ≥ 600ms total)
//   • attack    — 380ms flash (apply state instantly, fade after)
//   • counter   — 320ms flash
//   • kill      — 220ms beat (gives time to "see" the unit vanish)
//   • stance / lost-target / path-truncated — 220ms (status-only)
//
// All durations scale by the user's replay-speed factor.

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store.ts';
import { Board, type AnimationOverlay } from './Board.tsx';
import type {
  GameState,
  ResolutionEvent,
  UnitInstance,
  UnitType,
} from '../core/types.ts';

const STEP_MS = 250;
const MOVE_MIN_MS = 600;
const ATTACK_FLASH_MS = 380;
const COUNTER_FLASH_MS = 320;
const KILL_BEAT_MS = 220;
const STATUS_BEAT_MS = 220;

const SPEED_FACTOR: Record<0.5 | 1 | 2 | 'instant', number> = {
  0.5: 2.0,
  1: 1.0,
  2: 0.5,
  instant: 0,
};

const ATTACK_COLOR = '#E84A4A';
const COUNTER_COLOR = '#3FB7B0';

type Props = {
  oldState: GameState;
  log: ResolutionEvent[];
  unitTypes: Record<string, UnitType>;
  onDone: () => void;
};

export function Replay({ oldState, log, unitTypes, onDone }: Props) {
  const [working, setWorking] = useState<GameState>(() => structuredClone(oldState));
  const [cursor, setCursor] = useState(0);
  const [overlay, setOverlay] = useState<AnimationOverlay | null>(null);
  const speed = useStore((s) => s.replaySpeed);
  const setSpeed = useStore((s) => s.setReplaySpeed);

  // Apply one event to the working snapshot. Pure — no animation.
  function applyEvent(s: GameState, e: ResolutionEvent): GameState {
    const next = structuredClone(s);
    if (e.type === 'stance') {
      const u = next.units[e.unitId];
      if (u) u.stance = e.stance;
    } else if (e.type === 'move') {
      const u = next.units[e.unitId];
      if (u) u.hex = { q: e.to.q, r: e.to.r };
    } else if (e.type === 'attack') {
      const def = next.units[e.defenderId];
      if (def) def.count = Math.max(0, def.count - e.damage);
    } else if (e.type === 'counter') {
      const def = next.units[e.defenderId];
      if (def) def.count = Math.max(0, def.count - e.damage);
    } else if (e.type === 'kill') {
      delete next.units[e.unitId];
    } else if (e.type === 'unit-spawned') {
      next.units[e.unitId] = {
        id: e.unitId,
        type: e.unitTypeKey,
        faction: e.faction,
        hex: { q: e.hex.q, r: e.hex.r },
        count: 10,
        stance: 'aggressive',
        attackedFromHexes: [],
      };
      next.credits = { ...next.credits, [e.faction]: next.credits[e.faction] - e.cost };
    } else if (e.type === 'income') {
      next.credits = {
        ...next.credits,
        [e.faction]: next.credits[e.faction] + e.amount,
      };
    }
    // 'lost-target', 'path-truncated', 'buy-fizzled' are flavor — no state change.
    return next;
  }

  // ── Timeline driver ──────────────────────────────────────────────────────
  // Each cursor step schedules either:
  //   • an rAF-driven animation that calls onDone when finished, or
  //   • a setTimeout for instant/status events.
  // The cleanup fns for both are returned from useEffect.
  useEffect(() => {
    if (cursor >= log.length) {
      const t = window.setTimeout(onDone, 600);
      return () => window.clearTimeout(t);
    }

    const factor = SPEED_FACTOR[speed];
    if (factor === 0) {
      // Instant: collapse the rest of the log in one shot
      let s = working;
      for (let i = cursor; i < log.length; i++) {
        s = applyEvent(s, log[i]!);
      }
      setOverlay(null);
      setWorking(s);
      setCursor(log.length);
      return;
    }

    const e = log[cursor]!;

    if (e.type === 'move') {
      const steps = Math.max(1, e.pathTaken.length);
      const dur = Math.max(MOVE_MIN_MS, steps * STEP_MS) * factor;
      return runRaf(dur, (p) => {
        setOverlay({
          kind: 'move',
          unitId: e.unitId,
          from: e.from,
          pathTaken: e.pathTaken,
          progress: p,
        });
      }, () => {
        setOverlay(null);
        setWorking((s) => applyEvent(s, e));
        setCursor((c) => c + 1);
      });
    }

    if (e.type === 'attack' || e.type === 'counter') {
      // Apply damage immediately so the count-number drops before the flash fades.
      setWorking((s) => applyEvent(s, e));
      const attacker = e.type === 'attack' ? working.units[e.attackerId] : working.units[e.attackerId];
      const defender = e.type === 'attack' ? working.units[e.defenderId] : working.units[e.defenderId];
      const fromHex = attacker?.hex ?? { q: 0, r: 0 };
      const toHex = defender?.hex ?? { q: 0, r: 0 };
      const dur = (e.type === 'attack' ? ATTACK_FLASH_MS : COUNTER_FLASH_MS) * factor;
      const color = e.type === 'attack' ? ATTACK_COLOR : COUNTER_COLOR;
      return runRaf(dur, (p) => {
        setOverlay({
          kind: 'flash',
          from: fromHex,
          to: toHex,
          color,
          opacity: 1 - p, // fade out
        });
      }, () => {
        setOverlay(null);
        setCursor((c) => c + 1);
      });
    }

    // status / kill / lost-target / path-truncated → instant + small beat
    const dur =
      (e.type === 'kill' ? KILL_BEAT_MS : STATUS_BEAT_MS) * factor;
    setWorking((s) => applyEvent(s, e));
    const t = window.setTimeout(() => {
      setOverlay(null);
      setCursor((c) => c + 1);
    }, dur);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, speed]);

  const currentEvent = log[cursor - 1] ?? null;
  const summary = useMemo(
    () => describe(currentEvent, working.units),
    [currentEvent, working.units],
  );
  const totalEvents = log.length;

  return (
    <div className="replay-stage">
      <Board
        state={working}
        unitTypes={unitTypes}
        perspective={null}
        animationOverlay={overlay}
      />
      <div className="replay-controls">
        <span className="replay-counter">
          {cursor}/{totalEvents}
        </span>
        <span className="replay-text">{summary}</span>
        <div className="replay-speed">
          {([0.5, 1, 2, 'instant'] as const).map((s) => (
            <button
              key={String(s)}
              className={`replay-speed-btn ${speed === s ? 'active' : ''}`}
              onClick={() => setSpeed(s)}
            >
              {s === 'instant' ? '⏭' : `${s}×`}
            </button>
          ))}
          <button className="replay-skip" onClick={onDone}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

// Drive a 0→1 progress over `duration` ms via rAF. Calls `onTick` each frame
// and `onDone` when complete. Returns a cleanup fn.
function runRaf(
  duration: number,
  onTick: (progress: number) => void,
  onDone: () => void,
): () => void {
  let raf = 0;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    onTick(t);
    if (t >= 1) {
      onDone();
      return;
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

function describe(e: ResolutionEvent | null, units: Record<string, UnitInstance>): string {
  if (!e) return 'Resolving…';
  switch (e.type) {
    case 'stance':
      return `${e.unitId.toUpperCase()} → ${e.stance}`;
    case 'move':
      return `${e.unitId.toUpperCase()} moved to (${e.to.q},${e.to.r})`;
    case 'path-truncated':
      return `${e.unitId.toUpperCase()} stopped short at (${e.actual.q},${e.actual.r})`;
    case 'attack':
      return `${e.attackerId.toUpperCase()} hits ${e.defenderId.toUpperCase()} for ${e.damage}${e.bonusB ? ` (+${e.bonusB} B)` : ''}`;
    case 'counter':
      return `${e.attackerId.toUpperCase()} counters for ${e.damage}`;
    case 'kill':
      return `${e.unitId.toUpperCase()} destroyed`;
    case 'lost-target':
      return `${e.attackerId.toUpperCase()} lost target`;
    case 'unit-spawned':
      return `${e.unitTypeKey.toUpperCase()} spawned at (${e.hex.q},${e.hex.r}) — ¢${e.cost}`;
    case 'buy-fizzled':
      return `Buy ${e.unitTypeKey.toUpperCase()} fizzled — ${e.reason}`;
    case 'income':
      return `Income +¢${e.amount} (${e.bases} base${e.bases === 1 ? '' : 's'})`;
  }
  void units;
  return '';
}
