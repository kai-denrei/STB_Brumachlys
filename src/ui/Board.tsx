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
  TerrainKey,
} from '../core/types.ts';

const FACTION_COLOR: Record<FactionId, string> = {
  0: '#E89A3C', // Ember Amber
  1: '#3FB7B0', // Iron Teal
};
const NEUTRAL_RING = '#5A5A55';

// Single-letter abbreviations for unit types — placeholder identity until
// per-type sprites land. Falls back to the first letter of the type key for
// any new unit type that isn't explicitly listed.
const TYPE_LETTER: Record<string, string> = {
  infantry: 'I',
  tank: 'T',
};

// Texture variant keys → file paths under public/textures/. Base tiles pick a
// variant by faction so the village art reflects ownership at a glance.
const SQRT3 = Math.sqrt(3);
const TEXTURE_PATHS: Record<string, string> = {
  plains: 'textures/plains.jpg',
  swamp: 'textures/swamp.jpg',
  woods: 'textures/woods.jpg',
  mountains: 'textures/mountains.jpg',
  water: 'textures/water.jpg',
  'base-neutral': 'textures/base-neutral.jpg',
  'base-f0': 'textures/base-f0.jpg',
  'base-f1': 'textures/base-f1.jpg',
};

function textureKeyForTile(
  terrain: TerrainKey,
  hex: Hex,
  startingBases: GameState['map']['startingBases'],
): string {
  if (terrain !== 'base') return terrain;
  const base = startingBases.find(
    (b) => b.hex.q === hex.q && b.hex.r === hex.r,
  );
  if (!base || base.faction === null) return 'base-neutral';
  return base.faction === 0 ? 'base-f0' : 'base-f1';
}

// Source images are 2×2 grids of four watercolour variants. We pick one
// quadrant per hex so neighbouring tiles show different art. Hash on (q, r)
// so the same hex picks the same quadrant across redraws — otherwise the
// art would reshuffle on every pan/zoom redraw.
//   bit 0 → x (0 = left, 1 = right)
//   bit 1 → y (0 = top,  1 = bottom)
function quadrantForHex(q: number, r: number): 0 | 1 | 2 | 3 {
  const h = ((q * 73856093) ^ (r * 19349663)) >>> 0;
  return (h & 3) as 0 | 1 | 2 | 3;
}

type Highlights = {
  selectedHex?: Hex | null;
  reachableHexes?: Set<string>;     // for movement preview
  attackableHexes?: Set<string>;    // for attack preview (enemy hexes)
  // One [unit.hex, ...moveOrder.path] per queued move. Drawn as dotted line +
  // arrowhead per path. Iterating over all queued orders (not just the
  // selected unit's) keeps the visualisation alive after queue → deselect.
  plannedPaths?: Hex[][] | null;
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
  // Three-tier fog: a hex is `live` if currentVisible.has(k), `memory` if only
  // discovered.has(k), and `dark` otherwise. Both default to undefined which
  // disables fog tiers entirely (used by replay for full reveal).
  currentVisible?: Set<string>;
  discovered?: Set<string>;
  highlights?: Highlights;
  animationOverlay?: AnimationOverlay | null;
  onTapHex?: (hex: Hex) => void;
};

