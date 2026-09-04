// Camera pose estimation: normalized 8-point essential matrix with RANSAC,
// SVD decomposition into (R, t) and a cheirality check, then chained into a
// camera trajectory. Equivalent to OpenCV findEssentialMat + recoverPose.

import { det3, matMul3, matT3, matVec3, nullSpace, svd3, type Mat3 } from "./math";
import type { FeatureSet, MatchPair } from "./types";

export type Intrinsics = { fx: number; fy: number; cx: number; cy: number };

export function defaultIntrinsics(width: number, height: number): Intrinsics {
  // ~73 deg horizontal FOV, a reasonable default for consumer drone cameras.
  const fx = width / (2 * Math.tan((73 * Math.PI) / 180 / 2));
  return { fx, fy: fx, cx: width / 2, cy: height / 2 };
}

type Pt = { x: number; y: number };

function normalizePoints(pts: Pt[], K: Intrinsics): Pt[] {
  return pts.map((p) => ({ x: (p.x - K.cx) / K.fx, y: (p.y - K.cy) / K.fy }));
}

function eightPoint(p1: Pt[], p2: Pt[]): Mat3 {
  const n = p1.length;
  const A: number[] = new Array(n * 9);
  for (let i = 0; i < n; i++) {
    const a = p1[i];
    const b = p2[i];
    A[i * 9 + 0] = b.x * a.x;
    A[i * 9 + 1] = b.x * a.y;
    A[i * 9 + 2] = b.x;
    A[i * 9 + 3] = b.y * a.x;
    A[i * 9 + 4] = b.y * a.y;
    A[i * 9 + 5] = b.y;
    A[i * 9 + 6] = a.x;
    A[i * 9 + 7] = a.y;
    A[i * 9 + 8] = 1;
  }
  const e = nullSpace(A, n, 9) as Mat3;
  // Enforce the essential-matrix constraint: singular values (1, 1, 0).
  const { U, V } = svd3(e);
  const D: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 0];
  return matMul3(matMul3(U, D), matT3(V));
}

function sampsonError(E: Mat3, a: Pt, b: Pt): number {
  const x1: [number, number, number] = [a.x, a.y, 1];
  const x2: [number, number, number] = [b.x, b.y, 1];
  const Ex1 = matVec3(E, x1);
  const Etx2 = matVec3(matT3(E), x2);
  const num = x2[0] * Ex1[0] + x2[1] * Ex1[1] + x2[2] * Ex1[2];
  const den = Ex1[0] * Ex1[0] + Ex1[1] * Ex1[1] + Etx2[0] * Etx2[0] + Etx2[1] * Etx2[1];
  return den > 1e-12 ? (num * num) / den : Infinity;
}

export function findEssentialMatrix(
  p1: Pt[],
  p2: Pt[],
  K: Intrinsics,
  iterations = 300,
  threshold = 1e-5,
): { E: Mat3; inliers: number[] } | null {
  if (p1.length < 8) return null;
  const n1 = normalizePoints(p1, K);
  const n2 = normalizePoints(p2, K);
  let bestE: Mat3 | null = null;
  let bestInliers: number[] = [];

  for (let it = 0; it < iterations; it++) {
    const idx: number[] = [];
    while (idx.length < 8) {
      const r = Math.floor(Math.random() * n1.length);
      if (!idx.includes(r)) idx.push(r);
    }
    let E: Mat3;
    try {
      E = eightPoint(
        idx.map((i) => n1[i]),
        idx.map((i) => n2[i]),
      );
    } catch {
      continue;
    }
    const inliers: number[] = [];
    for (let i = 0; i < n1.length; i++) {
      if (sampsonError(E, n1[i], n2[i]) < threshold) inliers.push(i);
    }
    if (inliers.length > bestInliers.length) {
      bestInliers = inliers;
      bestE = E;
    }
  }

  if (!bestE || bestInliers.length < 8) return null;
  // Refit on all inliers.
  const refined = eightPoint(
    bestInliers.map((i) => n1[i]),
    bestInliers.map((i) => n2[i]),
  );
  return { E: refined, inliers: bestInliers };
}

