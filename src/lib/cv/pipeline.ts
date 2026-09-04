// GeoVision 3D — reconstruction pipeline orchestrator.
//
// Connects every CV module into one 11-step run that operates on the real
// uploaded video. Nothing here fabricates data: every number reported to the
// UI is produced by the modules in this folder.

import { extractFrames, imageDataToDataUrl, probeVideo, validateVideoFile } from "./video";
import { DEFAULT_THRESHOLDS, analyzeFrames, selectKeyframes, type QualityThresholds } from "./quality";
import { extractFeatures, matchFeatures, ransacSimilarity } from "./features";
import {
  defaultIntrinsics,
  findEssentialMatrix,
  matchedPoints,
  recoverPose,
  rotationToYaw,
  triangulatePoints,
  type Intrinsics,
} from "./pose";
import { colorizeDepth, estimateDepth, type SparsePoint } from "./depth";
import {
  estimateNormals,
  removeStatisticalOutliers,
  unproject,
  voxelDownsample,
} from "./pointcloud";
import { alignTrajectory, applyAlignment, geodeticToEnu, parseMetadata, sampleAt } from "./geo";
import { matMul3, matT3, matVec3, type Mat3 } from "./math";
import type {
  FeatureSet,
  FrameQuality,
  GpsSample,
  GrayFrame,
  PointCloud,
  Pose,
  ProjectMeta,
} from "./types";

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type PipelineStep = {
  id: string;
  label: string;
  description: string;
  status: StepStatus;
  progress: number; // 0..1
  detail: string;
  ms: number;
};

export const STEP_DEFS: { id: string; label: string; description: string }[] = [
  { id: "validate", label: "Video validation", description: "Container, codec, duration and resolution probe" },
  { id: "extract", label: "Frame extraction", description: "Interval seeking + grayscale conversion" },
  { id: "quality", label: "Quality analysis", description: "Laplacian sharpness, exposure, contrast, motion" },
  { id: "keyframes", label: "Keyframe selection", description: "Adaptive rejection of blurry/redundant frames" },
  { id: "features", label: "Feature detection", description: "FAST corners + 256-bit BRIEF descriptors" },
  { id: "matching", label: "Feature matching", description: "Hamming matching, ratio test, RANSAC filtering" },
  { id: "pose", label: "Pose estimation", description: "Essential matrix + SVD recoverPose, chained trajectory" },
  { id: "depth", label: "Depth estimation", description: "Multi-cue monocular depth scaled by sparse points" },
  { id: "cloud", label: "Point cloud generation", description: "Pinhole unprojection into world space" },
  { id: "clean", label: "Cloud cleaning", description: "Voxel downsample, outlier removal, normals" },
  { id: "georef", label: "Georeferencing", description: "GPS → ENU and Umeyama trajectory alignment" },
];

export function initialSteps(): PipelineStep[] {
  return STEP_DEFS.map((s) => ({ ...s, status: "pending" as StepStatus, progress: 0, detail: "", ms: 0 }));
}

export type PipelineParams = {
  mode: "DEMO" | "ADVANCED";
  intervalSeconds: number;
  maxFrames: number;
  processWidth: number;
  maxKeyframes: number;
  depthStride: number;
  maxDepth: number;
  voxelSize: number;
  modelEndpoint?: string | null;
};

export const DEFAULT_PARAMS: PipelineParams = {
  mode: "DEMO",
  intervalSeconds: 0.5,
  maxFrames: 60,
  processWidth: 320,
  maxKeyframes: 14,
  depthStride: 3,
  maxDepth: 60,
  voxelSize: 0.12,
  modelEndpoint: null,
};

export type PipelineEvents = {
  onSteps?: (steps: PipelineStep[]) => void;
  onLog?: (line: string) => void;
};

export type PipelineInput = {
  project: ProjectMeta;
  videoFile: File;
  metadataFile?: File | null;
  params: PipelineParams;
};

