// Persisted pipeline defaults, editable from the Settings page. Stored in
// localStorage so a new reconstruction starts from the user's own presets.

import { DEFAULT_PARAMS, type PipelineParams } from "./cv/pipeline";

const KEY = "geovision3d.pipeline-defaults";

export function loadPipelineDefaults(): PipelineParams {
  if (typeof localStorage === "undefined") return { ...DEFAULT_PARAMS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PARAMS };
    const parsed = JSON.parse(raw) as Partial<PipelineParams>;
    return { ...DEFAULT_PARAMS, ...parsed };
  } catch {
    return { ...DEFAULT_PARAMS };
  }
}

export function savePipelineDefaults(params: PipelineParams): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(params));
  } catch {
    /* storage disabled — defaults stay in memory for this session */
  }
}

export function resetPipelineDefaults(): PipelineParams {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
  return { ...DEFAULT_PARAMS };
}
