// Replay timeline: animates events at the configured speed, mutates a working
// snapshot of GameState, and on completion flips to next round's planning.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store.ts';
import { Board } from './Board.tsx';
import type {
  GameState,
  ResolutionEvent,
  UnitInstance,
  UnitType,
  Hex,
} from '../core/types.ts';

const BASE_DURATION_MS = 600;
const SPEED_FACTOR: Record<0.5 | 1 | 2 | 'instant', number> = {
  0.5: 2.0,
  1: 1.0,
  2: 0.5,
  instant: 0,
};

type Props = {
  oldState: GameState;
  log: ResolutionEvent[];
  unitTypes: Record<string, UnitType>;
  onDone: () => void;
};

export function Replay({ oldState, log, unitTypes, onDone }: Props) {
  // Working snapshot of the game state, mutated event-by-event.
  const [working, setWorking] = useState<GameState>(() => structuredClone(oldState));
  const [cursor, setCursor] = useState(0);
  const speed = useStore((s) => s.replaySpeed);
  const setSpeed = useStore((s) => s.setReplaySpeed);

  const totalEvents = log.length;
  const flashRef = useRef<{ from: Hex; to: Hex; color: string; until: number } | null>(null);
  const timer = useRef<number | null>(null);

  // Apply one event to the working snapshot.
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
      flashRef.current = {
        from: next.units[e.attackerId]?.hex ?? { q: 0, r: 0 },
        to: next.units[e.defenderId]?.hex ?? { q: 0, r: 0 },
        color: '#E84A4A',
        until: Date.now() + 300,
      };
    } else if (e.type === 'counter') {
      const def = next.units[e.defenderId];
      if (def) def.count = Math.max(0, def.count - e.damage);
      flashRef.current = {
        from: next.units[e.attackerId]?.hex ?? { q: 0, r: 0 },
        to: next.units[e.defenderId]?.hex ?? { q: 0, r: 0 },
        color: '#3FB7B0',
        until: Date.now() + 300,
      };
    } else if (e.type === 'kill') {
      delete next.units[e.unitId];
    }
    // 'lost-target' and 'path-truncated' are flavor — no state change.
    return next;
  }

  // Drive the timeline.
  useEffect(() => {
    if (cursor >= totalEvents) {
      // small grace period at end so user can read final positions
      const t = window.setTimeout(onDone, 600);
      return () => window.clearTimeout(t);
    }
    const factor = SPEED_FACTOR[speed];
    if (factor === 0) {
      // instant: apply all remaining now
      let s = working;
      for (let i = cursor; i < totalEvents; i++) {
        s = applyEvent(s, log[i]!);
      }
      setWorking(s);
      setCursor(totalEvents);
      return;
    }
    const d = BASE_DURATION_MS * factor;
    timer.current = window.setTimeout(() => {
      const ev = log[cursor]!;
      setWorking((s) => applyEvent(s, ev));
      setCursor((c) => c + 1);
    }, d);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, speed, totalEvents]);

  const currentEvent = log[cursor - 1] ?? null;
  const summary = useMemo(() => describe(currentEvent, working.units), [currentEvent, working.units]);

  return (
    <div className="replay-stage">
      <Board state={working} unitTypes={unitTypes} perspective={null} />
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

function describe(e: ResolutionEvent | null, units: Record<string, UnitInstance>): string {
  if (!e) return 'Resolving…';
  switch (e.type) {
    case 'stance':
      return `${e.unitId.toUpperCase()} → ${e.stance}`;
    case 'move':
      return `${e.unitId.toUpperCase()} moved to (${e.to.q},${e.to.r})`;
    case 'path-truncated':
      return `${e.unitId.toUpperCase()} stopped short at (${e.actual.q},${e.actual.r})`;
    case 'attack': {
      return `${e.attackerId.toUpperCase()} hits ${e.defenderId.toUpperCase()} for ${e.damage}${e.bonusB ? ` (+${e.bonusB} B)` : ''}`;
    }
    case 'counter':
      return `${e.attackerId.toUpperCase()} counters for ${e.damage}`;
    case 'kill':
      return `${e.unitId.toUpperCase()} destroyed`;
    case 'lost-target':
      return `${e.attackerId.toUpperCase()} lost target`;
  }
  void units;
  return '';
}
