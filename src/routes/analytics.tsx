import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listProjects } from "@/lib/store";
import type { ProjectMeta } from "@/lib/cv/types";

export const Route = createFileRoute("/analytics")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { project?: string } =>
    typeof search['project'] === "string" ? { project: search['project'] as string } : {},
  head: () => ({
    meta: [
      { title: "Analytics — Reconstruction Metrics | GeoVision 3D" },
      {
        name: "description",
        content:
          "Frame quality distributions, per-frame sharpness and exposure, feature-match counts and pipeline timings measured during reconstruction.",
      },
      { property: "og:title", content: "Analytics — Reconstruction Metrics" },
      {
        property: "og:description",
        content: "Every chart is generated from the real metrics recorded while the pipeline ran.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const search = Route.useSearch();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [selected, setSelected] = useState<string | undefined>(search.project);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listProjects()
      .then((all) => {
        const usable = all.filter((p) => p.quality.length > 0);
        setProjects(usable);
        setSelected((cur) => cur ?? usable[0]?.id);
      })
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  const project = projects.find((p) => p.id === selected) ?? null;

  const qualityBuckets = useMemo(() => {
    if (!project) return [];
    const buckets = Array.from({ length: 10 }, (_, i) => ({
      range: `${i * 10}-${i * 10 + 10}`,
      frames: 0,
    }));
    for (const q of project.quality) {
      const idx = Math.min(9, Math.max(0, Math.floor(q.score / 10)));
      buckets[idx].frames++;
    }
    return buckets;
  }, [project]);

  const perFrame = useMemo(
    () =>
      project?.quality.map((q) => ({
        frame: q.index,
        score: Number(q.score.toFixed(1)),
        sharpness: Number(q.sharpness.toFixed(1)),
        brightness: Number(q.brightness.toFixed(1)),
        motion: Number(q.motion.toFixed(2)),
      })) ?? [],
    [project],
  );

  const matchData = useMemo(
    () =>
      project?.matches.map((m) => ({
        pair: `${m.from}→${m.to}`,
        raw: m.raw,
        inliers: m.inliers,
      })) ?? [],
    [project],
  );

  const trajectory = useMemo(
    () =>
      project?.poses.map((p, i) => ({
        keyframe: i,
        x: Number(p.position[0].toFixed(3)),
        y: Number(p.position[1].toFixed(3)),
        z: Number(p.position[2].toFixed(3)),
      })) ?? [],
    [project],
  );

  const stats = project?.stats;

  return (
    <AppShell
      title="Analytics"
      subtitle="Charts are built entirely from the measurements recorded by the pipeline during the run."
      actions={
        projects.length > 1 ? (
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading metrics…</p>
      ) : !project ? (
        <Card>
          <CardContent className="space-y-3 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              No reconstruction has produced metrics yet.
            </p>
            <Button asChild>
              <Link to="/new">Run a reconstruction</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Frames analysed" value={String(project.quality.length)} />
            <Stat label="Keyframes" value={stats ? String(stats.keyframes) : "—"} />
            <Stat
              label="Inlier ratio"
              value={
                stats && stats.rawMatches
                  ? `${((stats.goodMatches / stats.rawMatches) * 100).toFixed(1)}%`
                  : "—"
              }
            />
            <Stat label="Points" value={stats ? stats.pointCount.toLocaleString() : "—"} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{stats?.mode ?? "—"} mode</Badge>
            <Badge variant="secondary">{stats?.coordinateMode ?? "LOCAL"}</Badge>
            <Badge variant="secondary">
              total runtime {stats ? (stats.processingMs / 1000).toFixed(1) : "—"}s
            </Badge>
            <Badge variant="secondary">
              mean quality {stats ? stats.avgQuality.toFixed(1) : "—"}/100
            </Badge>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <ChartCard title="Frame quality distribution">
              <BarChart data={qualityBuckets}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="range" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="frames" fill="hsl(var(--primary))" />
              </BarChart>
            </ChartCard>

            <ChartCard title="Per-frame quality metrics">
              <LineChart data={perFrame}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="frame" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" dot={false} />
                <Line type="monotone" dataKey="sharpness" stroke="hsl(var(--accent))" dot={false} />
                <Line type="monotone" dataKey="brightness" stroke="#8ba3c7" dot={false} />
              </LineChart>
            </ChartCard>

            <ChartCard title="Feature matches per keyframe pair">
              <BarChart data={matchData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="pair" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="raw" fill="#8ba3c7" />
                <Bar dataKey="inliers" fill="hsl(var(--primary))" />
              </BarChart>
            </ChartCard>

            <ChartCard title="Camera trajectory components">
              <LineChart data={trajectory}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="keyframe" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="x" stroke="hsl(var(--primary))" dot={false} />
                <Line type="monotone" dataKey="y" stroke="hsl(var(--accent))" dot={false} />
                <Line type="monotone" dataKey="z" stroke="#8ba3c7" dot={false} />
              </LineChart>
            </ChartCard>
          </div>

          {project.depthPreviews.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Depth estimates</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {project.depthPreviews.map((d) => (
                  <div key={d.frameIndex} className="space-y-2">
                    <img
                      src={d.frame}
                      alt={`Keyframe ${d.frameIndex} from the reconstructed drone video`}
                      className="w-full rounded-md border border-border"
                      loading="lazy"
                    />
                    {d.depth ? (
                      <img
                        src={d.depth}
                        alt={`Estimated depth map for keyframe ${d.frameIndex}`}
                        className="w-full rounded-md border border-border"
                        loading="lazy"
                      />
                    ) : null}
                    <p className="font-mono text-[11px] text-muted-foreground">frame {d.frameIndex}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </AppShell>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 font-display text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
