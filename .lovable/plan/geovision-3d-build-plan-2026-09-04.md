# GeoVision 3D — Build Plan

## One important constraint first

This project runs on Lovable's stack: React + TanStack Start on a serverless edge runtime. It cannot run Python, FastAPI, PyTorch, COLMAP, Open3D, or Docker — those need a machine with a Python process and native binaries, which does not exist here.

So instead of faking a Python backend, the plan builds the **same pipeline for real in TypeScript**: frame extraction, blur/brightness/feature quality scoring, ORB-style feature detection and matching, RANSAC, essential-matrix pose recovery, depth estimation, point-cloud generation, georeferencing, and a Three.js viewer. Everything actually computes on the uploaded video — no dummy data, no placeholder functions.

If you need the literal Python/FastAPI/COLMAP stack, that has to be a local repo outside Lovable; I can generate that codebase as downloadable files instead. Say the word and I'll switch.

## What gets built

### Pipeline (real computation, runs in the browser on CPU)
1. **Video decode + validation** — MP4/MOV/WebM via `<video>` + canvas; duration, resolution, FPS estimate, size. AVI is browser-undecodable and is rejected with a clear message.
2. **Frame extraction** — configurable interval seeking, grayscale buffers.
3. **Quality analysis** — Laplacian variance (sharpness), mean/σ brightness, feature count, inter-frame difference → composite quality score.
4. **Adaptive keyframe selection** — rejects blurry, over/under-exposed, redundant frames with reasons.
5. **Features & matching** — FAST corners + BRIEF-style binary descriptors (ORB approach), Hamming matching with ratio test, RANSAC filtering, side-by-side match overlay canvas.
6. **Pose estimation** — normalized 8-point essential matrix + RANSAC, SVD decomposition, cheirality check → relative R,t chained into a camera trajectory.
7. **Depth estimation** — multi-cue monocular depth (gradient/defocus + vertical prior) plus triangulated sparse points to scale it; pluggable hook for an external model when configured.
8. **Point cloud** — unprojection with intrinsics, voxel downsampling, statistical outlier removal, normal estimation.
9. **Georeferencing** — GPS track (CSV/JSON/GPX) → ENU frame → Umeyama alignment of the camera trajectory; falls back to LOCAL mode with a clear badge.

### Pages
- **Dashboard** — branding, system/capability status, recent projects, pipeline diagram, quick actions.
- **New Reconstruction** — video upload with preview + metadata upload + mode (Demo/Advanced) and parameters.
- **Processing** — live 11-step pipeline with per-step status, progress, and streaming logs.
- **Projects** — list, open, download, delete.
- **3D Viewer** — R3F point cloud: orbit/zoom/pan, reset, point size, color mode (height/intensity/RGB), grid, axes, fullscreen, camera-trajectory overlay, stats panel.
- **Analytics** — recharts: quality distribution, per-frame metrics, match counts, cloud size, timing breakdown.
- **Settings** — capability detection (WebGL2, WebCodecs, WASM SIMD, GPU), pipeline defaults.

### Persistence
Lovable Cloud (Postgres + storage) for projects, per-step metrics, and result artifacts (PLY/PCD/report JSON/trajectory CSV) with signed downloads. Server functions provide the API surface (project CRUD, upload, results, analytics, download).

### Downloads
Real `.ply`, `.pcd`, report `.json`, trajectory `.csv` generated from the actual reconstruction.

## Technical notes
- Heavy CV runs in a Web Worker so the UI stays responsive; progress is posted per step.
- All math is dependency-light TypeScript (no OpenCV.js WASM download dependency), which keeps it working on any laptop with no GPU.
- Advanced mode = feature detection: WebGPU/WebGL acceleration and external model endpoint if configured, otherwise graceful downgrade with a status badge — never a crash.
- README documents architecture, modes, API, folder structure, and limitations honestly.

## Build order
1. Cloud enablement + schema + app shell/nav/branding
2. CV core library + worker (extraction → quality → features → pose → depth → cloud → georef)
3. New Reconstruction + Processing pages wired to the worker and Cloud
4. Viewer + Analytics + Projects + downloads
5. Settings, README, end-to-end verification with a generated sample video
