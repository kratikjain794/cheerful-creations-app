# GeoVision 3D — Roadmap

## Open
- [ ] Rebrand app to GeoVision 3D (shell, nav, tokens reuse)
- [ ] Video upload + validation (MP4/AVI/MOV), metadata readout
- [ ] GPS/metadata upload (CSV/JSON/GPX) parsing
- [ ] Frame extraction (canvas/WebCodecs) + quality scoring (Laplacian blur, brightness, diff)
- [ ] Adaptive keyframe selection + quality table + charts
- [ ] Feature detection (FAST/ORB-style) + matching + RANSAC + match visualization
- [ ] Camera pose estimation (essential matrix / recoverPose) + trajectory
- [ ] Depth estimation (gradient/parallax heuristic; optional model hook)
- [ ] Point cloud generation + voxel downsample + outlier removal
- [ ] Georeferencing (ENU from GPS) / local mode indicator
- [ ] Three.js + R3F interactive viewer (rotate/zoom/pan/point size/grid/axes/fullscreen)
- [ ] Processing pipeline page with live step progress + logs
- [ ] Projects CRUD + persistence (Lovable Cloud)
- [ ] Downloads: PLY, PCD, report JSON, trajectory CSV
- [ ] Analytics page with charts
- [ ] README with setup, modes, API docs, limitations

## Notes
- Platform is TanStack Start on Cloudflare Workers: no Python/FastAPI/Docker/COLMAP/PyTorch runtime.
  Pipeline is implemented for real in TypeScript (browser CV) + server functions; advanced-mode hooks
  are feature-detected and degrade gracefully.
