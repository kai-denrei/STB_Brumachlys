// Weewar XML map loader. DOMParser-based — no XML library needed.
// See BRUMACHLYS.md §5 and DECISIONS.md §B.10–§B.12 for the corrections.

import type { GameMap, FactionId, TerrainKey } from '../core/types.ts';

// Maps Weewar's terrain-type attribute (case-insensitive) to our TerrainKey.
const TERRAIN_MAP: Record<string, TerrainKey> = {
  plains: 'plains',
  water: 'water',
  mountains: 'mountains',
  woods: 'woods',
  swamp: 'swamp',
  base: 'base',
};

// Weewar unit-type attribute → our internal key (case-insensitive).
// Currently only `Trooper` is mapped; extend when the roster grows.
const UNIT_MAP: Record<string, string> = {
  trooper: 'infantry',
};

export function parseWeewarMap(xmlString: string): GameMap {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error(`parseWeewarMap: malformed XML — ${parserError.textContent ?? ''}`);
  }

  const mapEl = doc.querySelector('map');
  if (!mapEl) {
    throw new Error('parseWeewarMap: missing <map> root element');
  }

  const name = directChildText(mapEl, 'name')?.trim() ?? 'Untitled';
  const width = parseIntStrict(directChildText(mapEl, 'width'), 0);
  const height = parseIntStrict(directChildText(mapEl, 'height'), 0);

  const tiles = new Map<string, TerrainKey>();
  const startingUnits: GameMap['startingUnits'] = [];
  const startingBases: GameMap['startingBases'] = [];
  let droppedFactionUnits = 0;

  for (const el of Array.from(doc.querySelectorAll('terrain'))) {
    const x = parseIntStrict(el.getAttribute('x'), 0);
    const y = parseIntStrict(el.getAttribute('y'), 0);
    const typeRaw = el.getAttribute('type') ?? 'Plains';
    const typeKey = typeRaw.toLowerCase();

    let terrain: TerrainKey;
    if (typeKey in TERRAIN_MAP) {
      terrain = TERRAIN_MAP[typeKey]!;
    } else {
      console.warn(
        `parseWeewarMap: unknown terrain "${typeRaw}" at (${x},${y}); defaulting to plains.`,
      );
      terrain = 'plains';
    }

    // Spec §5.2: q = x, r = y. Verified visually against the rendered map.
    tiles.set(`${x},${y}`, terrain);

    const startUnitRaw = el.getAttribute('startUnit');
    const startUnitOwnerRaw = el.getAttribute('startUnitOwner');
    if (startUnitRaw && startUnitOwnerRaw !== null) {
      const ownerNum = Number.parseInt(startUnitOwnerRaw, 10);
      if (Number.isFinite(ownerNum) && ownerNum >= 2) {
        droppedFactionUnits++;
      } else if (ownerNum === 0 || ownerNum === 1) {
        const unitTypeKey = UNIT_MAP[startUnitRaw.toLowerCase()];
        if (unitTypeKey) {
          startingUnits.push({
            hex: { q: x, r: y },
            unitTypeKey,
            faction: ownerNum as FactionId,
          });
        } else {
          console.warn(
            `parseWeewarMap: unknown unit type "${startUnitRaw}" at (${x},${y}); dropping.`,
          );
        }
      }
    }

    if (terrain === 'base') {
      // Per DECISIONS §B.12: any startFaction not in {0,1} (including 5, missing, or 2)
      // collapses to neutral. Bases are visual-only in PoC, so we keep them all on the map.
      const baseFaction = coerceFaction(el.getAttribute('startFaction'));
      startingBases.push({ hex: { q: x, r: y }, faction: baseFaction });
    }
  }

  if (droppedFactionUnits > 0) {
    console.warn(
      `parseWeewarMap: dropped ${droppedFactionUnits} starting unit(s) belonging to faction ≥ 2 (PoC supports 2 factions).`,
    );
  }

  return { name, width, height, tiles, startingUnits, startingBases };
}

export function coerceFaction(raw: string | null | undefined): FactionId | null {
  if (raw === '0') return 0;
  if (raw === '1') return 1;
  return null;
}

function parseIntStrict(raw: string | null | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

// jsdom's XML mode does not support the `:scope >` selector, so we iterate
// direct children manually instead of relying on querySelector.
function directChildText(parent: Element, tagName: string): string | null {
  for (const child of Array.from(parent.children)) {
    if (child.tagName === tagName) return child.textContent;
  }
  return null;
}
