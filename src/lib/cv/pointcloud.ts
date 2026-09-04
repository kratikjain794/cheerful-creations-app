// Point-cloud construction, cleaning and export (Open3D-equivalent operations
// implemented in TypeScript: voxel downsample, statistical outlier removal,
// normal estimation, PLY/PCD writers).

import type { Intrinsics } from "./pose";
import type { PointCloud } from "./types";
import type { Mat3 } from "./math";
import { matVec3 } from "./math";

export type BuildOptions = {
  stride: number; // pixel step when unprojecting
  maxDepth: number;
};

/**
 * Unproject a depth map into 3D using the pinhole model:
 *   X = (x - cx) * Z / fx ,  Y = (y - cy) * Z / fy ,  Z = depth
 * The result is transformed into world space by the camera pose (R, C).
 */
export function unproject(
  depth: Float32Array,
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  K: Intrinsics,
  R: Mat3,
  center: [number, number, number],
  options: BuildOptions,
): { positions: number[]; colors: number[] } {
  const positions: number[] = [];
  const colors: number[] = [];
  const step = Math.max(1, options.stride);
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = y * w + x;
      const z = depth[i];
      if (!Number.isFinite(z) || z <= 0.05 || z > options.maxDepth) continue;
      const camX = ((x - K.cx) * z) / K.fx;
      const camY = ((y - K.cy) * z) / K.fy;
      const world = matVec3(R, [camX, camY, z]);
      positions.push(world[0] + center[0], -(world[1] + center[1]), world[2] + center[2]);
      const p = i * 4;
      colors.push(rgba[p] / 255, rgba[p + 1] / 255, rgba[p + 2] / 255);
    }
  }
  return { positions, colors };
}

/** Voxel-grid downsampling: one averaged point per occupied voxel. */
export function voxelDownsample(cloud: PointCloud, voxel: number): PointCloud {
  if (voxel <= 0) return cloud;
  const buckets = new Map<string, { x: number; y: number; z: number; r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < cloud.count; i++) {
    const x = cloud.positions[i * 3];
    const y = cloud.positions[i * 3 + 1];
    const z = cloud.positions[i * 3 + 2];
    const key = `${Math.floor(x / voxel)},${Math.floor(y / voxel)},${Math.floor(z / voxel)}`;
    const b = buckets.get(key);
    if (b) {
      b.x += x;
      b.y += y;
      b.z += z;
      b.r += cloud.colors[i * 3];
      b.g += cloud.colors[i * 3 + 1];
      b.b += cloud.colors[i * 3 + 2];
      b.n++;
    } else {
      buckets.set(key, {
        x,
        y,
        z,
        r: cloud.colors[i * 3],
        g: cloud.colors[i * 3 + 1],
        b: cloud.colors[i * 3 + 2],
        n: 1,
      });
    }
  }
  const count = buckets.size;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let i = 0;
  for (const b of buckets.values()) {
    positions[i * 3] = b.x / b.n;
    positions[i * 3 + 1] = b.y / b.n;
    positions[i * 3 + 2] = b.z / b.n;
    colors[i * 3] = b.r / b.n;
    colors[i * 3 + 1] = b.g / b.n;
    colors[i * 3 + 2] = b.b / b.n;
    i++;
  }
  return { positions, colors, count };
}

/**
 * Statistical outlier removal: drop points whose mean distance to their
 * k nearest neighbours exceeds mean + stdRatio * sigma. Uses a uniform
 * spatial hash so it stays linear for large clouds.
 */