export function Board({
  state,
  unitTypes,
  perspective,
  currentVisible,
  discovered,
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

  const texturesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Preload terrain/base textures once on mount. Each load triggers a redraw so
  // the board fills in progressively without blocking first paint.
  useEffect(() => {
    const baseUrl = import.meta.env.BASE_URL ?? '/';
    for (const [key, path] of Object.entries(TEXTURE_PATHS)) {
      const img = new Image();
      img.src = `${baseUrl}${path}`;
      img.onload = () => {
        texturesRef.current.set(key, img);
        draw();
      };
      img.onerror = () => {
        console.warn(`[brumachlys] texture failed to load: ${path}`);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Re-draw on state, highlights, fog, and animation overlay changes
  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, perspective, currentVisible, discovered, highlights, animationOverlay]);

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
    // Each tile is built as a Path2D so we can fill, clip-and-drawImage, and
    // stroke against the same shape without re-pathing. Three-tier fog is
    // applied per-tile when both currentVisible and discovered are provided
    // (i.e. during planning); replay passes neither so all tiles render live.
    ctx.lineWidth = 1;
    ctx.strokeStyle = TERRAIN_STROKE;
    const hexW = SQRT3 * size;
    const hexH = 2 * size;
    const fogActive = !!(currentVisible || discovered);
    for (const [k, terrain] of state.map.tiles) {
      const idx = k.indexOf(',');
      const hex: Hex = { q: Number(k.slice(0, idx)), r: Number(k.slice(idx + 1)) };
      const verts = hexVertices(hex, size);
      const path = new Path2D();
      for (let i = 0; i < verts.length; i++) {
        const v = verts[i]!;
        const x = v[0] + vp.offsetX;
        const y = v[1] + vp.offsetY;
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      path.closePath();

      // Resolve the visibility tier. Without fogActive everything is `live`.
      const inVisible = !fogActive || (currentVisible?.has(k) ?? false);
      const inDiscovered = !fogActive || (discovered?.has(k) ?? false);
      const tier: 'live' | 'memory' | 'dark' =
        inVisible ? 'live' : inDiscovered ? 'memory' : 'dark';

      if (tier !== 'dark') {
        // Fallback flat fill (visible until the texture for this biome arrives).
        ctx.fillStyle = TERRAIN_FILL[terrain];
        ctx.fill(path);

        // Texture overlay clipped to the hex. The source asset is a 2×2 grid
        // of four variants; sample one quadrant deterministically per hex so
        // neighbouring tiles look different but each tile stays stable across
        // redraws (panning/zooming doesn't reshuffle).
        const texKey = textureKeyForTile(terrain, hex, state.map.startingBases);
        const tex = texturesRef.current.get(texKey);
        if (tex && tex.complete && tex.naturalWidth > 0) {
          const c = hexCenter(hex, size);
          const halfW = tex.naturalWidth / 2;
          const halfH = tex.naturalHeight / 2;
          const q4 = quadrantForHex(hex.q, hex.r);
          const sx = (q4 & 1) * halfW;
          const sy = ((q4 >> 1) & 1) * halfH;
          ctx.save();
          ctx.clip(path);
          ctx.drawImage(
            tex,
            sx, sy, halfW, halfH,
            c.x + vp.offsetX - hexW / 2,
            c.y + vp.offsetY - size,
            hexW,
            hexH,
          );
          ctx.restore();
        }

        // Inter-tile hairline.
        ctx.stroke(path);

        // Memory dim: 0.55-alpha black overlay covers texture + stroke uniformly.
        if (tier === 'memory') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
          ctx.fill(path);
        }
      }
      // tier === 'dark': skip texture/stroke entirely; bg #0E0F10 shows through.

      // Highlight overlays. Reachable can paint over any tier (DECISIONS §B.5
      // — planner trusts last-known terrain). Attackable only ever lands on
      // a currentVisible tile by construction in App.tsx. Selection is on the
      // selected friendly unit which is always in current vision.
      if (highlights?.reachableHexes?.has(k)) {
        ctx.fillStyle = 'rgba(232, 154, 60, 0.28)'; // amber translucent
        ctx.fill(path);
      }
      if (highlights?.attackableHexes?.has(k)) {
        ctx.fillStyle = 'rgba(232, 74, 74, 0.32)'; // red translucent
        ctx.fill(path);
      }
      if (
        highlights?.selectedHex &&
        highlights.selectedHex.q === hex.q &&
        highlights.selectedHex.r === hex.r
      ) {
        ctx.lineWidth = Math.max(2, size * 0.12);
        ctx.strokeStyle = '#E89A3C';
        ctx.stroke(path);
        ctx.lineWidth = 1;
        ctx.strokeStyle = TERRAIN_STROKE;
      }
    }

    // Planned-move path: per queued move order, a dotted polyline of small
    // filled discs ending in a filled-triangle arrowhead at the destination.
    // Rendered at full opacity over fog (intent UI is not terrain — the
    // planner needs to see their own queued order). Each disc and the
    // arrowhead get a 1px solid-black outline at full alpha so the faction
    // colour stays readable against varied watercolour terrain.
    if (
      perspective !== null &&
      highlights?.plannedPaths &&
      highlights.plannedPaths.length > 0
    ) {
      const PATH_OPACITY = 0.7;
      const DISC_R = Math.max(1.5, size * 0.06);
      const DISC_SPACING = size * 0.32;
      const ARROW_LEN = size * 0.5;
      const ARROW_HALF_W = size * 0.16;
      const colour = FACTION_COLOR[perspective];

      ctx.save();
      ctx.fillStyle = colour;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;

      for (const pp of highlights.plannedPaths) {
        if (pp.length < 2) continue;

        // Walk each segment, placing discs at uniform pixel spacing across
        // the whole polyline (`leftover` carries fractional spacing across
        // joins so discs don't bunch at hex centres).
        let leftover = 0;
        for (let i = 0; i < pp.length - 1; i++) {
          const a = hexCenter(pp[i]!, size);
          const b = hexCenter(pp[i + 1]!, size);
          const ax = a.x + vp.offsetX;
          const ay = a.y + vp.offsetY;
          const bx = b.x + vp.offsetX;
          const by = b.y + vp.offsetY;
          const dx = bx - ax;
          const dy = by - ay;
          const segLen = Math.hypot(dx, dy);
          if (segLen === 0) continue;
          const ux = dx / segLen;
          const uy = dy / segLen;
          let t = i === 0 ? 0 : leftover;
          while (t <= segLen) {
            ctx.beginPath();
            ctx.arc(ax + ux * t, ay + uy * t, DISC_R, 0, Math.PI * 2);
            ctx.globalAlpha = PATH_OPACITY;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.stroke();
            t += DISC_SPACING;
          }
          leftover = t - segLen;
        }

        // Arrowhead: filled triangle whose tip lands at the destination hex
        // centre, oriented along the last segment.
        const tip = hexCenter(pp[pp.length - 1]!, size);
        const prev = hexCenter(pp[pp.length - 2]!, size);
        const tipX = tip.x + vp.offsetX;
        const tipY = tip.y + vp.offsetY;
        const prevX = prev.x + vp.offsetX;
        const prevY = prev.y + vp.offsetY;
        const adx = tipX - prevX;
        const ady = tipY - prevY;
        const aLen = Math.hypot(adx, ady);
        if (aLen > 0) {
          const aux = adx / aLen;
          const auy = ady / aLen;
          const baseX = tipX - aux * ARROW_LEN;
          const baseY = tipY - auy * ARROW_LEN;
          // Perpendicular for the wings (right-hand rotation of the segment)
          const px = -auy;
          const py = aux;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(baseX + px * ARROW_HALF_W, baseY + py * ARROW_HALF_W);
          ctx.lineTo(baseX - px * ARROW_HALF_W, baseY - py * ARROW_HALF_W);
          ctx.closePath();
          ctx.globalAlpha = PATH_OPACITY;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.stroke();
        }
      }

      ctx.restore();
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

    // ── Base markers (thin faction-coloured rings as a fallback signal) ──
    // The village texture already encodes ownership; the ring stays for
    // legibility on small hexes and during first-load (before textures).
    // Tier-aware: skip on dark, dim on memory, full on live.
    for (const base of state.map.startingBases) {
      const bk = `${base.hex.q},${base.hex.r}`;
      const baseInVisible = !fogActive || (currentVisible?.has(bk) ?? false);
      const baseInDiscovered = !fogActive || (discovered?.has(bk) ?? false);
      if (!baseInVisible && !baseInDiscovered) continue;
      const c = hexCenter(base.hex, size);
      ctx.save();
      if (!baseInVisible) ctx.globalAlpha = 0.45; // memory dim, matches tile overlay
      ctx.beginPath();
      ctx.arc(c.x + vp.offsetX, c.y + vp.offsetY, size * 0.6, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1, size * 0.05);
      ctx.strokeStyle = base.faction === null ? NEUTRAL_RING : FACTION_COLOR[base.faction];
      ctx.stroke();
      ctx.restore();
    }

    // ── Units (filtered by fog) ──────────────────────────────────────────
    // Prefer the explicit `currentVisible` prop (used by both planning and
    // the replay union-fog). Fall back to recomputing from `perspective` for
    // any caller that omits the prop. Friendly units (during planning, when
    // a perspective is set) always render; everything else needs to be in
    // the visible set or it's hidden by fog.
    const fogFilter =
      currentVisible ??
      (perspective !== null ? visibleHexesFor(state, perspective, unitTypes) : null);

    const animMove =
      animationOverlay?.kind === 'move' ? animationOverlay : null;

    for (const u of Object.values(state.units)) {
      const isFriendly = perspective !== null && u.faction === perspective;
      if (!isFriendly && fogFilter) {
        if (!fogFilter.has(`${u.hex.q},${u.hex.r}`)) continue; // hidden in fog
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

      // Type letter (placeholder until per-type sprites land) above the count.
      ctx.fillStyle = FACTION_COLOR[u.faction];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const letter = TYPE_LETTER[u.type] ?? u.type[0]?.toUpperCase() ?? '?';
      ctx.font = `bold ${Math.max(9, size * 0.42)}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.fillText(letter, cx, cy - size * 0.14);

      // Count number
      ctx.font = `bold ${Math.max(7, size * 0.30)}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.fillText(String(u.count), cx, cy + size * 0.22);

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
