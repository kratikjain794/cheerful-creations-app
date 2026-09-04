import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, Cpu, FolderOpen, Play } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { detectCapabilities, type Capabilities } from "@/lib/capabilities";
import { listProjects } from "@/lib/store";
import { STEP_DEFS } from "@/lib/cv/pipeline";
import type { ProjectMeta } from "@/lib/cv/types";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — GeoVision 3D Reconstruction Console" },
      {
        name: "description",
        content:
          "Runtime capability status, recent reconstructions and the 11-step GeoVision 3D photogrammetry pipeline at a glance.",
      },
      { property: "og:title", content: "Dashboard — GeoVision 3D Reconstruction Console" },
      {
        property: "og:description",
        content: "Monitor browser CV capabilities and open recent drone-video reconstructions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);

  useEffect(() => {
    setCaps(detectCapabilities());
    listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  const ready = projects.filter((p) => p.status === "ready");
  const points = ready.reduce((a, p) => a + (p.stats?.pointCount ?? 0), 0);

  return (
    <AppShell
      title="Reconstruction dashboard"
      subtitle="Everything runs locally in your browser — frame extraction, feature matching, pose recovery, depth and point-cloud generation."
      actions={
        <>
          <Button asChild>
            <Link to="/new">
              <Play className="mr-2 h-4 w-4" /> New reconstruction
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/projects">
              <FolderOpen className="mr-2 h-4 w-4" /> Projects
            </Link>
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Projects" value={String(projects.length)} />
        <Stat label="Completed" value={String(ready.length)} />
        <Stat label="Total points" value={points.toLocaleString()} />
        <Stat label="Logical cores" value={caps ? String(caps.cores) : "—"} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="h-4 w-4 text-accent" /> System capabilities
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(caps?.list ?? []).map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-4 border-b border-border pb-2 last:border-0">
                <div>
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                </div>
                <Badge variant={c.available ? "default" : "secondary"}>
                  {c.available ? "available" : "unavailable"}
                </Badge>
              </div>
            ))}
            {!caps ? <p className="text-sm text-muted-foreground">Detecting…</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" /> Pipeline stages
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {STEP_DEFS.map((s, i) => (
                <li key={s.id} className="flex gap-3 text-sm">
                  <span className="font-mono text-xs text-primary">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <p className="font-medium">{s.label}</p>
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Recent reconstructions</CardTitle>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No reconstructions yet. Upload a drone video to get started.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {projects.slice(0, 6).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {new Date(p.createdAt).toLocaleString()} · {p.status}
                      {p.stats ? ` · ${p.stats.pointCount.toLocaleString()} pts` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {p.status === "ready" ? (
                      <Button asChild size="sm" variant="secondary">
                        <Link to="/viewer/$id" params={{ id: p.id }}>
                          Open viewer
                        </Link>
                      </Button>
                    ) : null}
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/projects">Details</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 font-display text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
