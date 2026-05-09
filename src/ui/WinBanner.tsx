import type { FactionId, GameState } from '../core/types.ts';

const FACTION_NAME: Record<FactionId, string> = { 0: 'Ember', 1: 'Iron' };

type Props = {
  state: GameState;
  onNewGame: () => void;
};

export function WinBanner({ state, onNewGame }: Props) {
  // Determine the winner: whichever faction still has units.
  const f0Alive = Object.values(state.units).some((u) => u.faction === 0);
  const f1Alive = Object.values(state.units).some((u) => u.faction === 1);
  let winner: FactionId | null = null;
  if (f0Alive && !f1Alive) winner = 0;
  else if (f1Alive && !f0Alive) winner = 1;

  return (
    <div className="win-banner">
      <div className="win-inner">
        <span className="win-mark">★</span>
        {winner !== null ? (
          <>
            <h2 className={`win-title fac-${winner}`}>{FACTION_NAME[winner]} wins</h2>
            <p className="win-sub">Round {state.round - 1}</p>
          </>
        ) : (
          <h2 className="win-title">Stalemate</h2>
        )}
        <button className="win-newgame" onClick={onNewGame}>
          New game
        </button>
      </div>
    </div>
  );
}
