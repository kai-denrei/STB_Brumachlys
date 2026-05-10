import type { GamePhase, FactionId } from '../core/types.ts';

type Props = {
  round: number;
  phase: GamePhase;
  player: FactionId | null;
  pendingCount: number;
  credits?: number; // current player's economy balance
  hoverInfoMode?: boolean;
  onToggleHoverInfo?: () => void;
  gameMode?: 'hot-seat' | 'solo';
  onToggleGameMode?: () => void;
};

const FACTION_LABEL: Record<FactionId, string> = { 0: 'Ember', 1: 'Iron' };
const FACTION_CLASS: Record<FactionId, string> = { 0: 'fac-0', 1: 'fac-1' };

export function Hud({
  round,
  phase,
  player,
  pendingCount,
  credits,
  hoverInfoMode,
  onToggleHoverInfo,
  gameMode,
  onToggleGameMode,
}: Props) {
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
        {onToggleGameMode && phase === 'planning' && (
          <button
            type="button"
            className={`hud-mode-toggle${gameMode === 'solo' ? ' on' : ''}`}
            onClick={onToggleGameMode}
            aria-pressed={gameMode === 'solo' ? 'true' : 'false'}
            aria-label={gameMode === 'solo' ? 'Switch to hot-seat (1v1)' : 'Switch to solo (vs AI)'}
            title={gameMode === 'solo' ? 'Solo (vs AI). Click for hot-seat.' : 'Hot-seat (1v1). Click for solo.'}
          >
            {gameMode === 'solo' ? 'SOLO' : '1v1'}
          </button>
        )}
        {onToggleHoverInfo && phase === 'planning' && (
          <button
            type="button"
            className={`hud-info-toggle${hoverInfoMode ? ' on' : ''}`}
            onClick={onToggleHoverInfo}
            aria-pressed={hoverInfoMode ? 'true' : 'false'}
            aria-label={hoverInfoMode ? 'Exit info mode' : 'Enter info mode'}
            title="Tap a hex for stats while this is on"
          >
            ⓘ
          </button>
        )}
      </div>
      {phase === 'planning' && (
        <div className="hud-sub">
          {pendingCount} order{pendingCount === 1 ? '' : 's'} queued
          {credits !== undefined && (
            <span className="hud-credits"> · ¢{credits}</span>
          )}
          {hoverInfoMode && <span className="hud-info-flag"> · INFO MODE</span>}
        </div>
      )}
    </header>
  );
}
