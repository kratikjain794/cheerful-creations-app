// ORB-style feature pipeline: FAST-like corner detection, oriented BRIEF
// descriptors, Hamming matching with Lowe's ratio test and RANSAC filtering.

import type { FeatureSet, Keypoint, MatchPair, MatchResult } from "./types";

const PATCH = 15; // BRIEF sampling radius
const DESC_BITS = 256;
const DESC_WORDS = DESC_BITS / 32;

// Deterministic BRIEF sampling pattern (Gaussian-ish pairs inside the patch).
const PATTERN = (() => {
  let seed = 20260904;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const gauss = () => {
    const u = Math.max(1e-6, rnd());
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const pts = new Int8Array(DESC_BITS * 4);
  for (let i = 0; i < DESC_BITS; i++) {
    for (let k = 0; k < 4; k++) {
      pts[i * 4 + k] = Math.max(-PATCH, Math.min(PATCH, Math.round(gauss() * (PATCH / 2.5))));
    }
  }
  return pts;
})();

const FAST_OFFSETS: [number, number][] = [
  [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3],
  [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3],
];

/** FAST-9 corner detection with non-maximum suppression. */
export function detectCorners(
  gray: Float32Array,
  w: number,
  h: number,
  threshold = 18,
  maxCorners = 900,
): Keypoint[] {
  const margin = PATCH + 4;
  const scores = new Float32Array(w * h);
  const candidates: Keypoint[] = [];

  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const i = y * w + x;
      const p = gray[i];
      // Quick rejection on the 4 compass points.
      let bright = 0;
      let dark = 0;
      for (const k of [0, 4, 8, 12]) {
        const o = FAST_OFFSETS[k];
        const v = gray[(y + o[1]) * w + (x + o[0])];
        if (v > p + threshold) bright++;
        else if (v < p - threshold) dark++;
      }
      if (bright < 3 && dark < 3) continue;

      // Full ring test: 9 contiguous pixels brighter or darker.
      let runB = 0;
      let runD = 0;
      let maxB = 0;
      let maxD = 0;
      let sum = 0;
      for (let k = 0; k < 24; k++) {
        const o = FAST_OFFSETS[k % 16];
        const v = gray[(y + o[1]) * w + (x + o[0])];
        const d = v - p;
        sum += Math.abs(d);
        if (d > threshold) {
          runB++;
          maxB = Math.max(maxB, runB);
          runD = 0;
        } else if (d < -threshold) {
          runD++;
          maxD = Math.max(maxD, runD);
          runB = 0;
        } else {
          runB = 0;
          runD = 0;
        }
      }
      if (maxB >= 9 || maxD >= 9) {
        scores[i] = sum / 24;
        candidates.push({ x, y, score: sum / 24 });
      }
    }
  }

  // Non-maximum suppression in a 5x5 window.
  const kept: Keypoint[] = [];
  for (const c of candidates) {
    const i = c.y * w + c.x;
    let isMax = true;
    for (let dy = -2; dy <= 2 && isMax; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (!dx && !dy) continue;
        if (scores[i + dy * w + dx] > c.score) {
          isMax = false;
          break;
        }
      }
    }
    if (isMax) kept.push(c);
  }

  kept.sort((a, b) => b.score - a.score);
  return kept.slice(0, maxCorners);
}

function patchOrientation(gray: Float32Array, w: number, x: number, y: number): number {
  let m01 = 0;
  let m10 = 0;
  for (let dy = -PATCH; dy <= PATCH; dy++) {
    for (let dx = -PATCH; dx <= PATCH; dx++) {
      const v = gray[(y + dy) * w + (x + dx)];
      m10 += dx * v;
      m01 += dy * v;
    }
  }
  return Math.atan2(m01, m10);
}

/** Oriented BRIEF (rBRIEF) descriptors, 256 bits per keypoint. */
export function computeDescriptors(
  gray: Float32Array,
  w: number,
  h: number,
  keypoints: Keypoint[],
): Uint32Array {
  const out = new Uint32Array(keypoints.length * DESC_WORDS);
  for (let k = 0; k < keypoints.length; k++) {
    const kp = keypoints[k];
    const angle = patchOrientation(gray, w, kp.x, kp.y);
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    for (let b = 0; b < DESC_BITS; b++) {
      const ax = PATTERN[b * 4];
      const ay = PATTERN[b * 4 + 1];
      const bx = PATTERN[b * 4 + 2];
      const by = PATTERN[b * 4 + 3];
      const rax = Math.round(ca * ax - sa * ay);
      const ray = Math.round(sa * ax + ca * ay);
      const rbx = Math.round(ca * bx - sa * by);
      const rby = Math.round(sa * bx + ca * by);
      const px = Math.min(w - 1, Math.max(0, kp.x + rax));
      const py = Math.min(h - 1, Math.max(0, kp.y + ray));
      const qx = Math.min(w - 1, Math.max(0, kp.x + rbx));
      const qy = Math.min(h - 1, Math.max(0, kp.y + rby));
      if (gray[py * w + px] < gray[qy * w + qx]) {
        out[k * DESC_WORDS + (b >> 5)] |= 1 << (b & 31);
      }
    }
  }
  return out;
}

