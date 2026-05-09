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

// Drawn-on-top overlays driven by the Replay animation loop.
export type AnimationOverlay =
  | {
      kind: 'move';
      unitId: string;
      from: Hex;
      pathTaken: Hex[];
      progress: number; // 0..1 over total path length
    }
  | {
      kind: 'flash';
      from: Hex;
      to: Hex;
      color: string;
      opacity: number; // 0..1 (fade-out)
    };

type Props = {
  state: GameState;
  unitTypes: Record<string, UnitType>;
  perspective: FactionId | null; // whose fog is applied; null = full reveal (replay)
  highlights?: Highlights;
  animationOverlay?: AnimationOverlay | null;
  onTapHex?: (hex: Hex) => void;
};

export function Board({
  state,
  unitTypes,
  perspective,
  highlights,
  animationOverlay,
  onTapHex,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const lastVpRef = useRef<{ size: number; offsetX: number; offsetY: number } | null>(null);

  // Tap / pan / pinch tracking. Refs so pointer events redraw at native rate
  // without forcing React re-renders.
  const tapStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const userScaleRef = useRef(1);
  const userPanRef = useRef({ x: 0, y: 0 });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const panRef = useRef<{ lastX: number; lastY: number } | null>(null);
  const pinchRef = useRef<
    | { startDist: number; startScale: number; pivot: { x: number; y: number } }
    | null
  >(null);

  const SCALE_MIN = 0.7;
  const SCALE_MAX = 2.5;
  const TAP_THRESHOLD_PX = 8;
  const TAP_MAX_MS = 500;

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

  // Re-draw on state, highlights, and animation overlay changes
  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, perspective, highlights, animationOverlay]);

  // ── Pointer handlers: tap / drag-pan / pinch-zoom ────────────────────────
  function localXY(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const local = localXY(e);
    pointersRef.current.set(e.pointerId, local);

    if (pointersRef.current.size === 1) {
      tapStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
      panRef.current = { lastX: local.x, lastY: local.y };
    } else if (pointersRef.current.size === 2) {
      tapStartRef.current = null;
      panRef.current = null;
      const ps = Array.from(pointersRef.current.values());
      const p1 = ps[0]!;
      const p2 = ps[1]!;
      pinchRef.current = {
        startDist: Math.hypot(p1.x - p2.x, p1.y - p2.y),
        startScale: userScaleRef.current,
        pivot: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      };
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointersRef.current.has(e.pointerId)) return;
    const local = localXY(e);
    pointersRef.current.set(e.pointerId, local);

    // Pinch-zoom (anchored at the original pinch pivot)
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const ps = Array.from(pointersRef.current.values());
      const p1 = ps[0]!;
      const p2 = ps[1]!;
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const ratio = dist / Math.max(1, pinchRef.current.startDist);
      const newScale = Math.max(
        SCALE_MIN,
        Math.min(SCALE_MAX, pinchRef.current.startScale * ratio),
      );

      const { w, h } = sizeRef.current;
      const baseVp = fitToViewport(state.map.tiles.keys(), w, h, 14);
      const oldSize = baseVp.size * userScaleRef.current;
      const oldOffsetX = baseVp.offsetX + userPanRef.current.x;
      const oldOffsetY = baseVp.offsetY + userPanRef.current.y;
      const { pivot } = pinchRef.current;
      const worldX = (pivot.x - oldOffsetX) / oldSize;
      const worldY = (pivot.y - oldOffsetY) / oldSize;
      const newSize = baseVp.size * newScale;
      userScaleRef.current = newScale;
      userPanRef.current = {
        x: pivot.x - worldX * newSize - baseVp.offsetX,
        y: pivot.y - worldY * newSize - baseVp.offsetY,
      };
      draw();
      return;
    }

    // Drag-pan with one finger (after passing the tap-vs-drag threshold)
    if (pointersRef.current.size === 1 && panRef.current) {
      const dx = local.x - panRef.current.lastX;
      const dy = local.y - panRef.current.lastY;
      panRef.current.lastX = local.x;
      panRef.current.lastY = local.y;

      const tap = tapStartRef.current;
      if (tap) {
        const adx = e.clientX - tap.x;
        const ady = e.clientY - tap.y;
        if (Math.hypot(adx, ady) > TAP_THRESHOLD_PX) tapStartRef.current = null;
      }
      if (!tapStartRef.current) {
        userPanRef.current = {
          x: userPanRef.current.x + dx,
          y: userPanRef.current.y + dy,
        };
        draw();
      }
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    pointersRef.current.delete(e.pointerId);

    if (pointersRef.current.size === 0) {
      const tap = tapStartRef.current;
      tapStartRef.current = null;
      panRef.current = null;
      pinchRef.current = null;
      if (!tap || !onTapHex) return;
      const dt = Date.now() - tap.t;
      const dx = e.clientX - tap.x;
      const dy = e.clientY - tap.y;
      if (Math.hypot(dx, dy) > TAP_THRESHOLD_PX || dt > TAP_MAX_MS) return;
      const canvas = canvasRef.current;
      const vp = lastVpRef.current;
      if (!canvas || !vp) return;
      const local = localXY(e);
      const hex = pixelToHex(local.x, local.y, vp);
      onTapHex(hex);
    } else if (pointersRef.current.size === 1) {
      // Pinch ended; remaining pointer continues as pan candidate.
      pinchRef.current = null;
      const remaining = Array.from(pointersRef.current.values())[0]!;
      panRef.current = { lastX: remaining.x, lastY: remaining.y };
      tapStartRef.current = null;
    }
  }

  function onPointerCancel(e: React.PointerEvent<HTMLCanvasElement>) {
    pointersRef.current.delete(e.pointerId);
    tapStartRef.current = null;
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) panRef.current = null;
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

    // Auto-fit baseline, then layer the user's pan/zoom transform on top.
    const baseVp = fitToViewport(state.map.tiles.keys(), w, h, 14);
    const vp = {
      size: baseVp.size * userScaleRef.current,
      offsetX: baseVp.offsetX + userPanRef.current.x,
      offsetY: baseVp.offsetY + userPanRef.current.y,
    };
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

    const animMove =
      animationOverlay?.kind === 'move' ? animationOverlay : null;

    for (const u of Object.values(state.units)) {
      const isFriendly = perspective !== null && u.faction === perspective;
      if (!isFriendly && fogVisible) {
        if (!fogVisible.has(`${u.hex.q},${u.hex.r}`)) continue; // hidden in fog
      }
      // If this unit is the one being animated, override its draw position
      // with a lerped point along the pathTaken array.
      let drawCx: number;
      let drawCy: number;
      if (animMove && animMove.unitId === u.id) {
        const { hex1, hex2, t } = lerpAlongPath(animMove.from, animMove.pathTaken, animMove.progress);
        const c1 = hexCenter(hex1, size);
        const c2 = hexCenter(hex2, size);
        drawCx = c1.x + (c2.x - c1.x) * t + vp.offsetX;
        drawCy = c1.y + (c2.y - c1.y) * t + vp.offsetY;
      } else {
        const c = hexCenter(u.hex, size);
        drawCx = c.x + vp.offsetX;
        drawCy = c.y + vp.offsetY;
      }
      const cx = drawCx;
      const cy = drawCy;
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

    // ── Attack flash overlay (on top of units) ───────────────────────────
    if (animationOverlay?.kind === 'flash' && animationOverlay.opacity > 0) {
      const c1 = hexCenter(animationOverlay.from, size);
      const c2 = hexCenter(animationOverlay.to, size);
      const x1 = c1.x + vp.offsetX;
      const y1 = c1.y + vp.offsetY;
      const x2 = c2.x + vp.offsetX;
      const y2 = c2.y + vp.offsetY;
      ctx.save();
      ctx.globalAlpha = Math.min(1, animationOverlay.opacity);
      ctx.lineWidth = Math.max(2.5, size * 0.16);
      ctx.lineCap = 'round';
      ctx.strokeStyle = animationOverlay.color;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // Bright dot at the impact point
      ctx.fillStyle = animationOverlay.color;
      ctx.beginPath();
      ctx.arc(x2, y2, Math.max(2, size * 0.18), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  function resetView() {
    userScaleRef.current = 1;
    userPanRef.current = { x: 0, y: 0 };
    draw();
  }

  return (
    <div ref={containerRef} className="board-container">
      <canvas
        ref={canvasRef}
        className="board-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
      <button
        type="button"
        className="board-reset-view"
        onClick={resetView}
        aria-label="Reset zoom and pan"
        title="Reset view"
      >
        ⟲
      </button>
    </div>
  );
}

// Resolve a progress value (0..1) along a pathTaken array starting from `from`
// into a (hex1, hex2, t) triplet for hex-center interpolation.
function lerpAlongPath(
  from: Hex,
  path: Hex[],
  progress: number,
): { hex1: Hex; hex2: Hex; t: number } {
  if (path.length === 0) return { hex1: from, hex2: from, t: 0 };
  const clamped = Math.min(1, Math.max(0, progress));
  const total = path.length;
  const fp = clamped * total;
  const idx = Math.min(Math.floor(fp), total - 1);
  const t = Math.min(1, fp - idx);
  const hex1 = idx === 0 ? from : path[idx - 1]!;
  const hex2 = path[idx]!;
  return { hex1, hex2, t };
}
