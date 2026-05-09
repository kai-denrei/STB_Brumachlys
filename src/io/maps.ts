// Bundled-map registry. v1 ships with two maps; the future-add criterion
// (DECISIONS §B.9) is maxPlayers ≤ 2, dims ≤ 20×20, Trooper-only roster.

import threeWaysXml from '../../data/maps/three-ways.xml?raw';
import arubaXml from '../../data/maps/aruba.xml?raw';

export type MapEntry = {
  id: string;
  name: string;
  blurb: string;
  xml: string;
};

export const MAPS: MapEntry[] = [
  {
    id: 'three-ways',
    name: 'Three Ways',
    blurb: '17×20 — three landmasses, narrow approaches',
    xml: threeWaysXml,
  },
  {
    id: 'aruba',
    name: 'Aruba',
    blurb: '9×9 — compact, mountain-rich',
    xml: arubaXml,
  },
];

export const DEFAULT_MAP_ID = 'three-ways';

export function mapById(id: string): MapEntry | undefined {
  return MAPS.find((m) => m.id === id);
}
