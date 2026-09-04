// Frame quality scoring and adaptive keyframe selection.

import { brightnessStats, frameDifference, laplacianVariance } from "./image";
import { detectCorners } from "./features";
import type { FrameQuality, GrayFrame } from "./types";

export type QualityThresholds = {
  minSharpness: number; // reject blurry frames below this Laplacian variance
  minBrightness: number;
  maxBrightness: number;
  minMotion: number; // reject redundant frames
  minFeatures: number;
  maxKeyframes: number;
};

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  minSharpness: 12,
  minBrightness: 28,
  maxBrightness: 232,
  minMotion: 1.2,
  minFeatures: 60,
  maxKeyframes: 24,
};

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

export function analyzeFrames(
  frames: GrayFrame[],
  thresholds: QualityThresholds,
  onProgress?: (done: number, total: number) => void,
): FrameQuality[] {
  const results: FrameQuality[] = [];
  let prev: GrayFrame | null = null;

  frames.forEach((frame, i) => {
    const sharpness = laplacianVariance(frame.gray, frame.width, frame.height);
    const { mean, std } = brightnessStats(frame.gray);
    const featureCount = detectCorners(frame.gray, frame.width, frame.height, 18, 1200).length;
    const motion = prev ? frameDifference(frame.gray, prev.gray) : Number.POSITIVE_INFINITY;

    const sharpScore = clamp01(Math.log10(1 + sharpness) / 2.7);
    const brightScore = 1 - clamp01(Math.abs(mean - 128) / 128);
    const contrastScore = clamp01(std / 70);
    const featureScore = clamp01(featureCount / 600);
    const motionScore = Number.isFinite(motion) ? clamp01(motion / 22) : 1;
    const score =
      100 *
      (0.35 * sharpScore + 0.2 * brightScore + 0.15 * contrastScore + 0.2 * featureScore + 0.1 * motionScore);

    results.push({
      index: frame.index,
      timestamp: frame.timestamp,
      sharpness,
      brightness: mean,
      contrast: std,
      featureCount,
      motion: Number.isFinite(motion) ? motion : 0,
      score,
      selected: false,
      reason: "",
    });
    prev = frame;
    onProgress?.(i + 1, frames.length);
  });

  return results;
}

/** Adaptive selection: hard rejects first, then best-scoring frames spread over time. */
export function selectKeyframes(
  quality: FrameQuality[],
  thresholds: QualityThresholds,
): FrameQuality[] {
  const candidates: FrameQuality[] = [];

  for (const q of quality) {
    if (q.sharpness < thresholds.minSharpness) {
      q.reason = "Rejected — blurry (low Laplacian variance)";
      continue;
    }
    if (q.brightness < thresholds.minBrightness) {
      q.reason = "Rejected — too dark";
      continue;
    }
    if (q.brightness > thresholds.maxBrightness) {
      q.reason = "Rejected — over-exposed";
      continue;
    }
    if (q.featureCount < thresholds.minFeatures) {
      q.reason = "Rejected — too few trackable features";
      continue;
    }
    if (q.index > 0 && q.motion < thresholds.minMotion) {
      q.reason = "Rejected — redundant (near-identical to previous frame)";
      continue;
    }
    candidates.push(q);
  }

  // Spread selection across the timeline so the trajectory stays covered.
  const budget = Math.min(thresholds.maxKeyframes, candidates.length);
  if (budget === 0) return [];
  const buckets: FrameQuality[][] = Array.from({ length: budget }, () => []);
  const span = candidates[candidates.length - 1].timestamp - candidates[0].timestamp || 1;
  for (const c of candidates) {
    const b = Math.min(budget - 1, Math.floor(((c.timestamp - candidates[0].timestamp) / span) * budget));
    buckets[b].push(c);
  }

  const selected: FrameQuality[] = [];
  for (const bucket of buckets) {
    if (!bucket.length) continue;
    const best = bucket.reduce((a, b) => (b.score > a.score ? b : a));
    best.selected = true;
    best.reason = "Selected — best quality in its time window";
    selected.push(best);
  }
  for (const c of candidates) {
    if (!c.selected) c.reason = "Rejected — a sharper frame covers the same window";
  }
  return selected.sort((a, b) => a.index - b.index);
}
