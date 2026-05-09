// Side panel: selected unit info, stance segmented control, queued-orders list,
// and the Commit button. Mobile-first: slides up from the bottom.

import { useStore } from '../state/store.ts';
import type { Order } from '../core/orders.ts';
import type { Stance, FactionId, UnitInstance, UnitType } from '../core/types.ts';

const STANCE_LABEL: Record<Stance, string> = {
  aggressive: 'AGG',
  defensive: 'DEF',
  'hold-fire': 'HOLD',
};

type Props = {
  selectedUnit: UnitInstance | null;
  unitType: UnitType | null;
  pendingOrders: Order[];
  faction: FactionId;
};

export function OrderPanel({ selectedUnit, unitType, pendingOrders, faction }: Props) {
  const cycleStance = useStore((s) => s.cycleStance);
  const removeOrder = useStore((s) => s.removeOrderForUnit);
  const commit = useStore((s) => s.commitOrders);
  const game = useStore((s) => s.game);

  const ordersForSelected = selectedUnit
    ? pendingOrders.filter((o) => o.unitId === selectedUnit.id)
    : [];

  return (
    <aside className="order-panel">
      {selectedUnit && unitType ? (
        <div className="op-selected">
          <div className="op-row op-header">
            <span className="op-id">{selectedUnit.id.toUpperCase()}</span>
            <span className="op-type">{unitType.key.toUpperCase()}</span>
            <span className="op-count">{selectedUnit.count}/10</span>
          </div>
          <div className="op-row op-stance">
            {(['aggressive', 'defensive', 'hold-fire'] as const).map((s) => (
              <button
                key={s}
                className={`op-stance-btn ${selectedUnit.stance === s ? 'active' : ''}`}
                onClick={() => {
                  // Cycle until the requested stance is set
                  if (selectedUnit.stance !== s) {
                    let guard = 0;
                    while (guard++ < 4) {
                      cycleStance(selectedUnit.id);
                      const cur = useStore.getState().game?.units[selectedUnit.id]?.stance;
                      if (cur === s) break;
                    }
                  }
                }}
              >
                {STANCE_LABEL[s]}
              </button>
            ))}
          </div>
          {ordersForSelected.length > 0 && (
            <ul className="op-orders">
              {ordersForSelected.map((o, i) => (
                <li key={`${o.kind}-${i}`}>
                  <span className="op-order-kind">{o.kind}</span>
                  <span className="op-order-detail">{describeOrder(o)}</span>
                  <button
                    className="op-order-x"
                    aria-label="Remove order"
                    onClick={() => removeOrder(faction, o.unitId, o.kind)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="op-empty">
          <p className="op-empty-text">
            {game?.phase === 'planning'
              ? 'Tap one of your units to plan its orders.'
              : ''}
          </p>
        </div>
      )}

      <div className="op-footer">
        <span className="op-pending">
          {pendingOrders.length} order{pendingOrders.length === 1 ? '' : 's'} queued
        </span>
        <button className="op-commit" onClick={commit} disabled={!game || game.phase !== 'planning'}>
          Commit Orders →
        </button>
      </div>
    </aside>
  );
}

function describeOrder(o: Order): string {
  if (o.kind === 'move') {
    const last = o.path[o.path.length - 1];
    return last ? `→ (${last.q},${last.r})` : '— no path';
  }
  if (o.kind === 'attack') {
    return `→ atk (${o.targetHex.q},${o.targetHex.r})`;
  }
  return o.stance;
}