export function extractFeatures(
  frameIndex: number,
  gray: Float32Array,
  w: number,
  h: number,
  maxCorners = 900,
): FeatureSet {
  const keypoints = detectCorners(gray, w, h, 18, maxCorners);
  const descriptors = computeDescriptors(gray, w, h, keypoints);
  return { frameIndex, keypoints, descriptors };
}

function popcount(v: number): number {
  v = v - ((v >> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  return (((v + (v >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

function hamming(a: Uint32Array, ai: number, b: Uint32Array, bi: number): number {
  let d = 0;
  for (let i = 0; i < DESC_WORDS; i++) {
    d += popcount((a[ai * DESC_WORDS + i] ^ b[bi * DESC_WORDS + i]) >>> 0);
  }
  return d;
}

/** Brute-force Hamming matching with Lowe's ratio test and cross-check. */
export function matchFeatures(A: FeatureSet, B: FeatureSet, ratio = 0.8): MatchPair[] {
  const matches: MatchPair[] = [];
  const bestForB = new Map<number, { a: number; d: number }>();

  for (let i = 0; i < A.keypoints.length; i++) {
    let best = Infinity;
    let second = Infinity;
    let bestIdx = -1;
    for (let j = 0; j < B.keypoints.length; j++) {
      const d = hamming(A.descriptors, i, B.descriptors, j);
      if (d < best) {
        second = best;
        best = d;
        bestIdx = j;
      } else if (d < second) {
        second = d;
      }
    }
    if (bestIdx >= 0 && best < ratio * second && best < 90) {
      const prev = bestForB.get(bestIdx);
      if (!prev || best < prev.d) bestForB.set(bestIdx, { a: i, d: best });
    }
  }
  for (const [b, v] of bestForB) matches.push({ a: v.a, b, distance: v.d });
  return matches;
}

/** RANSAC over a similarity transform (scale + rotation + translation). */
export function ransacSimilarity(
  A: FeatureSet,
  B: FeatureSet,
  matches: MatchPair[],
  iterations = 400,
  tolerance = 4,
): MatchResult {
  let bestInliers: MatchPair[] = [];
  let bestModel = { scale: 1, rotation: 0, tx: 0, ty: 0 };
  if (matches.length < 3) {
    return {
      fromIndex: A.frameIndex,
      toIndex: B.frameIndex,
      rawMatches: matches.length,
      inliers: matches,
      model: bestModel,
    };
  }

  for (let it = 0; it < iterations; it++) {
    const m1 = matches[Math.floor(Math.random() * matches.length)];
    const m2 = matches[Math.floor(Math.random() * matches.length)];
    if (m1 === m2) continue;
    const p1 = A.keypoints[m1.a];
    const p2 = A.keypoints[m2.a];
    const q1 = B.keypoints[m1.b];
    const q2 = B.keypoints[m2.b];
    const dp = [p2.x - p1.x, p2.y - p1.y];
    const dq = [q2.x - q1.x, q2.y - q1.y];
    const np = Math.hypot(dp[0], dp[1]);
    const nq = Math.hypot(dq[0], dq[1]);
    if (np < 5 || nq < 5) continue;
    const scale = nq / np;
    const rotation = Math.atan2(dq[1], dq[0]) - Math.atan2(dp[1], dp[0]);
    const c = Math.cos(rotation) * scale;
    const s = Math.sin(rotation) * scale;
    const tx = q1.x - (c * p1.x - s * p1.y);
    const ty = q1.y - (s * p1.x + c * p1.y);

    const inliers: MatchPair[] = [];
    for (const m of matches) {
      const p = A.keypoints[m.a];
      const q = B.keypoints[m.b];
      const px = c * p.x - s * p.y + tx;
      const py = s * p.x + c * p.y + ty;
      if (Math.hypot(px - q.x, py - q.y) < tolerance) inliers.push(m);
    }
    if (inliers.length > bestInliers.length) {
      bestInliers = inliers;
      bestModel = { scale, rotation, tx, ty };
    }
  }

  return {
    fromIndex: A.frameIndex,
    toIndex: B.frameIndex,
    rawMatches: matches.length,
    inliers: bestInliers,
    model: bestModel,
  };
}
