# GeoVision 3D

**AI-Powered Single-Pass Drone Video to Georeferenced 3D Reconstruction System**

GeoVision 3D turns one continuous drone video into a georeferenced 3D point cloud. The whole
computer-vision pipeline is implemented in TypeScript and runs locally in the browser: the video is
never uploaded to a server, and every metric shown in the UI is measured by the pipeline while it
runs. There is no mock data, no simulated progress and no placeholder point cloud.

## Project overview

- Input: a single continuous drone pass (MP4 / MOV / WebM) plus an optional GPS/IMU track.
- Output: a cleaned point cloud, recovered camera trajectory, per-frame quality metrics and a run
  report, all exportable.
- Storage: projects, metrics and point clouds persist in IndexedDB (with an in-memory fallback when
  IndexedDB is blocked), so runs survive reloads.

## Features

- Real video upload with container/codec validation and a metadata probe (resolution, duration,
  size, estimated FPS) plus in-page preview.
- Real frame extraction by interval seeking with grayscale conversion at a configurable working
  width.
- Frame quality analysis: Laplacian blur/sharpness, brightness/exposure, contrast and inter-frame
  motion, combined into a 0–100 quality score.
- Adaptive keyframe selection that rejects blurry and redundant frames and caps the keyframe count.
- FAST-style corner detection with 256-bit BRIEF-style descriptors.
- Hamming feature matching with ratio test plus RANSAC filtering (inlier counts reported per pair).
- Camera pose estimation from the essential matrix with SVD-based pose recovery, chained into a
  full trajectory, and sparse triangulation.
- Multi-cue monocular depth estimation scaled by triangulated sparse points, with an optional
  external depth-model endpoint hook.
- Point cloud generation via pinhole unprojection into world space.
- Point cloud cleaning: voxel downsampling, statistical outlier removal and normal estimation.
- GPS/metadata processing, geodetic → ENU conversion and Umeyama alignment of the visual
  trajectory (LOCAL frame when no GPS is supplied).
- Live processing page with per-step progress, timings and a streaming log.
- Projects page with reopen/delete, an interactive WebGL point-cloud viewer, and an analytics page
  driven by recorded metrics.
- Exports: PLY, PCD, JSON report and CSV trajectory.
- Settings page with live runtime capability detection and editable pipeline defaults.

## Architecture

```text
src/
  routes/
    index.tsx            Landing page (branding, pipeline overview, START RECONSTRUCTION)
    dashboard.tsx        System status + recent projects
    new.tsx              Upload video + GPS, configure parameters, launch a run
    processing.$id.tsx   Live 11-step execution with progress and logs
    projects.tsx         Stored projects (open / view / delete)
    viewer.index.tsx     Pick a completed reconstruction
    viewer.$id.tsx       Interactive 3D point-cloud viewer + downloads
    analytics.tsx        Charts computed from recorded run metrics
    settings.tsx         Capability detection + editable pipeline defaults
  lib/
    cv/video.ts          Validation, probing, frame extraction
    cv/quality.ts        Sharpness / exposure / motion scoring, keyframe selection
    cv/features.ts       FAST corners, BRIEF descriptors, matching, RANSAC
    cv/pose.ts           Intrinsics, essential matrix, recoverPose, triangulation
    cv/depth.ts          Multi-cue depth estimation and colourisation
    cv/pointcloud.ts     Unprojection, voxel downsample, outlier removal, normals
    cv/geo.ts            GPS parsing (CSV/JSON/GPX), ENU conversion, alignment
    cv/math.ts           Small matrix/vector and SVD helpers
    cv/pipeline.ts       Orchestrates the 11 steps and emits progress/logs
    capabilities.ts      Runtime feature detection (WebGL/WebGPU/WebCodecs/SIMD)
    settings.ts          Persisted pipeline defaults
    store.ts             IndexedDB persistence for projects, clouds and jobs
    reports.ts           PLY / PCD / JSON / CSV exporters
  components/
    AppShell.tsx         App chrome and navigation
    PointCloudViewer.tsx Three.js / React Three Fiber viewer
```

Stack: TanStack Start (TanStack Router + Vite, deployed to an edge runtime), React 19,
TypeScript, Tailwind CSS v4 with shadcn-style components, Three.js / React Three Fiber for the
viewer, Recharts for analytics, IndexedDB for persistence.

## The 11-step reconstruction pipeline

