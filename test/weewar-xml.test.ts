import { describe, expect, test, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseWeewarMap, coerceFaction } from '../src/io/weewar-xml.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const threeWaysXml = readFileSync(
  resolve(__dirname, '../data/maps/three-ways.xml'),
  'utf-8',
);

describe('parseWeewarMap — three-ways.xml (corrected per DECISIONS §B.10/B.11/B.12)', () => {
  test('reads width/height/name from header', () => {
    const map = parseWeewarMap(threeWaysXml);
    expect(map.width).toBe(17);
    expect(map.height).toBe(20);
    expect(map.name).toBe('Three ways');
  });

  test('reads economy fields (initialCredits, perBaseCredits)', () => {
    const map = parseWeewarMap(threeWaysXml);
    expect(map.initialCredits).toBe(100);
    expect(map.perBaseCredits).toBe(200);
  });

  test('tiles is sparse — exactly 190 entries (B.11)', () => {
    const map = parseWeewarMap(threeWaysXml);
    expect(map.tiles.size).toBe(190);
  });

  test('tile keys are "q,r" with q=x, r=y per spec §5.2', () => {
    const map = parseWeewarMap(threeWaysXml);
    // Sample assertions from the XML head:
    expect(map.tiles.get('0,9')).toBe('water');
    expect(map.tiles.get('1,10')).toBe('base');
    expect(map.tiles.get('2,10')).toBe('swamp');
    expect(map.tiles.get('3,9')).toBe('plains');
  });

  test('terrain types map case-insensitively', () => {
    const map = parseWeewarMap(threeWaysXml);
    const counts = { plains: 0, water: 0, mountains: 0, woods: 0, swamp: 0, base: 0 };
    for (const t of map.tiles.values()) counts[t]++;
    expect(counts.plains).toBe(57);
    expect(counts.water).toBe(109);
    expect(counts.mountains).toBe(3);
    expect(counts.woods).toBe(3);
    expect(counts.swamp).toBe(6);
    expect(counts.base).toBe(12);
  });

  test('startingUnits has length 4 after dropping factions ≥ 2 (B.10)', () => {
    const map = parseWeewarMap(threeWaysXml);
    expect(map.startingUnits.length).toBe(4);
    expect(map.startingUnits.every((u) => u.faction === 0 || u.faction === 1)).toBe(true);
  });

  test('all starting units map to internal "infantry" key', () => {
    const map = parseWeewarMap(threeWaysXml);
    expect(map.startingUnits.every((u) => u.unitTypeKey === 'infantry')).toBe(true);
  });

  test('starting unit hexes are placed at the start positions from the XML', () => {
    const map = parseWeewarMap(threeWaysXml);
    // Each surviving unit's hex must correspond to a tile in the sparse map.
    for (const u of map.startingUnits) {
      const tileKey = `${u.hex.q},${u.hex.r}`;
      expect(map.tiles.has(tileKey)).toBe(true);
    }
  });

  test('startingBases includes all 12 bases with correct faction-or-null', () => {
    const map = parseWeewarMap(threeWaysXml);
    expect(map.startingBases.length).toBe(12);
    const counts = map.startingBases.reduce(
      (acc, b) => {
        if (b.faction === null) acc.neutral++;
        else if (b.faction === 0) acc.f0++;
        else if (b.faction === 1) acc.f1++;
        return acc;
      },
      { neutral: 0, f0: 0, f1: 0 },
    );
    // 1 owned by 0, 1 owned by 1, the other 10 (faction 2 + faction 5 + no-faction) all collapse to neutral.
    expect(counts.f0).toBe(1);
    expect(counts.f1).toBe(1);
    expect(counts.neutral).toBe(10);
  });
});

describe('parseWeewarMap — drop-factions warning (§5.1)', () => {
  test('warns once when faction ≥ 2 units are dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    parseWeewarMap(threeWaysXml);
    expect(warn).toHaveBeenCalled();
    const msg = warn.mock.calls.map((c) => c[0]).join(' ');
    expect(msg).toMatch(/faction/i);
    warn.mockRestore();
  });
});

describe('parseWeewarMap — minimal hand-crafted XML', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  test('two-tile, no units, no bases', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <map id="99">
        <name>Tiny</name>
        <initialCredits>0</initialCredits>
        <perBaseCredits>0</perBaseCredits>
        <width>2</width>
        <height>1</height>
        <maxPlayers>2</maxPlayers>
        <terrains>
          <terrain x="0" y="0" type="Plains" />
          <terrain x="1" y="0" type="Woods" />
        </terrains>
      </map>`;
    const map = parseWeewarMap(xml);
    expect(map.width).toBe(2);
    expect(map.height).toBe(1);
    expect(map.name).toBe('Tiny');
    expect(map.tiles.size).toBe(2);
    expect(map.tiles.get('0,0')).toBe('plains');
    expect(map.tiles.get('1,0')).toBe('woods');
    expect(map.startingUnits).toEqual([]);
    expect(map.startingBases).toEqual([]);
  });

  test('unknown terrain falls back to plains with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const xml = `<?xml version="1.0"?><map><name>X</name><width>1</width><height>1</height><maxPlayers>2</maxPlayers><terrains><terrain x="0" y="0" type="Lava" /></terrains></map>`;
    const map = parseWeewarMap(xml);
    expect(map.tiles.get('0,0')).toBe('plains');
    expect(warn).toHaveBeenCalled();
  });

  test('unknown unit type is dropped with a warning, terrain still recorded', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const xml = `<?xml version="1.0"?><map><name>X</name><width>1</width><height>1</height><maxPlayers>2</maxPlayers><terrains><terrain x="0" y="0" type="Plains" startUnit="Mecha" startUnitOwner="0" /></terrains></map>`;
    const map = parseWeewarMap(xml);
    expect(map.startingUnits).toEqual([]);
    expect(map.tiles.get('0,0')).toBe('plains');
    expect(warn).toHaveBeenCalled();
  });
});

describe('coerceFaction', () => {
  test('"0" → 0, "1" → 1', () => {
    expect(coerceFaction('0')).toBe(0);
    expect(coerceFaction('1')).toBe(1);
  });

  test('"5", "2", null, undefined → null', () => {
    expect(coerceFaction('5')).toBe(null);
    expect(coerceFaction('2')).toBe(null);
    expect(coerceFaction(null)).toBe(null);
    expect(coerceFaction(undefined)).toBe(null);
  });
});
