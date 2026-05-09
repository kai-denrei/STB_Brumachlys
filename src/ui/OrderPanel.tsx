// Side panel: switches between three modes during planning —
//   • selectedUnit  → orders for that unit (move/attack/stance + queued list)
//   • selectedBase  → BuildPanel (unit options for that base)
//   • neither       → hint
// Commit button is always pinned at the bottom.

import { useStore } from '../state/store.ts';
import type { Order } from '../core/orders.ts';
import type {
  Stance,
  FactionId,
  UnitInstance,
  UnitType,
  Hex,
} from '../core/types.ts';

const STANCE_LABEL: Record<Stance, string> = {
  aggressive: 'AGG',
  defensive: 'DEF',
  'hold-fire': 'HOLD',
};

type Props = {
  selectedUnit: UnitInstance | null;
  unitType: UnitType | null;
  selectedBaseHex: Hex | null;
  pendingOrders: Order[];
  faction: FactionId;
  credits: number;
  unitTypes: Record<string, UnitType>;
};

export function OrderPanel({
  selectedUnit,
  unitType,
  selectedBaseHex,
  pendingOrders,
  faction,
  credits,
  unitTypes,
}: Props) {
  const cycleStance = useStore((s) => s.cycleStance);
  const removeOrder = useStore((s) => s.removeOrderForUnit);
  const removeBuyAt = useStore((s) => s.removeBuyAt);
  const queueOrder = useStore((s) => s.queueOrder);
  const selectBase = useStore((s) => s.selectBase);
  const commit = useStore((s) => s.commitOrders);
  const game = useStore((s) => s.game);

  const ordersForSelectedUnit = selectedUnit
    ? pendingOrders.filter(
        (o) =>
          (o.kind === 'move' || o.kind === 'attack' || o.kind === 'stance') &&
          o.unitId === selectedUnit.id,
      )
    : [];

  // Cumulative cost of all queued buys this round; subtract from credits to show
  // what's still spendable.
  const queuedBuyCost = pendingOrders.reduce((acc, o) => {
    if (o.kind !== 'buy') return acc;
    const ut = unitTypes[o.unitTypeKey];
    return acc + (ut?.cost ?? 0);
  }, 0);
  const spendable = credits - queuedBuyCost;

  const queuedBuyAtBase = selectedBaseHex
    ? (pendingOrders.find(
        (o) =>
          o.kind === 'buy' &&
          o.baseHex.q === selectedBaseHex.q &&
          o.baseHex.r === selectedBaseHex.r,
      ) as Extract<Order, { kind: 'buy' }> | undefined)
    : undefined;

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
                  if (selectedUnit.stance !== s) {
                    let guard = 0;
                    while (guard++ < 4) {
                      cycleStance(selectedUnit.id);
                      const cur =
                        useStore.getState().game?.units[selectedUnit.id]?.stance;
                      if (cur === s) break;
                    }
                  }
                }}
              >
                {STANCE_LABEL[s]}
              </button>
            ))}
          </div>
          {ordersForSelectedUnit.length > 0 && (
            <ul className="op-orders">
              {ordersForSelectedUnit.map((o, i) => (
                <li key={`${o.kind}-${i}`}>
                  <span className="op-order-kind">{o.kind}</span>
                  <span className="op-order-detail">{describeOrder(o)}</span>
                  <button
                    className="op-order-x"
                    aria-label="Remove order"
                    onClick={() => {
                      if (o.kind === 'buy') return; // not in this list
                      removeOrder(faction, o.unitId, o.kind);
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : selectedBaseHex ? (
        <div className="op-selected">
          <div className="op-row op-header">
            <span className="op-id">BASE ({selectedBaseHex.q},{selectedBaseHex.r})</span>
            <span className="op-type">BUILD</span>
            <span className={`op-count ${spendable < 0 ? 'op-overdrawn' : ''}`}>
              ¢{spendable}
            </span>
          </div>
          {queuedBuyAtBase ? (
            <div className="op-buy-queued">
              <span className="op-order-kind">queued</span>
              <span className="op-order-detail">
                {queuedBuyAtBase.unitTypeKey} (¢
                {unitTypes[queuedBuyAtBase.unitTypeKey]?.cost ?? '?'})
              </span>
              <button
                className="op-order-x"
                aria-label="Cancel buy"
                onClick={() => {
                  removeBuyAt(faction, selectedBaseHex);
                }}
              >
                ✕
              </button>
            </div>
          ) : (
            <ul className="op-build-options">
              {Object.values(unitTypes).map((ut) => {
                const canAfford = spendable >= ut.cost;
                return (
                  <li key={ut.key}>
                    <button
                      className="op-build-btn"
                      disabled={!canAfford}
                      onClick={() => {
                        queueOrder(faction, {
                          kind: 'buy',
                          baseHex: selectedBaseHex,
                          unitTypeKey: ut.key,
                        });
                        selectBase(null);
                      }}
                    >
                      <span className="op-build-name">{ut.key.toUpperCase()}</span>
                      <span className="op-build-cost">¢{ut.cost}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <div className="op-empty">
          <p className="op-empty-text">
            {game?.phase === 'planning'
              ? 'Tap one of your units, or an own empty base to build.'
              : ''}
          </p>
        </div>
      )}

      <div className="op-footer">
        <span className="op-pending">
          {pendingOrders.length} order{pendingOrders.length === 1 ? '' : 's'} queued
          {' · '}
          ¢{spendable}
        </span>
        <button
          className="op-commit"
          onClick={commit}
          disabled={!game || game.phase !== 'planning'}
        >
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
  if (o.kind === 'stance') {
    return o.stance;
  }
  // buy — described separately in BuildPanel; this branch shouldn't normally render
  return `${o.unitTypeKey} @ (${o.baseHex.q},${o.baseHex.r})`;
}
