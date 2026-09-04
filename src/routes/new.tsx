import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { FileVideo, MapPin, Rocket } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_PARAMS, type PipelineParams } from "@/lib/cv/pipeline";
import { loadPipelineDefaults } from "@/lib/settings";
import { probeVideo, validateVideoFile, type VideoInfo } from "@/lib/cv/video";
import { parseMetadata } from "@/lib/cv/geo";
import { emptyProject, saveJob, saveProject } from "@/lib/store";
import type { GpsSample } from "@/lib/cv/types";

export const Route = createFileRoute("/new")({
  head: () => ({
    meta: [
      { title: "New Reconstruction — Upload Drone Video | GeoVision 3D" },
      {
        name: "description",
        content:
          "Upload an MP4, MOV or WebM drone flight plus an optional GPS track and configure the GeoVision 3D reconstruction parameters.",
      },
      { property: "og:title", content: "New Reconstruction — Upload Drone Video" },
      {
        property: "og:description",
        content: "Validate footage, attach a GPS/IMU track and launch a full in-browser 3D reconstruction.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NewReconstruction,
});

function NewReconstruction() {
  const navigate = useNavigate();
  const [name, setName] = useState("Flight reconstruction");
  const [description, setDescription] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<File | null>(null);
  const [gps, setGps] = useState<GpsSample[]>([]);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [params, setParams] = useState<PipelineParams>(DEFAULT_PARAMS);

  // Apply the defaults saved on the Settings page (client-only storage).
  useEffect(() => {
    setParams(loadPipelineDefaults());
  }, []);
  const [busy, setBusy] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  async function onVideo(file: File | null) {
    setVideoInfo(null);
    setVideoError(null);
    setVideo(null);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setPreviewUrl(null);
    if (!file) return;

    const check = validateVideoFile(file);
    if (!check.ok) {
      setVideoError(check.message);
      return;
    }
    try {
      const info = await probeVideo(file);
      setVideo(file);
      setVideoInfo(info);
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      setPreviewUrl(url);
      if (name === "Flight reconstruction") setName(file.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : "This video could not be decoded by the browser.");
    }
  }

  async function onMetadata(file: File | null) {
    setGps([]);
    setGpsError(null);
    setMetadata(null);
    if (!file) return;
    const text = await file.text();
    const samples = parseMetadata(file.name, text);
    if (!samples.length) {
      setGpsError("No usable GPS samples found — the run will use a LOCAL coordinate frame.");
    }
    setMetadata(file);
    setGps(samples);
  }

  async function launch() {
    if (!video) return;
    setBusy(true);
    const project = emptyProject(name.trim() || "Untitled reconstruction", description.trim());
    await saveProject(project);
    await saveJob({ id: project.id, video, metadata, params });
    navigate({ to: "/processing/$id", params: { id: project.id } });
  }

  return (
    <AppShell
      title="New reconstruction"
      subtitle="Upload a continuous drone pass. Frames, features, poses, depth and the point cloud are computed on this machine."
    >
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileVideo className="h-4 w-4 text-accent" /> Video
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                type="file"
                accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                onChange={(e) => onVideo(e.target.files?.[0] ?? null)}
              />
              {videoError ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {videoError}
                </p>
              ) : null}
              {previewUrl ? (
                <video src={previewUrl} controls className="w-full rounded-md border border-border" />
              ) : null}
              {videoInfo ? (
                <dl className="grid grid-cols-2 gap-3 font-mono text-xs sm:grid-cols-4">
                  <Meta label="Resolution" value={`${videoInfo.width}×${videoInfo.height}`} />
                  <Meta label="Duration" value={`${videoInfo.duration.toFixed(2)} s`} />
                  <Meta label="Size" value={`${(videoInfo.size / 1e6).toFixed(1)} MB`} />
                  <Meta label="FPS (est.)" value={videoInfo.fps ? videoInfo.fps.toFixed(1) : "n/a"} />
                </dl>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4 text-primary" /> Flight metadata (optional)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                type="file"
                accept=".csv,.json,.gpx,text/csv,application/json"
                onChange={(e) => onMetadata(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                CSV, JSON or GPX with latitude/longitude/altitude (and optional timestamp, yaw). Without it the
                reconstruction stays in a LOCAL metric frame.
              </p>
              {metadata ? (
                <Badge variant={gps.length ? "default" : "secondary"}>
                  {gps.length ? `${gps.length} GPS samples parsed` : "no samples parsed"}
                </Badge>
              ) : null}
              {gpsError ? <p className="text-xs text-muted-foreground">{gpsError}</p> : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Project</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="project-name">Name</Label>
                <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-desc">Description</Label>
                <Textarea
                  id="project-desc"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Site, flight altitude, camera…"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pipeline parameters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="advanced">Advanced mode</Label>
                  <p className="text-xs text-muted-foreground">
                    More keypoints per frame and an external depth-model hook when configured.
                  </p>
                </div>
                <Switch
                  id="advanced"
                  checked={params.mode === "ADVANCED"}
                  onCheckedChange={(v) => setParams((p) => ({ ...p, mode: v ? "ADVANCED" : "DEMO" }))}
                />
              </div>
              <SliderRow
                label="Frame interval"
                value={params.intervalSeconds}
                min={0.2}
                max={2}
                step={0.1}
                suffix=" s"
                onChange={(v) => setParams((p) => ({ ...p, intervalSeconds: v }))}
              />
              <SliderRow
                label="Max frames"
                value={params.maxFrames}
                min={10}
                max={150}
                step={5}
                onChange={(v) => setParams((p) => ({ ...p, maxFrames: v }))}
              />
              <SliderRow
                label="Processing width"
                value={params.processWidth}
                min={192}
                max={640}
                step={32}
                suffix=" px"
                onChange={(v) => setParams((p) => ({ ...p, processWidth: v }))}
              />
              <SliderRow
                label="Max keyframes"
                value={params.maxKeyframes}
                min={4}
                max={40}
                step={1}
                onChange={(v) => setParams((p) => ({ ...p, maxKeyframes: v }))}
              />
              <SliderRow
                label="Unprojection stride"
                value={params.depthStride}
                min={1}
                max={8}
                step={1}
                suffix=" px"
                onChange={(v) => setParams((p) => ({ ...p, depthStride: v }))}
              />
              <SliderRow
                label="Voxel size"
                value={params.voxelSize}
                min={0.02}
                max={0.6}
                step={0.02}
                suffix=" u"
                onChange={(v) => setParams((p) => ({ ...p, voxelSize: v }))}
              />
            </CardContent>
          </Card>

          <Button className="w-full" size="lg" disabled={!video || busy} onClick={launch}>
            <Rocket className="mr-2 h-4 w-4" />
            {busy ? "Starting…" : "Start reconstruction"}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">
          {value}
          {suffix}
        </span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}
