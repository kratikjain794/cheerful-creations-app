// Project persistence. Projects, metrics and generated point clouds are stored
// in IndexedDB so reconstructions survive reloads and can be reopened, exported
// or deleted. All access is guarded — a blocked/unavailable IndexedDB degrades
// to an in-memory store instead of crashing the app.

import type { PointCloud, ProjectMeta } from "./cv/types";

const DB_NAME = "geovision3d";
const DB_VERSION = 2;
const PROJECTS = "projects";
const CLOUDS = "clouds";
const JOBS = "jobs";

export type PendingJob = {
  id: string;
  video: File;
  metadata: File | null;
  params: unknown;
};

const memoryProjects = new Map<string, ProjectMeta>();
const memoryClouds = new Map<string, PointCloud>();
const memoryJobs = new Map<string, PendingJob>();
let useMemory = false;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CLOUDS)) db.createObjectStore(CLOUDS);
      if (!db.objectStoreNames.contains(JOBS)) db.createObjectStore(JOBS, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  if (useMemory) return null;
  try {
    const db = await openDb();
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const req = fn(tx.objectStore(name));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    useMemory = true;
    return null;
  }
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await withStore<ProjectMeta[]>(PROJECTS, "readonly", (s) => s.getAll());
  const rows = all ?? Array.from(memoryProjects.values());
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getProject(id: string): Promise<ProjectMeta | null> {
  const row = await withStore<ProjectMeta>(PROJECTS, "readonly", (s) => s.get(id));
  return row ?? memoryProjects.get(id) ?? null;
}

export async function saveProject(project: ProjectMeta): Promise<void> {
  memoryProjects.set(project.id, project);
  await withStore(PROJECTS, "readwrite", (s) => s.put(project));
}

export async function deleteProject(id: string): Promise<void> {
  memoryProjects.delete(id);
  memoryClouds.delete(id);
  await withStore(PROJECTS, "readwrite", (s) => s.delete(id));
  await withStore(CLOUDS, "readwrite", (s) => s.delete(id));
}

export async function saveCloud(id: string, cloud: PointCloud): Promise<void> {
  memoryClouds.set(id, cloud);
  await withStore(CLOUDS, "readwrite", (s) => s.put(cloud, id));
}

export async function getCloud(id: string): Promise<PointCloud | null> {
  const row = await withStore<PointCloud>(CLOUDS, "readonly", (s) => s.get(id));
  return row ?? memoryClouds.get(id) ?? null;
}

export async function saveJob(job: PendingJob): Promise<void> {
  memoryJobs.set(job.id, job);
  await withStore(JOBS, "readwrite", (s) => s.put(job));
}

export async function getJob(id: string): Promise<PendingJob | null> {
  const row = await withStore<PendingJob>(JOBS, "readonly", (s) => s.get(id));
  return row ?? memoryJobs.get(id) ?? null;
}

export async function deleteJob(id: string): Promise<void> {
  memoryJobs.delete(id);
  await withStore(JOBS, "readwrite", (s) => s.delete(id));
}

export function newProjectId(): string {
  return `prj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyProject(name: string, description: string): ProjectMeta {
  return {
    id: newProjectId(),
    name,
    description,
    createdAt: Date.now(),
    status: "created",
    video: null,
    metadataFile: null,
    stats: null,
    quality: [],
    poses: [],
    gps: [],
    matches: [],
    depthPreviews: [],
    logs: [],
  };
}

export function downloadBlob(filename: string, content: BlobPart, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
