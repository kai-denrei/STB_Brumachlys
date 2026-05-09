import type { GamePhase, FactionId } from '../core/types.ts';

type Props = {
  round: number;
  phase: GamePhase;
  player: FactionId | null;
  pendingCount: number;
  credits?: number; // current player's economy balance
};

const FACTION_LABEL: Record<FactionId, string> = { 0: 'Ember', 1: 'Iron' };
const FACTION_CLASS: Record<FactionId, string> = { 0: 'fac-0', 1: 'fac-1' };

export function Hud({ round, phase, player, pendingCount, credits }: Props) {
  const phaseLabel = phase.replace('-', ' ').toUpperCase();
  return (
    <header className="hud">
      <div className="hud-line">
        <span className="hud-round">RND {String(round).padStart(2, '0')}</span>
        <span className="hud-phase">{phaseLabel}</span>
        {player !== null && (
          <span className={`hud-player ${FACTION_CLASS[player]}`}>
            {FACTION_LABEL[player]} (P{player + 1})
          </span>
        )}
      </div>
      {phase === 'planning' && (
        <div className="hud-sub">
          {pendingCount} order{pendingCount === 1 ? '' : 's'} queued
          {credits !== undefined && (
            <span className="hud-credits"> · ¢{credits}</span>
          )}
        </div>
      )}
    </header>
  );
}
