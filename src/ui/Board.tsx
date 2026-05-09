// Canvas board renderer.
//
// Phase 6: terrain + bases + units, with fog-filter applied for the active planner.
// Phase 7+: selection rings, range overlays, planned-path arrows, drag-to-pan.

import { useEffect, useLayoutEffect, useRef } from 'react';
import { hexCenter, hexVertices, fitToViewport, pixelToHex } from './hexLayout.ts';
import { TERRAIN_FILL, TERRAIN_STROKE } from './terrainPalette.ts';
import { visibleHexesFor } from '../core/fog.ts';
import type {
  GameState,
  FactionId,
  UnitType,
  Hex,
} from '../core/types.ts';

const FACTION_COLOR: Record<FactionId, string> = {
  0: '#E89A3C', // Ember Amber
  1: '#3FB7B0', // Iron Teal
};
const NEUTRAL_RING = '#5A5A55';

type Highlights = {
  selectedHex?: Hex | null;
  reachableHexes?: Set<string>;     // for movement preview
  attackableHexes?: Set<string>;    // for attack preview (enemy hexes)
  plannedDest?: Hex | null;         // destination of queued move
  plannedAttack?: Hex | null;       // target hex of queued attack
};

type Props = {
  state: GameState;
  unitTypes: Record<string, UnitType>;
  perspective: FactionId | null; // whose fog is applied; null = full reveal (replay)
  highlights?: Highlights;
  onTapHex?: (hex: Hex) => void;
};

export function Board({
  state,
  unitTypes,
  perspective,
  highlights,
  onTapHex,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const lastVpRef = useRef<{ size: number; offsetX: number; offsetY: number } | null>(null);
  const tapStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  // Resize observer to keep canvas sized to its container
  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      sizeRef.current = { w: rect.width, h: rect.height };
      draw();
    });
    ro.observe(container);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-draw on state and highlights changes
  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, perspective, highlights]);

  // Pointer handlers for tap-to-select / tap-to-queue
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    tapStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  }
  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const start = tapStartRef.current;
    tapStartRef.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dt = Date.now() - start.t;
    // Treat as tap if small movement and quick release
    if (Math.hypot(dx, dy) > 8 || dt > 500) return;
    const canvas = canvasRef.current;
    const vp = lastVpRef.current;
    if (!canvas || !vp || !onTapHex) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const hex = pixelToHex(px, py, vp);
    onTapHex(hex);
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.scale(dpr, dpr);
    // Background
    ctx.fillStyle = '#0E0F10';
    ctx.fillRect(0, 0, w, h);

    const vp = fitToViewport(state.map.tiles.keys(), w, h, 14);
    lastVpRef.current = vp;
    const { size } = vp;

    // ── Terrain tiles ────────────────────────────────────────────────────
    ctx.lineWidth = 1;
    ctx.strokeStyle = TERRAIN_STROKE;
    for (const [k, terrain] of state.map.tiles) {
      const idx = k.indexOf(',');
      const hex: Hex = { q: Number(k.slice(0, idx)), r: Number(k.slice(idx + 1)) };
      const verts = hexVertices(hex, size);
      ctx.beginPath();
      for (let i = 0; i < verts.length; i++) {
        const v = verts[i]!;
        const x = v[0] + vp.offsetX;
        const y = v[1] + vp.offsetY;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = TERRAIN_FILL[terrain];
      ctx.fill();
      ctx.stroke();

      // Highlight overlays
      if (highlights?.reachableHexes?.has(k)) {
        ctx.fillStyle = 'rgba(232, 154, 60, 0.18)'; // amber translucent
        ctx.fill();
      }
      if (highlights?.attackableHexes?.has(k)) {
        ctx.fillStyle = 'rgba(232, 74, 74, 0.22)'; // red translucent
        ctx.fill();
      }
      if (
        highlights?.selectedHex &&
        highlights.selectedHex.q === hex.q &&
        highlights.selectedHex.r === hex.r
      ) {
        ctx.lineWidth = Math.max(2, size * 0.12);
        ctx.strokeStyle = '#E89A3C';
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = TERRAIN_STROKE;
      }
    }

    // Planned move dest marker
    if (highlights?.plannedDest) {
      const c = hexCenter(highlights.plannedDest, size);
      ctx.beginPath();
      ctx.arc(c.x + vp.offsetX, c.y + vp.offsetY, size * 0.25, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1.5, size * 0.07);
      ctx.strokeStyle = '#E89A3C';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c.x + vp.offsetX, c.y + vp.offsetY, size * 0.1, 0, Math.PI * 2);
      ctx.fillStyle = '#E89A3C';
      ctx.fill();
    }
    // Planned attack target marker
    if (highlights?.plannedAttack) {
      const c = hexCenter(highlights.plannedAttack, size);
      const cx = c.x + vp.offsetX;
      const cy = c.y + vp.offsetY;
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.4, cy - size * 0.4);
      ctx.lineTo(cx + size * 0.4, cy + size * 0.4);
      ctx.moveTo(cx + size * 0.4, cy - size * 0.4);
      ctx.lineTo(cx - size * 0.4, cy + size * 0.4);
      ctx.lineWidth = Math.max(2, size * 0.1);
      ctx.strokeStyle = '#E84A4A';
      ctx.stroke();
    }

    // ── Base markers (faction-coloured rings on base tiles) ──────────────
    for (const base of state.map.startingBases) {
      const c = hexCenter(base.hex, size);
      ctx.beginPath();
      ctx.arc(c.x + vp.offsetX, c.y + vp.offsetY, size * 0.55, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1.5, size * 0.08);
      ctx.strokeStyle = base.faction === null ? NEUTRAL_RING : FACTION_COLOR[base.faction];
      ctx.stroke();
    }

    // ── Units (filtered by fog for the active perspective) ───────────────
    const fogVisible =
      perspective !== null ? visibleHexesFor(state, perspective, unitTypes) : null;

    for (const u of Object.values(state.units)) {
      const isFriendly = perspective !== null && u.faction === perspective;
      if (!isFriendly && fogVisible) {
        if (!fogVisible.has(`${u.hex.q},${u.hex.r}`)) continue; // hidden in fog
      }
      const c = hexCenter(u.hex, size);
      const cx = c.x + vp.offsetX;
      const cy = c.y + vp.offsetY;
      const radius = size * 0.42;

      // Body
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#15171A';
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, size * 0.09);
      ctx.strokeStyle = FACTION_COLOR[u.faction];
      ctx.stroke();

      // Count number
      ctx.font = `bold ${Math.max(9, size * 0.55)}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.fillStyle = FACTION_COLOR[u.faction];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(u.count), cx, cy + size * 0.04);

      // Stance pip (small dot at top of unit)
      const pipColor =
        u.stance === 'aggressive' ? '#E84A4A' :
        u.stance === 'defensive' ? '#5DBFEC' :
        '#8A8B85'; // hold-fire = muted
      ctx.beginPath();
      ctx.arc(cx, cy - radius * 1.05, Math.max(2, size * 0.1), 0, Math.PI * 2);
      ctx.fillStyle = pipColor;
      ctx.fill();
    }

    ctx.restore();
  }

  return (
    <div ref={containerRef} className="board-container">
      <canvas
        ref={canvasRef}
        className="board-canvas"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      />
    </div>
  );
}