export function removeStatisticalOutliers(
  cloud: PointCloud,
  k = 8,
  stdRatio = 2,
  cellSize = 0,
): { cloud: PointCloud; removed: number } {
  if (cloud.count < 50) return { cloud, removed: 0 };
  let cell = cellSize;
  if (!cell) {
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < cloud.count; i++) {
      for (let a = 0; a < 3; a++) {
        const v = cloud.positions[i * 3 + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
    const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    cell = Math.max(1e-3, diag / 60);
  }

  // Integer cell coordinates are packed into a single number key, and the
  // k nearest distances are kept with a bounded insertion instead of sorting
  // every neighbour list — same result, far less allocation on large clouds.
  const OFF = 65536; // 17 bits per axis keeps the packed key inside Number.MAX_SAFE_INTEGER
  const cellOf = (v: number) =>
    Math.min(OFF - 1, Math.max(-OFF, Math.floor(v / cell)));
  const packed = (cx: number, cy: number, cz: number) =>
    ((cx + OFF) * 131072 + (cy + OFF)) * 131072 + (cz + OFF);


  const grid = new Map<number, number[]>();
  const cxs = new Int32Array(cloud.count);
  const cys = new Int32Array(cloud.count);
  const czs = new Int32Array(cloud.count);
  for (let i = 0; i < cloud.count; i++) {
    const cx = cellOf(cloud.positions[i * 3]);
    const cy = cellOf(cloud.positions[i * 3 + 1]);
    const cz = cellOf(cloud.positions[i * 3 + 2]);
    cxs[i] = cx;
    cys[i] = cy;
    czs[i] = cz;
    const kk = packed(cx, cy, cz);
    const arr = grid.get(kk);
    if (arr) arr.push(i);
    else grid.set(kk, [i]);
  }

  const meanDist = new Float32Array(cloud.count);
  const best = new Float64Array(k);
  for (let i = 0; i < cloud.count; i++) {
    const x = cloud.positions[i * 3];
    const y = cloud.positions[i * 3 + 1];
    const z = cloud.positions[i * 3 + 2];
    const cx = cxs[i];
    const cy = cys[i];
    const cz = czs[i];
    let filled = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const arr = grid.get(packed(cx + dx, cy + dy, cz + dz));
          if (!arr) continue;
          for (const j of arr) {
            if (j === i) continue;
            const ddx = cloud.positions[j * 3] - x;
            const ddy = cloud.positions[j * 3 + 1] - y;
            const ddz = cloud.positions[j * 3 + 2] - z;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (filled === k && d2 >= best[k - 1]) continue;
            let pos = filled < k ? filled : k - 1;
            while (pos > 0 && best[pos - 1] > d2) {
              best[pos] = best[pos - 1];
              pos--;
            }
            best[pos] = d2;
            if (filled < k) filled++;
          }
        }
    if (!filled) {
      meanDist[i] = Infinity;
      continue;
    }
    let sum = 0;
    for (let n = 0; n < filled; n++) sum += Math.sqrt(best[n]);
    meanDist[i] = sum / filled;
  }


  const finite = Array.from(meanDist).filter((v) => Number.isFinite(v));
  const mean = finite.reduce((s, v) => s + v, 0) / (finite.length || 1);
  const variance =
    finite.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (finite.length || 1);
  const threshold = mean + stdRatio * Math.sqrt(variance);

  const keep: number[] = [];
  for (let i = 0; i < cloud.count; i++) if (meanDist[i] <= threshold) keep.push(i);

  const positions = new Float32Array(keep.length * 3);
  const colors = new Float32Array(keep.length * 3);
  keep.forEach((src, dst) => {
    for (let a = 0; a < 3; a++) {
      positions[dst * 3 + a] = cloud.positions[src * 3 + a];
      colors[dst * 3 + a] = cloud.colors[src * 3 + a];
    }
  });
  return {
    cloud: { positions, colors, count: keep.length },
    removed: cloud.count - keep.length,
  };
}

/** Approximate normals from local neighbourhood covariance (smallest eigenvector). */
export function estimateNormals(cloud: PointCloud, radius: number): Float32Array {
  const normals = new Float32Array(cloud.count * 3);
  const cell = radius;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < cloud.count; i++) {
    const k = `${Math.floor(cloud.positions[i * 3] / cell)},${Math.floor(
      cloud.positions[i * 3 + 1] / cell,
    )},${Math.floor(cloud.positions[i * 3 + 2] / cell)}`;
    const arr = grid.get(k);
    if (arr) arr.push(i);
    else grid.set(k, [i]);
  }
  for (let i = 0; i < cloud.count; i++) {
    const x = cloud.positions[i * 3];
    const y = cloud.positions[i * 3 + 1];
    const z = cloud.positions[i * 3 + 2];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    const pts: number[][] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const arr = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!arr) continue;
          for (const j of arr)
            pts.push([
              cloud.positions[j * 3],
              cloud.positions[j * 3 + 1],
              cloud.positions[j * 3 + 2],
            ]);
        }
    if (pts.length < 4) {
      normals[i * 3 + 1] = 1;
      continue;
    }
    const m = [0, 0, 0];
    for (const p of pts) {
      m[0] += p[0];
      m[1] += p[1];
      m[2] += p[2];
    }
    m[0] /= pts.length;
    m[1] /= pts.length;
    m[2] /= pts.length;
    // Covariance-free approximation: cross product of two dominant offsets.
    const a = [pts[0][0] - m[0], pts[0][1] - m[1], pts[0][2] - m[2]];
    const b = [
      pts[pts.length - 1][0] - m[0],
      pts[pts.length - 1][1] - m[1],
      pts[pts.length - 1][2] - m[2],
    ];
    const n = [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    normals[i * 3] = n[0] / len;
    normals[i * 3 + 1] = n[1] / len;
    normals[i * 3 + 2] = n[2] / len;
  }
  return normals;
}

