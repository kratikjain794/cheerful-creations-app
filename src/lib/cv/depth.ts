// Monocular depth estimation.
//
// Priority order (graceful degradation, never throws):
//   1. External depth model endpoint (Depth Anything / MiDaS style) when configured
//   2. Multi-cue CPU estimator (defocus + gradient density + vertical prior),
//      scaled by sparse triangulated points when available
//   3. Smooth planar fallback so a viewer always has geometry to show

import { boxBlur, depthToColor, sobelMagnitude } from "./image";
import type { DepthMap } from "./types";

export type SparsePoint = { u: number; v: number; z: number };

export type DepthOptions = {
  /** Optional HTTP endpoint returning a Float32 depth grid. Advanced mode only. */
  modelEndpoint?: string | null;
};

function normalize(arr: Float32Array): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }
  const range = max - min || 1;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = (arr[i] - min) / range;
  return out;
}

/** Multi-cue relative depth (0 = near, 1 = far). */
export function estimateRelativeDepth(
  gray: Float32Array,
  w: number,
  h: number,
): Float32Array {
  const edges = sobelMagnitude(gray, w, h);
  // Local texture density: sharp, textured regions are usually closer.
  const density = boxBlur(edges, w, h, Math.max(2, Math.round(Math.min(w, h) / 40)));
  const localContrast = normalize(density);
  const luminance = normalize(boxBlur(gray, w, h, 3));

  const depth = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    // Aerial/oblique prior: the top of the frame is typically farther away.
    const vertical = 1 - y / (h - 1);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const cue = 0.55 * (1 - localContrast[i]) + 0.25 * vertical + 0.2 * (1 - luminance[i]);
      depth[i] = cue;
    }
  }
  return boxBlur(normalize(depth), w, h, 2);
}

/** Fit relative depth to sparse triangulated depths (robust least squares on a*d+b). */
function scaleToSparse(
  relative: Float32Array,
  w: number,
  h: number,
  sparse: SparsePoint[],
): { depth: Float32Array; used: number } {
  const pairs: [number, number][] = [];
  for (const s of sparse) {
    const x = Math.round(s.u);
    const y = Math.round(s.v);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    if (!Number.isFinite(s.z) || s.z <= 0) continue;
    pairs.push([relative[y * w + x], s.z]);
  }
  if (pairs.length < 6) {
    const out = new Float32Array(relative.length);
    for (let i = 0; i < out.length; i++) out[i] = 2 + relative[i] * 18;
    return { depth: out, used: 0 };
  }
  const zs = pairs.map((p) => p[1]).sort((a, b) => a - b);
  const lo = zs[Math.floor(zs.length * 0.1)];
  const hi = zs[Math.floor(zs.length * 0.9)];
  const kept = pairs.filter((p) => p[1] >= lo && p[1] <= hi);
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const [d, z] of kept) {
    sx += d;
    sy += z;
    sxx += d * d;
    sxy += d * z;
  }
  const n = kept.length || 1;
  const denom = n * sxx - sx * sx;
  const a = Math.abs(denom) > 1e-9 ? (n * sxy - sx * sy) / denom : 1;
  const b = (sy - a * sx) / n;
  const out = new Float32Array(relative.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0.2, a * relative[i] + b);
  return { depth: out, used: kept.length };
}

export function colorizeDepth(
  depth: Float32Array,
  w: number,
  h: number,
): ImageData | null {
  if (typeof document === "undefined") return null;
  const norm = normalize(depth);
  const img = new ImageData(w, h);
  for (let i = 0; i < norm.length; i++) {
    const [r, g, b] = depthToColor(1 - norm[i]);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  return img;
}

async function tryModelEndpoint(
  endpoint: string,
  gray: Float32Array,
  w: number,
  h: number,
): Promise<Float32Array | null> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ width: w, height: h, gray: Array.from(gray.slice(0, 0)) }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { depth?: number[] };
    if (!json.depth || json.depth.length !== w * h) return null;
    return Float32Array.from(json.depth);
  } catch {
    return null; // Never let an unavailable model break the pipeline.
  }
}

export async function estimateDepth(
  frameIndex: number,
  gray: Float32Array,
  w: number,
  h: number,
  sparse: SparsePoint[],
  options: DepthOptions = {},
): Promise<{ map: DepthMap; source: "model" | "cpu" | "fallback" }> {
  let relative: Float32Array | null = null;
  let source: "model" | "cpu" | "fallback" = "cpu";

  if (options.modelEndpoint) {
    const modelDepth = await tryModelEndpoint(options.modelEndpoint, gray, w, h);
    if (modelDepth) {
      relative = normalize(modelDepth);
      source = "model";
    }
  }

  if (!relative) {
    try {
      relative = estimateRelativeDepth(gray, w, h);
    } catch {
      relative = new Float32Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) relative[y * w + x] = 1 - y / (h - 1);
      source = "fallback";
    }
  }

  const { depth, used } = scaleToSparse(relative, w, h, sparse);
  return {
    map: { frameIndex, width: w, height: h, depth, preview: "", sparseCount: used },
    source,
  };
}
