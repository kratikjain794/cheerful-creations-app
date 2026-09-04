import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { BarChart3, Box, Download, FolderOpen, Trash2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteProject, getCloud, listProjects } from "@/lib/store";
import { downloadPcd, downloadPly, downloadReport, downloadTrajectory } from "@/lib/reports";
import type { ProjectMeta } from "@/lib/cv/types";

export const Route = createFileRoute("/projects")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Projects — Saved Reconstructions | GeoVision 3D" },
      {
        name: "description",
        content:
          "Browse, reopen, export and delete every drone-video reconstruction stored locally in your browser by GeoVision 3D.",
      },
      { property: "og:title", content: "Projects — Saved Reconstructions" },
      {
        property: "og:description",
        content: "Open point clouds, download PLY/PCD/JSON/CSV artifacts or remove old reconstructions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const refresh = useCallback(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  async function remove(id: string) {
    await deleteProject(id);
    refresh();
  }

  async function exportCloud(project: ProjectMeta, kind: "ply" | "pcd") {
    const cloud = await getCloud(project.id);
    if (!cloud) return;
    if (kind === "ply") downloadPly(project, cloud);
    else downloadPcd(project, cloud);
  }

  return (
    <AppShell
      title="Projects"
      subtitle="Reconstructions are stored in this browser (IndexedDB) together with their point clouds and metrics."
      actions={
        <Button asChild>
          <Link to="/new">New reconstruction</Link>
        </Button>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading projects…</p>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <FolderOpen className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No reconstructions yet. Upload a drone video to create your first one.
            </p>
            <Button asChild>
              <Link to="/new">Start a reconstruction</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Card key={p.id} className="flex flex-col">
              <CardHeader className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  <Badge
                    variant={
                      p.status === "ready" ? "default" : p.status === "failed" ? "destructive" : "secondary"
                    }
                  >
                    {p.status}
                  </Badge>
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {p.description || p.video?.name || "No description"}
                </p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <dl className="grid grid-cols-2 gap-2 font-mono text-[11px] text-muted-foreground">
                  <Row label="Created" value={new Date(p.createdAt).toLocaleString()} />
                  <Row
                    label="Video"
                    value={p.video ? `${p.video.width}×${p.video.height} · ${p.video.duration.toFixed(1)}s` : "—"}
                  />
                  <Row label="Keyframes" value={p.stats ? String(p.stats.keyframes) : "—"} />
                  <Row label="Points" value={p.stats ? p.stats.pointCount.toLocaleString() : "—"} />
                  <Row label="Frame" value={p.stats?.coordinateMode ?? "—"} />
                  <Row
                    label="Runtime"
                    value={p.stats ? `${(p.stats.processingMs / 1000).toFixed(1)}s` : "—"}
                  />
                </dl>

                {p.error ? <p className="text-xs text-destructive">{p.error}</p> : null}

                <div className="flex flex-wrap gap-2">
                  {p.status === "ready" ? (
                    <>
                      <Button size="sm" onClick={() => navigate({ to: "/viewer/$id", params: { id: p.id } })}>
                        <Box className="mr-2 h-4 w-4" /> Viewer
                      </Button>
                      <Button size="sm" variant="secondary" asChild>
                        <Link to="/analytics" search={{ project: p.id }}>
                          <BarChart3 className="mr-2 h-4 w-4" /> Analytics
                        </Link>
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="secondary">
                            <Download className="mr-2 h-4 w-4" /> Export
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => void exportCloud(p, "ply")}>
                            Point cloud (.ply)
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void exportCloud(p, "pcd")}>
                            Point cloud (.pcd)
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => downloadReport(p)}>
                            Report (.json)
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => downloadTrajectory(p)}>
                            Trajectory (.csv)
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  ) : (
                    <Button size="sm" variant="secondary" asChild>
                      <Link to="/processing/$id" params={{ id: p.id }}>
                        Open status
                      </Link>
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => void remove(p.id)}>
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="uppercase tracking-wider text-[10px]">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
