import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Cpu, RotateCcw, Save, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { detectCapabilities, type Capabilities } from "@/lib/capabilities";
import type { PipelineParams } from "@/lib/cv/pipeline";
import { DEFAULT_PARAMS } from "@/lib/cv/pipeline";
import {
  loadPipelineDefaults,
  resetPipelineDefaults,
  savePipelineDefaults,
} from "@/lib/settings";

export const Route = createFileRoute("/settings")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Settings — Runtime Capabilities & Pipeline Defaults | GeoVision 3D" },
      {
        name: "description",
        content:
          "Inspect WebGL, WebGPU, WebCodecs and WASM SIMD support on this machine and edit the default GeoVision 3D reconstruction parameters.",
      },
      { property: "og:title", content: "Settings — Capabilities & Pipeline Defaults" },
      {
        property: "og:description",
        content:
          "Live browser capability detection plus editable defaults for frame sampling, keyframes, depth and point-cloud density.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [params, setParams] = useState<PipelineParams>(DEFAULT_PARAMS);

  useEffect(() => {
    setCaps(detectCapabilities());
    setParams(loadPipelineDefaults());
  }, []);

  function patch(next: Partial<PipelineParams>) {
    setParams((prev) => ({ ...prev, ...next }));
  }

  return (
    <AppShell
      title="Settings"
      subtitle="Everything below is measured on this device. Pipeline defaults are applied to every new reconstruction."
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              setParams(resetPipelineDefaults());
              toast.success("Pipeline defaults reset");
            }}
          >
            <RotateCcw className="mr-2 h-4 w-4" /> Reset
          </Button>
          <Button
            onClick={() => {
              savePipelineDefaults(params);
              toast.success("Pipeline defaults saved");
            }}
          >
            <Save className="mr-2 h-4 w-4" /> Save defaults
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="h-4 w-4 text-accent" /> Runtime capabilities
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!caps ? (
              <p className="text-sm text-muted-foreground">Detecting…</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 font-mono text-xs">
                  <Badge variant="secondary">{caps.cores} logical cores</Badge>
                  {caps.memoryGb ? (
                    <Badge variant="secondary">{caps.memoryGb} GB device memory</Badge>
                  ) : null}
                  {caps.gpu ? <Badge variant="secondary">{caps.gpu}</Badge> : null}
                  <Badge variant={caps.advancedAvailable ? "default" : "secondary"}>
                    {caps.advancedAvailable ? "Advanced mode available" : "Demo mode only"}
                  </Badge>
                </div>
                <ul className="divide-y divide-border">
                  {caps.list.map((c) => (
                    <li key={c.id} className="flex items-start gap-3 py-3">
                      <span
                        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                          c.available
                            ? "bg-accent/20 text-accent"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {c.available ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{c.label}</p>
                        <p className="text-xs text-muted-foreground">{c.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline defaults</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="mode">Advanced mode by default</Label>
                <p className="text-xs text-muted-foreground">
                  Denser sampling and stricter matching. Requires WebGPU or WASM SIMD.
                </p>
              </div>
              <Switch
                id="mode"
                checked={params.mode === "ADVANCED"}
                disabled={!caps?.advancedAvailable}
                onCheckedChange={(v) => patch({ mode: v ? "ADVANCED" : "DEMO" })}
              />
            </div>

            <Field
              label="Frame interval"
              value={`${params.intervalSeconds.toFixed(2)} s`}
              min={0.1}
              max={3}
              step={0.1}
              current={params.intervalSeconds}
              onChange={(v) => patch({ intervalSeconds: v })}
            />
            <Field
              label="Max extracted frames"
              value={String(params.maxFrames)}
              min={10}
              max={240}
              step={5}
              current={params.maxFrames}
              onChange={(v) => patch({ maxFrames: Math.round(v) })}
            />
            <Field
              label="Processing width"
              value={`${params.processWidth} px`}
              min={160}
              max={960}
              step={20}
              current={params.processWidth}
              onChange={(v) => patch({ processWidth: Math.round(v) })}
            />
            <Field
              label="Max keyframes"
              value={String(params.maxKeyframes)}
              min={4}
              max={60}
              step={1}
              current={params.maxKeyframes}
              onChange={(v) => patch({ maxKeyframes: Math.round(v) })}
            />
            <Field
              label="Depth sampling stride"
              value={`${params.depthStride} px`}
              min={1}
              max={8}
              step={1}
              current={params.depthStride}
              onChange={(v) => patch({ depthStride: Math.round(v) })}
            />
            <Field
              label="Max depth"
              value={`${params.maxDepth} u`}
              min={10}
              max={200}
              step={5}
              current={params.maxDepth}
              onChange={(v) => patch({ maxDepth: Math.round(v) })}
            />
            <Field
              label="Voxel size"
              value={params.voxelSize.toFixed(2)}
              min={0.02}
              max={1}
              step={0.02}
              current={params.voxelSize}
              onChange={(v) => patch({ voxelSize: Number(v.toFixed(2)) })}
            />

            <div className="space-y-2">
              <Label htmlFor="endpoint">Optional depth-model endpoint</Label>
              <Input
                id="endpoint"
                placeholder="https://…/depth (leave blank to use the built-in estimator)"
                value={params.modelEndpoint ?? ""}
                onChange={(e) => patch({ modelEndpoint: e.target.value.trim() || null })}
              />
              <p className="text-xs text-muted-foreground">
                When set, Advanced mode posts keyframes to this endpoint and falls back to the
                built-in multi-cue estimator if it is unreachable.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Field({
  label,
  value,
  min,
  max,
  step,
  current,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  current: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">{value}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[current]}
        onValueChange={([v]) => onChange(v ?? current)}
      />
    </div>
  );
}
