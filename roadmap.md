# GeoVision 3D — Roadmap

## Done
- [x] Rebrand app to GeoVision 3D (shell, nav, design tokens)
- [x] Video upload + validation (MP4/MOV/WebM), decode probe, resolution/duration/FPS readout
- [x] GPS/metadata upload (CSV/JSON/GPX) parsing with sample count feedback
- [x] Frame extraction (canvas decode at configurable interval/width) + quality scoring
      (Laplacian variance, brightness/contrast, corner count, inter-frame difference)
- [x] Adaptive keyframe selection (hard rejects + best-in-time-window spread)
- [x] Feature detection (FAST corners + 256-bit BRIEF) and Hamming matching with ratio test + RANSAC
- [x] Camera pose estimation (essential matrix, SVD recoverPose, chained trajectory, triangulation)
- [x] Depth estimation (multi-cue monocular heuristic scaled by sparse triangulated points)
- [x] Point cloud generation (pinhole unprojection) + voxel downsample + statistical outlier
      removal (spatial hash, packed integer keys, bounded k-NN insertion) + normals
- [x] Georeferencing (GPS → ENU, Umeyama alignment, RMSE) with LOCAL frame fallback
- [x] Three.js/R3F viewer: orbit/pan/zoom, RGB / height / intensity colouring, point size,
      grid, axes, trajectory overlay, reset camera, fullscreen
- [x] Processing page with live per-step progress, timings and log stream
- [x] Projects CRUD + IndexedDB persistence (projects, clouds, pending jobs; in-memory fallback)
- [x] Downloads: PLY, PCD, JSON report, trajectory CSV
- [x] Analytics page (quality distribution, per-frame metrics, matches per pair, trajectory
      components, depth previews) built from real recorded pipeline measurements
- [x] Per-route SEO head metadata
- [x] End-to-end browser verification with real footage (see README / final report)

## Known limitations
- Codec support is whatever the visitor's browser can decode. Chromium builds without
  proprietary codecs (e.g. Playwright's bundled Chromium) reject H.264 MP4; WebM/VP8/VP9
  always works. Real Chrome/Edge/Safari decode MP4/MOV fine.
- Monocular depth is a heuristic, not a learned model: geometry is metrically plausible after
  GPS scaling but not survey-grade. Advanced mode exposes a hook for an external depth model.
- Structure-from-motion is two-view chained (no global bundle adjustment or loop closure), so
  drift accumulates on long flights, and near-planar/pure-translation passes report
  "degenerate geometry" for individual pairs.
- Processing is single-threaded on the main thread; large clouds (>100k points) make cleaning
  the dominant cost. No Web Worker/WASM offload yet.
- Storage is per-browser IndexedDB — projects do not sync across devices (no Cloud backend).

## Notes
- Platform is TanStack Start on Cloudflare Workers: no Python/FastAPI/Docker/COLMAP/PyTorch
  runtime. The pipeline is implemented for real in TypeScript and runs in the browser.
