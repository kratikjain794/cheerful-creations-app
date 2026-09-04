// Video validation, probing and frame extraction using HTMLVideoElement +
// canvas seeking. Runs entirely on CPU in the browser.

import { toGray } from "./image";
import type { GrayFrame } from "./types";

export type VideoInfo = {
  name: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
};

export class VideoError extends Error {}

const SUPPORTED = [".mp4", ".mov", ".webm", ".m4v", ".ogv"];

export function validateVideoFile(file: File): { ok: true } | { ok: false; message: string } {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".avi")) {
    return {
      ok: false,
      message:
        "AVI cannot be decoded by browsers. Convert to MP4 (H.264) first, e.g. ffmpeg -i input.avi -c:v libx264 output.mp4",
    };
  }
  if (!SUPPORTED.some((ext) => lower.endsWith(ext)) && !file.type.startsWith("video/")) {
    return { ok: false, message: "Unsupported file type. Use MP4, MOV or WebM." };
  }
  if (file.size === 0) return { ok: false, message: "The file is empty or unreadable." };
  if (file.size > 500 * 1024 * 1024) {
    return { ok: false, message: "File is larger than 500 MB — trim the clip before uploading." };
  }
  return { ok: true };
}

export function createVideoElement(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = url;
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
    };
    video.onloadedmetadata = () => {
      cleanup();
      if (!video.videoWidth || !video.videoHeight) {
        reject(new VideoError("The video has no decodable image track."));
        return;
      }
      resolve(video);
    };
    video.onerror = () => {
      cleanup();
      reject(new VideoError("The browser could not decode this video file."));
    };
    setTimeout(() => reject(new VideoError("Timed out while reading the video.")), 30000);
  });
}

/** Probe duration, resolution and an FPS estimate from decoded frame callbacks. */
export async function probeVideo(file: File): Promise<VideoInfo> {
  const url = URL.createObjectURL(file);
  try {
    const video = await createVideoElement(url);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const fps = await estimateFps(video);
    return {
      name: file.name,
      size: file.size,
      duration,
      width: video.videoWidth,
      height: video.videoHeight,
      fps,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
};

async function estimateFps(video: HTMLVideoElement): Promise<number> {
  const v = video as VideoWithFrameCallback;
  if (typeof v.requestVideoFrameCallback !== "function") return 30;
  return new Promise<number>((resolve) => {
    const times: number[] = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.pause();
      if (times.length < 3) return resolve(30);
      const deltas: number[] = [];
      for (let i = 1; i < times.length; i++) {
        const d = times[i] - times[i - 1];
        if (d > 0.001) deltas.push(d);
      }
      if (!deltas.length) return resolve(30);
      deltas.sort((a, b) => a - b);
      const median = deltas[Math.floor(deltas.length / 2)];
      resolve(Math.min(120, Math.max(1, Math.round(1 / median))));
    };
    const tick = (_now: number, meta: { mediaTime: number }) => {
      times.push(meta.mediaTime);
      if (times.length >= 12) finish();
      else v.requestVideoFrameCallback?.(tick);
    };
    v.requestVideoFrameCallback?.(tick);
    video.play().catch(() => resolve(30));
    setTimeout(finish, 3000);
  });
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    const timer = setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      reject(new VideoError(`Seek to ${time.toFixed(2)}s timed out.`));
    }, 10000);
    const wrapped = () => clearTimeout(timer);
    video.addEventListener("seeked", wrapped, { once: true });
    video.currentTime = Math.min(time, Math.max(0, (video.duration || time) - 0.02));
  });
}

export type ExtractOptions = {
  intervalSeconds: number;
  maxFrames: number;
  processWidth: number;
  onFrame?: (frame: GrayFrame, done: number, total: number) => void;
};

/** Extract frames at a fixed interval, downscaled for CPU processing. */
export async function extractFrames(
  file: File,
  options: ExtractOptions,
): Promise<{ frames: GrayFrame[]; info: VideoInfo }> {
  const url = URL.createObjectURL(file);
  try {
    const video = await createVideoElement(url);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (!duration) throw new VideoError("Could not determine the video duration.");

    const scale = Math.min(1, options.processWidth / video.videoWidth);
    const w = Math.max(64, Math.round(video.videoWidth * scale));
    const h = Math.max(64, Math.round(video.videoHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new VideoError("Canvas 2D is unavailable in this browser.");

    const thumbCanvas = document.createElement("canvas");
    const thumbScale = Math.min(1, 240 / w);
    thumbCanvas.width = Math.round(w * thumbScale);
    thumbCanvas.height = Math.round(h * thumbScale);
    const thumbCtx = thumbCanvas.getContext("2d");

    const times: number[] = [];
    for (let t = 0; t < duration && times.length < options.maxFrames; t += options.intervalSeconds) {
      times.push(t);
    }

    const frames: GrayFrame[] = [];
    for (let i = 0; i < times.length; i++) {
      try {
        await seek(video, times[i]);
      } catch {
        continue; // Skip unseekable positions rather than aborting the run.
      }
      ctx.drawImage(video, 0, 0, w, h);
      const image = ctx.getImageData(0, 0, w, h);
      let thumbnail = "";
      if (thumbCtx) {
        thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
        thumbnail = thumbCanvas.toDataURL("image/jpeg", 0.6);
      }
      const frame: GrayFrame = {
        index: i,
        timestamp: times[i],
        width: w,
        height: h,
        gray: toGray(image.data, w, h),
        rgb: image.data,
        thumbnail,
      };
      frames.push(frame);
      options.onFrame?.(frame, i + 1, times.length);
      await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
    }

    if (!frames.length) throw new VideoError("No frames could be extracted from this video.");

    return {
      frames,
      info: {
        name: file.name,
        size: file.size,
        duration,
        width: video.videoWidth,
        height: video.videoHeight,
        fps: 0,
      },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function imageDataToDataUrl(image: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.7);
}
