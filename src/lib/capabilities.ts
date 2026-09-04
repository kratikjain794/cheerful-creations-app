// Runtime capability detection. Drives DEMO vs ADVANCED mode and the
// "system status" panel — nothing here ever throws.

export type Capability = {
  id: string;
  label: string;
  available: boolean;
  detail: string;
};

export type Capabilities = {
  list: Capability[];
  advancedAvailable: boolean;
  cores: number;
  memoryGb: number | null;
  gpu: string | null;
};

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function detectCapabilities(): Capabilities {
  if (typeof window === "undefined") {
    return { list: [], advancedAvailable: false, cores: 0, memoryGb: null, gpu: null };
  }

  const canvas = safe(() => document.createElement("canvas"), null as HTMLCanvasElement | null);
  const gl = canvas
    ? safe(() => canvas.getContext("webgl2") ?? canvas.getContext("webgl"), null)
    : null;
  let gpu: string | null = null;
  if (gl) {
    const info = safe(() => gl.getExtension("WEBGL_debug_renderer_info"), null);
    if (info) gpu = safe(() => gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string, null);
  }

  const hasWebGpu = safe(() => "gpu" in navigator, false);
  const hasWebCodecs = safe(() => typeof (window as unknown as { VideoDecoder?: unknown }).VideoDecoder !== "undefined", false);
  const hasWasmSimd = safe(
    () =>
      WebAssembly.validate(
        new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 26, 11]),
      ),
    false,
  );
  const hasWorkers = safe(() => typeof Worker !== "undefined", false);
  const cores = safe(() => navigator.hardwareConcurrency ?? 2, 2);
  const memoryGb = safe(
    () => (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
    null,
  );

  const list: Capability[] = [
    {
      id: "cpu-pipeline",
      label: "CPU reconstruction pipeline",
      available: true,
      detail: `${cores} logical cores — always available (Demo mode)`,
    },
    {
      id: "webgl",
      label: "WebGL 3D rendering",
      available: !!gl,
      detail: gl ? (gpu ?? "Hardware accelerated") : "Software rendering fallback",
    },
    {
      id: "webgpu",
      label: "WebGPU acceleration",
      available: hasWebGpu,
      detail: hasWebGpu ? "Available for accelerated inference" : "Not exposed — CPU path used",
    },
    {
      id: "webcodecs",
      label: "WebCodecs decoding",
      available: hasWebCodecs,
      detail: hasWebCodecs ? "Fast frame decoding available" : "Falling back to canvas seeking",
    },
    {
      id: "wasm-simd",
      label: "WASM SIMD",
      available: hasWasmSimd,
      detail: hasWasmSimd ? "Vectorised math supported" : "Scalar math only",
    },
    {
      id: "workers",
      label: "Background workers",
      available: hasWorkers,
      detail: hasWorkers ? "Processing can yield to the UI" : "Single-threaded processing",
    },
    {
      id: "colmap",
      label: "COLMAP dense SfM",
      available: false,
      detail: "Native binary — unavailable in the browser runtime; OpenCV-style fallback used",
    },
    {
      id: "yolo",
      label: "YOLO dynamic-object masking",
      available: hasWebGpu,
      detail: hasWebGpu
        ? "Can run when a model endpoint is configured in Settings"
        : "Disabled gracefully — no accelerated inference backend",
    },
  ];

  return { list, advancedAvailable: hasWebGpu || hasWasmSimd, cores, memoryGb, gpu };
}