class Tracker {
  steps = initialSteps();
  logs: string[] = [];
  private startedAt = 0;
  constructor(private events: PipelineEvents) {}

  private emit() {
    this.events.onSteps?.(this.steps.map((s) => ({ ...s })));
  }

  log(line: string) {
    const stamped = `[${new Date().toLocaleTimeString()}] ${line}`;
    this.logs.push(stamped);
    this.events.onLog?.(stamped);
  }

  start(id: string) {
    const s = this.find(id);
    s.status = "running";
    s.progress = 0;
    this.startedAt = performance.now();
    this.log(`▶ ${s.label}`);
    this.emit();
  }

  progress(id: string, value: number, detail?: string) {
    const s = this.find(id);
    s.progress = Math.max(0, Math.min(1, value));
    if (detail) s.detail = detail;
    this.emit();
  }

  done(id: string, detail: string) {
    const s = this.find(id);
    s.status = "done";
    s.progress = 1;
    s.detail = detail;
    s.ms = performance.now() - this.startedAt;
    this.log(`✔ ${s.label} — ${detail} (${s.ms.toFixed(0)} ms)`);
    this.emit();
  }

  skip(id: string, detail: string) {
    const s = this.find(id);
    s.status = "skipped";
    s.progress = 1;
    s.detail = detail;
    this.log(`— ${s.label} skipped: ${detail}`);
    this.emit();
  }

  fail(id: string, detail: string) {
    const s = this.find(id);
    s.status = "failed";
    s.detail = detail;
    s.ms = performance.now() - this.startedAt;
    this.log(`✖ ${s.label} failed — ${detail}`);
    this.emit();
  }

