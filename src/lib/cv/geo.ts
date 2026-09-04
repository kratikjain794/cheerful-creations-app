// GPS / flight-metadata parsing (CSV, JSON, GPX) and georeferencing:
// WGS84 -> local ENU, plus Umeyama similarity alignment of the visual
// trajectory onto the GPS track.

import type { GpsSample, Pose } from "./types";

const EARTH_A = 6378137.0;
const EARTH_F = 1 / 298.257223563;
const E2 = EARTH_F * (2 - EARTH_F);

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : NaN;
}

function pick(obj: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const hit = Object.keys(obj).find((o) => o.toLowerCase().replace(/[\s_-]/g, "") === k);
    if (hit !== undefined) {
      const v = num(obj[hit]);
      if (Number.isFinite(v)) return v;
    }
  }
  return NaN;
}

function normalizeSamples(rows: Record<string, unknown>[]): GpsSample[] {
  const out: GpsSample[] = [];
  let t0: number | null = null;
  rows.forEach((row, i) => {
    const lat = pick(row, ["lat", "latitude", "gpslatitude", "y"]);
    const lon = pick(row, ["lon", "lng", "long", "longitude", "gpslongitude", "x"]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const alt = pick(row, ["alt", "altitude", "elevation", "ele", "height", "relativealtitude"]);
    let ts = pick(row, ["timestamp", "time", "t", "seconds", "elapsed"]);
    if (!Number.isFinite(ts)) {
      const raw = Object.entries(row).find(([k]) => /time|date/i.test(k))?.[1];
      const parsed = raw ? Date.parse(String(raw)) : NaN;
      ts = Number.isFinite(parsed) ? parsed / 1000 : i;
    }
    if (t0 === null) t0 = ts;
    out.push({
      timestamp: ts - t0,
      lat,
      lon,
      alt: Number.isFinite(alt) ? alt : 0,
      yaw: pick(row, ["yaw", "heading", "compassheading"]) || undefined,
      pitch: pick(row, ["pitch"]) || undefined,
      roll: pick(row, ["roll"]) || undefined,
    });
  });
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

function parseCsv(text: string): Record<string, unknown>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const delim = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const cells = line.split(delim);
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? "").trim().replace(/^"|"$/g, "");
    });
    return row;
  });
}

function parseGpx(text: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const re = /<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const inner = m[3];
    rows.push({
      lat: m[1],
      lon: m[2],
      ele: /<ele>([-\d.]+)<\/ele>/.exec(inner)?.[1] ?? "0",
      time: /<time>([^<]+)<\/time>/.exec(inner)?.[1] ?? "",
    });
  }
  if (!rows.length) {
    const single = /<(?:trkpt|wpt)[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*\/>/g;
    while ((m = single.exec(text))) rows.push({ lat: m[1], lon: m[2], ele: 0 });
  }
  return rows;
}

/** Parse a metadata file. Returns [] for unsupported/empty content — never throws. */
export function parseMetadata(filename: string, text: string): GpsSample[] {
  try {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".json")) {
      const data = JSON.parse(text);
      const arr: unknown[] = Array.isArray(data)
        ? data
        : (data.samples ?? data.track ?? data.points ?? data.data ?? []);
      return normalizeSamples(arr as Record<string, unknown>[]);
    }
    if (lower.endsWith(".gpx") || text.trim().startsWith("<?xml")) {
      return normalizeSamples(parseGpx(text));
    }
    return normalizeSamples(parseCsv(text));
  } catch {
    return [];
  }
}

/** Geodetic -> local ENU metres relative to an origin. */
export function geodeticToEnu(
  lat: number,
  lon: number,
  alt: number,
  origin: { lat: number; lon: number; alt: number },
): [number, number, number] {
  const toRad = Math.PI / 180;
  const lat0 = origin.lat * toRad;
  const sinLat = Math.sin(lat0);
  const N = EARTH_A / Math.sqrt(1 - E2 * sinLat * sinLat);
  const dLat = (lat - origin.lat) * toRad;
  const dLon = (lon - origin.lon) * toRad;
  const east = dLon * (N * Math.cos(lat0));
  const north = dLat * (N * (1 - E2)) / (1 - E2 * sinLat * sinLat);
  return [east, alt - origin.alt, north];
}

