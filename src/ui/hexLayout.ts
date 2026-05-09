// Pure pixel math for pointy-top, odd-r offset hex grids.
// Coordinates flow:  hex {q, r}  →  world (px)  →  apply (scale, offset)  →  canvas (px)

import type { Hex } from '../core/types.ts';

export type Viewport = {
  size: number;     // hex circumradius in world pixels (vertex distance from center)
  offsetX: number;  // world → canvas translate (px)
  offsetY: number;
};

const SQRT3 = Math.sqrt(3);

// Center of a hex in world pixels (no offset/scale applied).
export function hexCenter(h: Hex, size: number): { x: number; y: number } {
  return {
    x: size * SQRT3 * (h.q + 0.5 * (h.r & 1)),
    y: size * 1.5 * h.r,
  };
}

// 6 vertices of a pointy-top hex in world pixels.
export function hexVertices(h: Hex, size: number): Array<[number, number]> {
  const c = hexCenter(h, size);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30); // -30, 30, 90, 150, 210, 270
    out.push([c.x + size * Math.cos(angle), c.y + size * Math.sin(angle)]);
  }
  return out;
}

// Project a hex center to canvas pixels with a viewport's scale and offset applied.
export function projectHex(h: Hex, vp: Viewport): { x: number; y: number } {
  const c = hexCenter(h, vp.size);
  return { x: c.x + vp.offsetX, y: c.y + vp.offsetY };
}

// Inverse projection: canvas pixel → fractional axial → rounded hex.
export function pixelToHex(px: number, py: number, vp: Viewport): Hex {
  const x = (px - vp.offsetX) / vp.size;
  const y = (py - vp.offsetY) / vp.size;
  // Inverse of pointy-top axial→pixel:
  const fq = (SQRT3 / 3) * x - (1 / 3) * y;
  const fr = (2 / 3) * y;
  return cubeRound(fq, fr);
}

// Round fractional axial to the nearest hex via cube-coordinate rounding.
function cubeRound(fq: number, fr: number): Hex {
  const fx = fq;
  const fz = fr;
  const fy = -fx - fz;
  let rx = Math.round(fx);
  let ry = Math.round(fy);
  let rz = Math.round(fz);
  const dx = Math.abs(rx - fx);
  const dy = Math.abs(ry - fy);
  const dz = Math.abs(rz - fz);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  // axial → odd-r offset
  const r = rz;
  const q = rx + (rz - (rz & 1)) / 2;
  return { q, r };
}

// Compute a viewport that fits the given set of hex keys ("q,r") into (canvasW, canvasH).
export function fitToViewport(
  tileKeys: Iterable<string>,
  canvasW: number,
  canvasH: number,
  padding = 12,
): Viewport {
  let qmin = Infinity;
  let qmax = -Infinity;
  let rmin = Infinity;
  let rmax = -Infinity;
  for (const k of tileKeys) {
    const idx = k.indexOf(',');
    if (idx < 0) continue;
    const q = Number(k.slice(0, idx));
    const r = Number(k.slice(idx + 1));
    if (q < qmin) qmin = q;
    if (q > qmax) qmax = q;
    if (r < rmin) rmin = r;
    if (r > rmax) rmax = r;
  }
  if (!isFinite(qmin)) return { size: 20, offsetX: 0, offsetY: 0 };

  // Dimensions at size = 1:
  //   width  = (qmax - qmin) * sqrt(3) + sqrt(3)         [end hex span]
  //          + sqrt(3) / 2                                [odd-row offset margin]
  //   height = (rmax - rmin) * 1.5 + 2
  const dq = qmax - qmin;
  const dr = rmax - rmin;
  const widthAt1 = dq * SQRT3 + SQRT3 + SQRT3 / 2;
  const heightAt1 = dr * 1.5 + 2;

  const sizeForW = (canvasW - 2 * padding) / widthAt1;
  const sizeForH = (canvasH - 2 * padding) / heightAt1;
  const size = Math.max(6, Math.min(sizeForW, sizeForH));

  // Pixel center of the top-left hex at this size:
  const topLeftCenter = hexCenter({ q: qmin, r: rmin }, size);
  // We want the hex's left vertex to land at `padding`. Pointy-top hex's left vertex
  // is `size * sqrt(3) / 2` left of center.
  const offsetX = padding - topLeftCenter.x + size * SQRT3 / 2;
  // Top vertex is `size` above the center.
  const offsetY = padding - topLeftCenter.y + size;

  return { size, offsetX, offsetY };
}
