// Export builders — every artifact is generated from the real reconstruction.

import { toPCD, toPLY } from "./cv/pointcloud";
import { trajectoryToCsv } from "./cv/geo";
import type { PointCloud, ProjectMeta } from "./cv/types";
import { downloadBlob } from "./store";

export function buildReport(project: ProjectMeta): string {
  return JSON.stringify(
    {
      generator: "GeoVision 3D",
      generatedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        createdAt: new Date(project.createdAt).toISOString(),
        status: project.status,
      },
      video: project.video,
      metadataFile: project.metadataFile,
      stats: project.stats,
      coordinateMode: project.stats?.coordinateMode ?? "LOCAL",
      origin: project.stats?.origin ?? null,
      frameQuality: project.quality.map((q) => ({
        index: q.index,
        timestamp: q.timestamp,
        sharpness: q.sharpness,
        brightness: q.brightness,
        contrast: q.contrast,
        featureCount: q.featureCount,
        motion: q.motion,
        score: q.score,
        selected: q.selected,
        reason: q.reason,
      })),
      matches: project.matches,
      poses: project.poses,
      gpsSamples: project.gps.length,
      logs: project.logs,
    },
    null,
    2,
  );
}

const safe = (name: string) => name.replace(/[^a-z0-9-_]+/gi, "_").toLowerCase() || "reconstruction";

export function downloadPly(project: ProjectMeta, cloud: PointCloud) {
  downloadBlob(`${safe(project.name)}.ply`, toPLY(cloud), "text/plain");
}

export function downloadPcd(project: ProjectMeta, cloud: PointCloud) {
  downloadBlob(`${safe(project.name)}.pcd`, toPCD(cloud), "text/plain");
}

export function downloadReport(project: ProjectMeta) {
  downloadBlob(`${safe(project.name)}_report.json`, buildReport(project), "application/json");
}

export function downloadTrajectory(project: ProjectMeta) {
  downloadBlob(
    `${safe(project.name)}_trajectory.csv`,
    trajectoryToCsv(project.poses, project.stats?.origin ?? null),
    "text/csv",
  );
}
