// Floating panel that appears when hover-info mode is active and the player
// has tapped a hex. Surfaces terrain, unit stats (fog-respecting), and base
// production. Closes by toggling info mode off or tapping the same hex twice.

import type {
  GameState,
  FactionId,
  UnitType,
  Hex,
  TerrainKey,
} from '../core/types.ts';
import { key as hexKey } from '../core/hex.ts';

type Tier = 'live' | 'memory' | 'dark';

type Props = {
  hex: Hex;
  state: GameState;
  unitTypes: Record<string, UnitType>;
  perspective: FactionId | null;
  currentVisible: Set<string>;
  discovered: Set<string>;
  onClose: () => void;
};

const FACTION_LABEL: Record<FactionId, string> = { 0: 'Ember', 1: 'Iron' };

function tierFor(
  k: string,
  currentVisible: Set<string>,
  discovered: Set<string>,
): Tier {
  if (currentVisible.has(k)) return 'live';
  if (discovered.has(k)) return 'memory';
  return 'dark';
}

// Compact one-letter type label, mirrors Board.tsx TYPE_LETTER.
function typeLetter(typeKey: string): string {
  const map: Record<string, string> = { infantry: 'I', tank: 'T' };
  return map[typeKey] ?? typeKey[0]?.toUpperCase() ?? '?';
}

export function InfoPanel({
  hex,
  state,
  unitTypes,
  perspective: _perspective,
  currentVisible,
  discovered,
  onClose,
}: Props) {
  const k = hexKey(hex);
  const tier = tierFor(k, currentVisible, discovered);
  const terrain: TerrainKey | undefined = state.map.tiles.get(k);

  // Off the map entirely → nothing to inspect.
  if (!terrain) {
    return (
      <aside className="info-panel" role="region" aria-label="Hex info">
        <div className="info-row">
          <span className="info-coord">({hex.q},{hex.r})</span>
          <button className="info-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="info-blank">off-map</div>
      </aside>
    );
  }

  if (tier === 'dark') {
    return (
      <aside className="info-panel" role="region" aria-label="Hex info">
        <div className="info-row">
          <span className="info-coord">({hex.q},{hex.r})</span>
          <button className="info-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="info-blank">unexplored</div>
      </aside>
    );
  }

  const unit = tier === 'live'
    ? Object.values(state.units).find((u) => u.hex.q === hex.q && u.hex.r === hex.r)
    : undefined;
  const unitType = unit ? unitTypes[unit.type] : undefined;
  const tEffect = unitType?.terrainEffects[terrain];

  const base = terrain === 'base'
    ? state.map.startingBases.find((b) => b.hex.q === hex.q && b.hex.r === hex.r)
    : undefined;

  return (
    <aside className="info-panel" role="region" aria-label="Hex info">
      <div className="info-row">
        <span className="info-coord">({hex.q},{hex.r})</span>
        <span className="info-terrain">{terrain.toUpperCase()}</span>
        {tier === 'memory' && <span className="info-tag">MEMORY</span>}
        <button className="info-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      {base && (
        <div className="info-section info-base">
          <div className="info-section-title">BASE</div>
          <div className="info-kv">
            <span>Owner</span>
            <span>
              {base.faction === null ? (
                <span className="fac-neutral">Neutral</span>
              ) : (
                <span className={`fac-${base.faction}`}>{FACTION_LABEL[base.faction]}</span>
              )}
            </span>
          </div>
          <div className="info-kv">
            <span>Income</span>
            <span>
              {base.faction === null ? '—' : `¢${state.map.perBaseCredits} / round`}
            </span>
          </div>
        </div>
      )}

      {unit && unitType && (
        <div className="info-section info-unit">
          <div className="info-section-title">
            UNIT <span className={`fac-${unit.faction}`}>{typeLetter(unit.type)} · {unitType.key}</span>
          </div>
          <div className="info-kv"><span>Faction</span><span className={`fac-${unit.faction}`}>{FACTION_LABEL[unit.faction]}</span></div>
          <div className="info-kv"><span>Count</span><span>{unit.count} / 10</span></div>
          <div className="info-kv"><span>Stance</span><span>{unit.stance}</span></div>
          <div className="info-kv"><span>Initiative</span><span>{unitType.initiative}</span></div>
          <div className="info-kv"><span>Movement</span><span>{unitType.movement} / 10</span></div>
          <div className="info-kv"><span>Vision</span><span>{unitType.vision}</span></div>
          <div className="info-kv">
            <span>Range</span>
            <span>{unitType.minRange === unitType.maxRange ? unitType.maxRange : `${unitType.minRange}–${unitType.maxRange}`}</span>
          </div>
          <div className="info-kv"><span>Armor</span><span>{unitType.armor} ({unitType.armorType})</span></div>
          <div className="info-kv">
            <span>Atk</span>
            <span className="info-atk">
              vs P {unitType.attackStrengths.personnel} ·
              vs A {unitType.attackStrengths.armored} ·
              vs N {unitType.attackStrengths.naval} ·
              vs Air {unitType.attackStrengths.air}
            </span>
          </div>
          {tEffect && (
            <div className="info-kv">
              <span>On {terrain}</span>
              <span>
                mc {tEffect.movementCost === 99 ? '∞' : tEffect.movementCost}
                {' · '}+{tEffect.attackBonus}A · +{tEffect.armorBonus}D
              </span>
            </div>
          )}
        </div>
      )}

      {!unit && !base && (
        <div className="info-section">
          <div className="info-section-title">TERRAIN</div>
          <div className="info-terrain-modifiers">
            {Object.values(unitTypes).map((ut) => {
              const e = ut.terrainEffects[terrain];
              if (!e) return null;
              return (
                <div className="info-kv" key={ut.key}>
                  <span>{typeLetter(ut.key)} {ut.key}</span>
                  <span>
                    mc {e.movementCost === 99 ? '∞' : e.movementCost}
                    {' · '}+{e.attackBonus}A · +{e.armorBonus}D
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