export function enuToGeodetic(
  east: number,
  up: number,
  north: number,
  origin: { lat: number; lon: number; alt: number },
): { lat: number; lon: number; alt: number } {
  const toRad = Math.PI / 180;
  const lat0 = origin.lat * toRad;
  const sinLat = Math.sin(lat0);
  const N = EARTH_A / Math.sqrt(1 - E2 * sinLat * sinLat);
  const lat = origin.lat + (north * (1 - E2 * sinLat * sinLat)) / (N * (1 - E2)) / toRad;
  const lon = origin.lon + east / (N * Math.cos(lat0)) / toRad;
  return { lat, lon, alt: origin.alt + up };
}

export type Alignment = {
  scale: number;
  rotationY: number;
  translation: [number, number, number];
  rmse: number;
};

/** Umeyama similarity alignment restricted to yaw + uniform scale (robust for drone tracks). */
export function alignTrajectory(
  source: [number, number, number][],
  target: [number, number, number][],
): Alignment | null {
  const n = Math.min(source.length, target.length);
  if (n < 2) return null;
  const meanS = [0, 0, 0];
  const meanT = [0, 0, 0];
  for (let i = 0; i < n; i++)
    for (let a = 0; a < 3; a++) {
      meanS[a] += source[i][a] / n;
      meanT[a] += target[i][a] / n;
    }
  let sxx = 0;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const sx = source[i][0] - meanS[0];
    const sz = source[i][2] - meanS[2];
    const tx = target[i][0] - meanT[0];
    const tz = target[i][2] - meanT[2];
    num += tx * sz - tz * sx;
    den += tx * sx + tz * sz;
    sxx += sx * sx + sz * sz;
  }
  const rotationY = Math.atan2(num, den);
  const scaleNum = Math.hypot(num, den);
  const scale = sxx > 1e-9 ? scaleNum / sxx : 1;
  const c = Math.cos(rotationY) * scale;
  const s = Math.sin(rotationY) * scale;
  const translation: [number, number, number] = [
    meanT[0] - (c * meanS[0] + s * meanS[2]),
    meanT[1] - scale * meanS[1],
    meanT[2] - (-s * meanS[0] + c * meanS[2]),
  ];

  let err = 0;
  for (let i = 0; i < n; i++) {
    const p = applyAlignment(source[i], { scale, rotationY, translation, rmse: 0 });
    err += (p[0] - target[i][0]) ** 2 + (p[1] - target[i][1]) ** 2 + (p[2] - target[i][2]) ** 2;
  }
  return { scale, rotationY, translation, rmse: Math.sqrt(err / n) };
}

export function applyAlignment(
  p: [number, number, number],
  a: Alignment,
): [number, number, number] {
  const c = Math.cos(a.rotationY) * a.scale;
  const s = Math.sin(a.rotationY) * a.scale;
  return [
    c * p[0] + s * p[2] + a.translation[0],
    a.scale * p[1] + a.translation[1],
    -s * p[0] + c * p[2] + a.translation[2],
  ];
}

/** Nearest GPS sample by timestamp. */
export function sampleAt(track: GpsSample[], t: number): GpsSample | null {
  if (!track.length) return null;
  let best = track[0];
  let bestD = Math.abs(track[0].timestamp - t);
  for (const s of track) {
    const d = Math.abs(s.timestamp - t);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export function trajectoryToCsv(
  poses: Pose[],
  origin: { lat: number; lon: number; alt: number } | null,
): string {
  const header = origin
    ? "frame,timestamp,x,y,z,latitude,longitude,altitude,yaw_deg"
    : "frame,timestamp,x,y,z,yaw_deg";
  const rows = poses.map((p) => {
    const yawDeg = ((p.yaw * 180) / Math.PI).toFixed(3);
    if (origin) {
      const g = enuToGeodetic(p.position[0], p.position[1], p.position[2], origin);
      return `${p.frameIndex},${p.timestamp.toFixed(3)},${p.position[0].toFixed(3)},${p.position[1].toFixed(
        3,
      )},${p.position[2].toFixed(3)},${g.lat.toFixed(8)},${g.lon.toFixed(8)},${g.alt.toFixed(3)},${yawDeg}`;
    }
    return `${p.frameIndex},${p.timestamp.toFixed(3)},${p.position[0].toFixed(3)},${p.position[1].toFixed(
      3,
    )},${p.position[2].toFixed(3)},${yawDeg}`;
  });
  return [header, ...rows].join("\n");
}
