// Shared types for the GeoVision 3D in-browser reconstruction pipeline.

export type GrayFrame = {
  index: number;
  timestamp: number; // seconds into the video
  width: number;
  height: number;
  gray: Float32Array; // luminance 0..255
  rgb: Uint8ClampedArray; // RGBA at the same resolution
  thumbnail: string; // data URL (jpeg)
};

export type FrameQuality = {
  index: number;
  timestamp: number;
  sharpness: number; // Laplacian variance
  brightness: number; // mean luminance 0..255
  contrast: number; // std deviation of luminance
  featureCount: number;
  motion: number; // mean abs difference vs previous frame
  score: number; // 0..100
  selected: boolean;
  reason: string;
};

export type Keypoint = { x: number; y: number; score: number };

export type FeatureSet = {
  frameIndex: number;
  keypoints: Keypoint[];
  descriptors: Uint32Array; // 8 uint32 per keypoint (256-bit BRIEF)
};

export type MatchPair = { a: number; b: number; distance: number };

export type MatchResult = {
  fromIndex: number;
  toIndex: number;
  rawMatches: number;
  inliers: MatchPair[];
  model: { scale: number; rotation: number; tx: number; ty: number };
};

export type Pose = {
  frameIndex: number;
  timestamp: number;
  position: [number, number, number];
  yaw: number;
};

export type DepthMap = {
  frameIndex: number;
  width: number;
  height: number;
  depth: Float32Array; // metric-ish depth (arbitrary scale in LOCAL mode)
  preview: string; // data URL of the colorized depth map
  sparseCount: number;
};

export type GpsSample = {
  timestamp: number; // seconds relative to track start
  lat: number;
  lon: number;
  alt: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
};

export type PointCloud = {
  positions: Float32Array; // xyz triples
  colors: Float32Array; // rgb triples 0..1
  count: number;
};

export type CoordinateMode = "LOCAL" | "GEOREFERENCED";

export type ReconstructionStats = {
  totalFrames: number;
  keyframes: number;
  rejectedFrames: number;
  avgQuality: number;
  totalFeatures: number;
  goodMatches: number;
  rawMatches: number;
  pointCount: number;
  processingMs: number;
  coordinateMode: CoordinateMode;
  mode: "DEMO" | "ADVANCED";
  origin?: { lat: number; lon: number; alt: number };
  trajectoryLength: number;
};

export type ProjectMeta = {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  status: "created" | "processing" | "ready" | "failed";
  video: {
    name: string;
    size: number;
    duration: number;
    width: number;
    height: number;
    fps: number;
  } | null;
  metadataFile: string | null;
  stats: ReconstructionStats | null;
  quality: FrameQuality[];
  poses: Pose[];
  gps: GpsSample[];
  matches: { from: number; to: number; raw: number; inliers: number }[];
  depthPreviews: { frameIndex: number; frame: string; depth: string }[];
  logs: string[];
  error?: string;
};