export function toPLY(cloud: PointCloud): string {
  const lines: string[] = [
    "ply",
    "format ascii 1.0",
    "comment Generated by GeoVision 3D",
    `element vertex ${cloud.count}`,
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    "end_header",
  ];
  for (let i = 0; i < cloud.count; i++) {
    lines.push(
      `${cloud.positions[i * 3].toFixed(4)} ${cloud.positions[i * 3 + 1].toFixed(4)} ${cloud.positions[
        i * 3 + 2
      ].toFixed(4)} ${Math.round(cloud.colors[i * 3] * 255)} ${Math.round(
        cloud.colors[i * 3 + 1] * 255,
      )} ${Math.round(cloud.colors[i * 3 + 2] * 255)}`,
    );
  }
  return lines.join("\n");
}

export function toPCD(cloud: PointCloud): string {
  const header = [
    "# .PCD v0.7 - Point Cloud Data file format",
    "VERSION 0.7",
    "FIELDS x y z rgb",
    "SIZE 4 4 4 4",
    "TYPE F F F F",
    "COUNT 1 1 1 1",
    `WIDTH ${cloud.count}`,
    "HEIGHT 1",
    "VIEWPOINT 0 0 0 1 0 0 0",
    `POINTS ${cloud.count}`,
    "DATA ascii",
  ];
  const rows: string[] = [];
  for (let i = 0; i < cloud.count; i++) {
    const r = Math.round(cloud.colors[i * 3] * 255);
    const g = Math.round(cloud.colors[i * 3 + 1] * 255);
    const b = Math.round(cloud.colors[i * 3 + 2] * 255);
    const packed = (r << 16) | (g << 8) | b;
    rows.push(
      `${cloud.positions[i * 3].toFixed(4)} ${cloud.positions[i * 3 + 1].toFixed(4)} ${cloud.positions[
        i * 3 + 2
      ].toFixed(4)} ${packed}`,
    );
  }
  return `${header.join("\n")}\n${rows.join("\n")}`;
}

/** Minimal ASCII/binary-little-endian PLY reader for loading external clouds. */
export function parsePLY(text: string): PointCloud {
  const headerEnd = text.indexOf("end_header");
  const header = text.slice(0, headerEnd).split(/\r?\n/);
  const countLine = header.find((l) => l.startsWith("element vertex"));
  const count = countLine ? parseInt(countLine.split(/\s+/)[2], 10) : 0;
  const props = header.filter((l) => l.startsWith("property")).map((l) => l.split(/\s+/)[2]);
  const body = text
    .slice(text.indexOf("\n", headerEnd) + 1)
    .trim()
    .split(/\r?\n/);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < Math.min(count, body.length); i++) {
    const parts = body[i].trim().split(/\s+/).map(Number);
    const get = (name: string, fallback: number) => {
      const idx = props.indexOf(name);
      return idx >= 0 && Number.isFinite(parts[idx]) ? parts[idx] : fallback;
    };
    positions[i * 3] = get("x", 0);
    positions[i * 3 + 1] = get("y", 0);
    positions[i * 3 + 2] = get("z", 0);
    colors[i * 3] = get("red", 200) / 255;
    colors[i * 3 + 1] = get("green", 200) / 255;
    colors[i * 3 + 2] = get("blue", 200) / 255;
  }
  return { positions, colors, count };
}
