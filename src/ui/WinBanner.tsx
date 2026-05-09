import type { FactionId, GameState } from '../core/types.ts';
import { MAPS } from '../io/maps.ts';

const FACTION_NAME: Record<FactionId, string> = { 0: 'Ember', 1: 'Iron' };

type Props = {
  state: GameState;
  onNewGame: (mapId?: string) => void;
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
        <p className="win-sub" style={{ marginTop: '0.6rem' }}>Pick a map for the next game</p>
        <div className="win-map-row">
          {MAPS.map((m) => (
            <button
              key={m.id}
              className="win-map-btn"
              onClick={() => onNewGame(m.id)}
            >
              <span className="win-map-name">{m.name}</span>
              <span className="win-map-blurb">{m.blurb}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