function triangulateDepth(R: Mat3, t: number[], a: Pt, b: Pt): { z1: number; z2: number } {
  // Linear triangulation of the ray intersection (mid-point method).
  const d1: [number, number, number] = [a.x, a.y, 1];
  const d2raw: [number, number, number] = [b.x, b.y, 1];
  const Rt = matT3(R);
  const d2 = matVec3(Rt, d2raw); // direction of cam2 ray in cam1 frame
  const c2 = matVec3(Rt, [-t[0], -t[1], -t[2]]); // cam2 center in cam1 frame

  const a11 = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2];
  const a12 = -(d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]);
  const a22 = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2];
  const b1 = d1[0] * c2[0] + d1[1] * c2[1] + d1[2] * c2[2];
  const b2 = -(d2[0] * c2[0] + d2[1] * c2[1] + d2[2] * c2[2]);
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-12) return { z1: -1, z2: -1 };
  const s1 = (b1 * a22 - a12 * b2) / det;
  const s2 = (a11 * b2 - a12 * b1) / det;
  const X: [number, number, number] = [d1[0] * s1, d1[1] * s1, d1[2] * s1];
  const Xc2 = matVec3(R, X);
  return { z1: X[2], z2: Xc2[2] + t[2] };
}

/** recoverPose: pick the (R, t) pair with the most points in front of both cameras. */
export function recoverPose(
  E: Mat3,
  p1: Pt[],
  p2: Pt[],
  K: Intrinsics,
): { R: Mat3; t: number[]; inlierCount: number } | null {
  const { U, V } = svd3(E);
  const W: Mat3 = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  let R1 = matMul3(matMul3(U, W), matT3(V));
  let R2 = matMul3(matMul3(U, matT3(W)), matT3(V));
  if (det3(R1) < 0) R1 = R1.map((x) => -x);
  if (det3(R2) < 0) R2 = R2.map((x) => -x);
  const t1 = [U[2], U[5], U[8]];
  const t2 = t1.map((x) => -x);

  const n1 = normalizePoints(p1, K);
  const n2 = normalizePoints(p2, K);
  const candidates: { R: Mat3; t: number[] }[] = [
    { R: R1, t: t1 },
    { R: R1, t: t2 },
    { R: R2, t: t1 },
    { R: R2, t: t2 },
  ];

  let best: { R: Mat3; t: number[]; inlierCount: number } | null = null;
  for (const c of candidates) {
    let count = 0;
    for (let i = 0; i < n1.length; i++) {
      const { z1, z2 } = triangulateDepth(c.R, c.t, n1[i], n2[i]);
      if (z1 > 0 && z2 > 0) count++;
    }
    if (!best || count > best.inlierCount) best = { R: c.R, t: c.t, inlierCount: count };
  }
  return best;
}

/** Triangulated 3D points (in camera-1 frame) for a verified pose. */
export function triangulatePoints(
  R: Mat3,
  t: number[],
  p1: Pt[],
  p2: Pt[],
  K: Intrinsics,
): { x: number; y: number; z: number; u: number; v: number }[] {
  const n1 = normalizePoints(p1, K);
  const n2 = normalizePoints(p2, K);
  const out: { x: number; y: number; z: number; u: number; v: number }[] = [];
  for (let i = 0; i < n1.length; i++) {
    const { z1, z2 } = triangulateDepth(R, t, n1[i], n2[i]);
    if (z1 > 0 && z2 > 0 && Number.isFinite(z1) && z1 < 200) {
      out.push({ x: n1[i].x * z1, y: n1[i].y * z1, z: z1, u: p1[i].x, v: p1[i].y });
    }
  }
  return out;
}

export function matchedPoints(
  A: FeatureSet,
  B: FeatureSet,
  matches: MatchPair[],
): { p1: Pt[]; p2: Pt[] } {
  const p1: Pt[] = [];
  const p2: Pt[] = [];
  for (const m of matches) {
    p1.push({ x: A.keypoints[m.a].x, y: A.keypoints[m.a].y });
    p2.push({ x: B.keypoints[m.b].x, y: B.keypoints[m.b].y });
  }
  return { p1, p2 };
}

export function rotationToYaw(R: Mat3): number {
  return Math.atan2(R[6], R[8]);
}