  private find(id: string) {
    const s = this.steps.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown pipeline step: ${id}`);
    return s;
  }
}

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

async function yieldToUi() {
  await new Promise((r) => setTimeout(r, 0));
}

export async function runPipeline(
  input: PipelineInput,
  events: PipelineEvents = {},
): Promise<{ project: ProjectMeta; cloud: PointCloud }> {
  const t0 = performance.now();
  const tracker = new Tracker(events);
  const params = input.params;
  const project: ProjectMeta = {
    ...input.project,
    status: "processing",
    logs: [],
    quality: [],
    poses: [],
    gps: [],
    matches: [],
    depthPreviews: [],
  };

  const finish = (cloud: PointCloud): { project: ProjectMeta; cloud: PointCloud } => {
    project.logs = tracker.logs;
    return { project, cloud };
  };

  // ---------------------------------------------------------------- 1. validate
  tracker.start("validate");
  const check = validateVideoFile(input.videoFile);
  if (!check.ok) {
    tracker.fail("validate", check.message);
    project.status = "failed";
    project.error = check.message;
    return finish({ positions: new Float32Array(0), colors: new Float32Array(0), count: 0 });
  }
  let info;
  try {
    info = await probeVideo(input.videoFile);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Video could not be decoded.";
    tracker.fail("validate", message);
    project.status = "failed";
    project.error = message;
    return finish({ positions: new Float32Array(0), colors: new Float32Array(0), count: 0 });
  }
  project.video = {
    name: info.name,
    size: info.size,
    duration: info.duration,
    width: info.width,
    height: info.height,
    fps: info.fps,
  };
  tracker.done(
    "validate",
    `${info.width}×${info.height}, ${info.duration.toFixed(1)}s, ${(info.size / 1e6).toFixed(1)} MB`,
  );

  // GPS metadata (parsed early so georeferencing can use it later)
  let gps: GpsSample[] = [];
  if (input.metadataFile) {
    const text = await input.metadataFile.text();
    gps = parseMetadata(input.metadataFile.name, text);
    project.metadataFile = input.metadataFile.name;
    project.gps = gps;
    tracker.log(
      gps.length
        ? `Parsed ${gps.length} GPS samples from ${input.metadataFile.name}`
        : `No usable GPS samples found in ${input.metadataFile.name} — LOCAL mode will be used`,
    );
  }

  // ----------------------------------------------------------------- 2. extract
  tracker.start("extract");
  let frames: GrayFrame[] = [];
  try {
    const result = await extractFrames(input.videoFile, {
      intervalSeconds: params.intervalSeconds,
      maxFrames: params.maxFrames,
      processWidth: params.processWidth,
      onFrame: (_f, done, total) =>
        tracker.progress("extract", done / total, `${done}/${total} frames decoded`),
    });
    frames = result.frames;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Frame extraction failed.";
    tracker.fail("extract", message);
    project.status = "failed";
    project.error = message;
    return finish({ positions: new Float32Array(0), colors: new Float32Array(0), count: 0 });
  }
  const fw = frames[0].width;
  const fh = frames[0].height;
  tracker.done("extract", `${frames.length} frames at ${fw}×${fh}`);
  await yieldToUi();

  // ----------------------------------------------------------------- 3. quality
  tracker.start("quality");
  const thresholds: QualityThresholds = { ...DEFAULT_THRESHOLDS, maxKeyframes: params.maxKeyframes };
  const quality: FrameQuality[] = analyzeFrames(frames, thresholds, (done, total) =>
    tracker.progress("quality", done / total, `${done}/${total} frames scored`),
  );
  const avgQuality = quality.reduce((a, q) => a + q.score, 0) / (quality.length || 1);
  tracker.done("quality", `mean score ${avgQuality.toFixed(1)}/100`);
  await yieldToUi();

  // --------------------------------------------------------------- 4. keyframes
  tracker.start("keyframes");
  const keyQuality = selectKeyframes(quality, thresholds);
  project.quality = quality;
  if (keyQuality.length < 2) {
    const message = "Fewer than two usable keyframes — the footage is too blurry, dark or static.";
    tracker.fail("keyframes", message);
    project.status = "failed";
    project.error = message;
    return finish({ positions: new Float32Array(0), colors: new Float32Array(0), count: 0 });
  }
  const keyframes = keyQuality
    .map((q) => frames.find((f) => f.index === q.index))
    .filter((f): f is GrayFrame => !!f);
  tracker.done(
    "keyframes",
    `${keyframes.length} keyframes kept, ${quality.length - keyframes.length} rejected`,
  );
  await yieldToUi();

  // ---------------------------------------------------------------- 5. features
  tracker.start("features");
  const featureSets: FeatureSet[] = [];
  let totalFeatures = 0;
  for (let i = 0; i < keyframes.length; i++) {
    const f = keyframes[i];
    const fs = extractFeatures(f.index, f.gray, f.width, f.height, params.mode === "ADVANCED" ? 1200 : 800);
    featureSets.push(fs);
    totalFeatures += fs.keypoints.length;
    tracker.progress("features", (i + 1) / keyframes.length, `${totalFeatures} keypoints`);
    await yieldToUi();
  }
  tracker.done("features", `${totalFeatures} keypoints across ${keyframes.length} keyframes`);

  // ---------------------------------------------------------------- 6. matching
  tracker.start("matching");
  const matchResults = [];
  let rawMatches = 0;
  let goodMatches = 0;
  for (let i = 0; i < featureSets.length - 1; i++) {
    const raw = matchFeatures(featureSets[i], featureSets[i + 1]);
    const res = ransacSimilarity(featureSets[i], featureSets[i + 1], raw);
    matchResults.push(res);
    rawMatches += res.rawMatches;
    goodMatches += res.inliers.length;
    project.matches.push({
      from: res.fromIndex,
      to: res.toIndex,
      raw: res.rawMatches,
      inliers: res.inliers.length,
    });
    tracker.progress(
      "matching",
      (i + 1) / (featureSets.length - 1),
      `${goodMatches} RANSAC inliers of ${rawMatches} raw matches`,
    );
    await yieldToUi();
  }
  tracker.done("matching", `${goodMatches} inliers / ${rawMatches} raw matches`);

  // -------------------------------------------------------------------- 7. pose
  tracker.start("pose");
  const K: Intrinsics = defaultIntrinsics(fw, fh);
  const rotations: Mat3[] = [IDENTITY];
  const centers: [number, number, number][] = [[0, 0, 0]];
  const sparseByKeyframe: SparsePoint[][] = keyframes.map(() => []);
  let solved = 0;

  for (let i = 0; i < matchResults.length; i++) {
    const res = matchResults[i];
    const { p1, p2 } = matchedPoints(featureSets[i], featureSets[i + 1], res.inliers);
    let R: Mat3 = IDENTITY;
    let t: number[] = [0, 0, 0];
    const essential = p1.length >= 8 ? findEssentialMatrix(p1, p2, K) : null;
    if (essential) {
      const inl = essential.inliers;
      const ip1 = inl.map((k) => p1[k]);
      const ip2 = inl.map((k) => p2[k]);
      const pose = recoverPose(essential.E, ip1, ip2, K);
      if (pose) {
        R = pose.R;
        t = pose.t;
        solved++;
        const tri = triangulatePoints(R, t, ip1, ip2, K);
        for (const p of tri) sparseByKeyframe[i].push({ u: p.u, v: p.v, z: p.z });
      }
    }
    if (!essential) {
      tracker.log(`  pair ${i}→${i + 1}: degenerate geometry, translation carried forward`);
    }
    const prevR = rotations[i];
    const prevC = centers[i];
    const nextR = matMul3(prevR, matT3(R));
    const camOffset = matVec3(matT3(R), [-t[0], -t[1], -t[2]]);
    const worldOffset = matVec3(prevR, camOffset);
    rotations.push(nextR);
    centers.push([
      prevC[0] + worldOffset[0],
      prevC[1] + worldOffset[1],
      prevC[2] + worldOffset[2],
    ]);
    tracker.progress("pose", (i + 1) / matchResults.length, `${solved} poses recovered`);
    await yieldToUi();
  }

  let poses: Pose[] = keyframes.map((f, i) => ({
    frameIndex: f.index,
    timestamp: f.timestamp,
    position: centers[i],
    yaw: rotationToYaw(rotations[i]),
  }));
  let trajectoryLength = 0;
  for (let i = 1; i < poses.length; i++) {
    trajectoryLength += Math.hypot(
      poses[i].position[0] - poses[i - 1].position[0],
      poses[i].position[1] - poses[i - 1].position[1],
      poses[i].position[2] - poses[i - 1].position[2],
    );
  }
  tracker.done("pose", `${solved}/${matchResults.length} relative poses, path ${trajectoryLength.toFixed(2)} u`);

  // ------------------------------------------------------------------- 8. depth
  tracker.start("depth");
  const depthMaps: Float32Array[] = [];
  let depthSource = "cpu";
  for (let i = 0; i < keyframes.length; i++) {
    const f = keyframes[i];
    const { map, source } = await estimateDepth(
      f.index,
      f.gray,
      f.width,
      f.height,
      sparseByKeyframe[i],
      { modelEndpoint: params.mode === "ADVANCED" ? (params.modelEndpoint ?? null) : null },
    );
    depthSource = source;
    depthMaps.push(map.depth);
    if (project.depthPreviews.length < 4) {
      const image = colorizeDepth(map.depth, f.width, f.height);
      project.depthPreviews.push({
        frameIndex: f.index,
        frame: f.thumbnail,
        depth: image ? imageDataToDataUrl(image) : "",
      });
    }
    tracker.progress("depth", (i + 1) / keyframes.length, `${i + 1}/${keyframes.length} depth maps`);
    await yieldToUi();
  }
  tracker.done("depth", `${depthMaps.length} maps (${depthSource} estimator)`);

  // ------------------------------------------------------------------- 9. cloud
  tracker.start("cloud");
  const positions: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < keyframes.length; i++) {
    const f = keyframes[i];
    const part = unproject(depthMaps[i], f.rgb, f.width, f.height, K, rotations[i], centers[i], {
      stride: params.depthStride,
      maxDepth: params.maxDepth,
    });
    positions.push(...part.positions);
    colors.push(...part.colors);
    tracker.progress("cloud", (i + 1) / keyframes.length, `${positions.length / 3} points`);
    await yieldToUi();
  }
  let cloud: PointCloud = {
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    count: positions.length / 3,
  };
  tracker.done("cloud", `${cloud.count.toLocaleString()} raw points`);

  // ------------------------------------------------------------------ 10. clean
  tracker.start("clean");
  const before = cloud.count;
  cloud = voxelDownsample(cloud, params.voxelSize);
  tracker.progress("clean", 0.5, `${cloud.count.toLocaleString()} after voxel downsample`);
  await yieldToUi();
  const cleaned = removeStatisticalOutliers(cloud, 8, 2);
  cloud = cleaned.cloud;
  estimateNormals(cloud, Math.max(params.voxelSize * 3, 0.2));
  tracker.done(
    "clean",
    `${before.toLocaleString()} → ${cloud.count.toLocaleString()} points (${cleaned.removed} outliers removed)`,
  );
  await yieldToUi();

  // ----------------------------------------------------------------- 11. georef
  tracker.start("georef");
  let coordinateMode: "LOCAL" | "GEOREFERENCED" = "LOCAL";
  let origin: { lat: number; lon: number; alt: number } | undefined;
  if (gps.length >= 2) {
    origin = { lat: gps[0].lat, lon: gps[0].lon, alt: gps[0].alt };
    const target: [number, number, number][] = [];
    const source: [number, number, number][] = [];
    for (const p of poses) {
      const s = sampleAt(gps, p.timestamp);
      if (!s) continue;
      target.push(geodeticToEnu(s.lat, s.lon, s.alt, origin));
      source.push(p.position);
    }
    const alignment = target.length >= 2 ? alignTrajectory(source, target) : null;
    if (alignment) {
      poses = poses.map((p) => ({ ...p, position: applyAlignment(p.position, alignment) }));
      const aligned = new Float32Array(cloud.positions.length);
      for (let i = 0; i < cloud.count; i++) {
        const q = applyAlignment(
          [cloud.positions[i * 3], cloud.positions[i * 3 + 1], cloud.positions[i * 3 + 2]],
          alignment,
        );
        aligned[i * 3] = q[0];
        aligned[i * 3 + 1] = q[1];
        aligned[i * 3 + 2] = q[2];
      }
      cloud = { ...cloud, positions: aligned };
      coordinateMode = "GEOREFERENCED";
      trajectoryLength = 0;
      for (let i = 1; i < poses.length; i++) {
        trajectoryLength += Math.hypot(
          poses[i].position[0] - poses[i - 1].position[0],
          poses[i].position[1] - poses[i - 1].position[1],
          poses[i].position[2] - poses[i - 1].position[2],
        );
      }
      tracker.done(
        "georef",
        `aligned to ${target.length} GPS fixes, scale ${alignment.scale.toFixed(3)}, RMSE ${alignment.rmse.toFixed(2)} m`,
      );
    } else {
      tracker.skip("georef", "GPS track could not be aligned — staying in LOCAL frame");
      origin = undefined;
    }
  } else {
    tracker.skip("georef", "no GPS track supplied — LOCAL coordinate frame");
  }

  project.status = "ready";
  project.poses = poses;
  project.stats = {
    totalFrames: frames.length,
    keyframes: keyframes.length,
    rejectedFrames: quality.length - keyframes.length,
    avgQuality,
    totalFeatures,
    goodMatches,
    rawMatches,
    pointCount: cloud.count,
    processingMs: performance.now() - t0,
    coordinateMode,
    mode: params.mode,
    origin,
    trajectoryLength,
  };
  tracker.log(
    `Reconstruction complete — ${cloud.count.toLocaleString()} points in ${(
      (performance.now() - t0) /
      1000
    ).toFixed(1)}s (${coordinateMode})`,
  );

  return finish(cloud);
}