1. **Video validation** — container, codec, duration and resolution probe.
2. **Frame extraction** — interval seeking and grayscale conversion.
3. **Quality analysis** — Laplacian sharpness, exposure, contrast, motion.
4. **Keyframe selection** — adaptive rejection of blurry/redundant frames.
5. **Feature detection** — FAST corners + 256-bit BRIEF descriptors.
6. **Feature matching** — Hamming matching, ratio test, RANSAC filtering.
7. **Pose estimation** — essential matrix + SVD recoverPose, chained trajectory.
8. **Depth estimation** — multi-cue monocular depth scaled by sparse points.
9. **Point cloud generation** — pinhole unprojection into world space.
10. **Cloud cleaning** — voxel downsample, statistical outlier removal, normals.
11. **Georeferencing** — GPS → ENU and Umeyama trajectory alignment.

## Technology stack

| Layer | Choice |
| --- | --- |
| Framework | TanStack Start v1 (TanStack Router, Vite 7) |
| UI | React 19, Tailwind CSS v4, shadcn-style components, lucide icons |
| 3D | Three.js + React Three Fiber + drei |
| Charts | Recharts |
| CV | Hand-written TypeScript modules (`src/lib/cv/*`) |
| Persistence | IndexedDB (`geovision3d` database) with in-memory fallback |

## Supported video formats

- MP4 (H.264) — recommended
- MOV / QuickTime (H.264)
- WebM (VP8 / VP9)

Decoding is delegated to the browser, so support follows the browser's own codec support. AVI and
HEVC-only files are commonly rejected by browsers; re-encode to H.264 MP4 first.

## GPS / metadata formats

- **CSV** with headers containing latitude/longitude (and optional altitude, timestamp, yaw), e.g.
  `timestamp,latitude,longitude,altitude,yaw`.
- **JSON** — an array of objects with `lat`/`latitude`, `lon`/`lng`/`longitude`, optional `alt`,
  `time`/`timestamp`, `yaw`/`heading`.
- **GPX** — `<trkpt lat="..." lon="...">` with optional `<ele>` and `<time>`.

Without metadata the reconstruction still completes and stays in a LOCAL metric frame.

## How to use the application

1. Open **START RECONSTRUCTION** on the home page (or **New reconstruction** in the nav).
2. Upload the drone video. It is validated and previewed, with resolution/duration/FPS shown.
3. Optionally upload a GPS/metadata file; the parsed sample count is displayed.
4. Name the project and adjust the pipeline parameters (or set them once in **Settings**).
5. Choose Demo or Advanced mode and press **Start reconstruction**.
6. Watch the 11 steps execute with live progress, per-step timings and logs.
7. When finished, open the **3D viewer** to orbit the cloud, **Analytics** for the recorded metrics,
   and the **Download** menu for exports.
8. **Projects** lists every stored run for reopening or deletion.

## Demo mode

Tuned to complete anywhere: larger frame interval, reduced processing width, capped frame and
keyframe counts, coarser depth stride. Always available — it needs no GPU features.

## Advanced mode

Unlocked when WebGPU or WASM SIMD is detected. Denser sampling, more keyframes, finer depth stride
and support for an optional external depth-model endpoint (configured in Settings) that degrades
gracefully back to the built-in estimator if unavailable.

## Browser requirements

- A modern Chromium, Firefox or Safari release (Chromium recommended).
- WebGL or WebGL2 for the 3D viewer.
- IndexedDB for persistence (falls back to memory-only for the session).
- Optional: WebCodecs for faster decoding, WebGPU / WASM SIMD for Advanced mode.
- Desktop-class CPU and at least ~4 GB of free memory for longer clips.

Current support on your machine is listed on the **Settings** page.

## Output / download formats

- `.ply` — ASCII point cloud with RGB colour.
- `.pcd` — Point Cloud Library ASCII format.
- `.json` — full run report: parameters, per-step timings, quality metrics, match counts, poses,
  georeferencing summary.
- `.csv` — camera trajectory (index, position, yaw, and ENU coordinates when georeferenced).

## Known limitations

- Monocular reconstruction: absolute scale comes from GPS. Without a GPS track results are metric
  only up to an unknown scale factor.
- Depth is a multi-cue estimate, not dense MVS; the cloud is sparser and noisier than COLMAP output.
- COLMAP, PyTorch and YOLO-based dynamic-object masking cannot run in the browser runtime; those
  capabilities are feature-detected and reported as unavailable rather than faked.
- Processing is CPU-bound and single-threaded; long or high-resolution clips should be trimmed or
  processed at a lower working width.
- Browser codec support limits input formats (no AVI, generally no HEVC).
- Loop closure and global bundle adjustment are not implemented, so drift accumulates on long passes.

## Future improvements

- Web Worker pool (and WebGPU compute) for parallel feature extraction and depth.
- Bundle adjustment plus loop-closure detection to reduce trajectory drift.
- Optional mesh reconstruction (Poisson / TSDF) and texture baking.
- WebCodecs-based decoding path for faster, more accurate frame timing.
- Cloud sync of projects and shareable reconstruction links.
- ONNX/WebGPU monocular-depth model behind the existing endpoint hook.
