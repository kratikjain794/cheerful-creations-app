import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BarChart3, Download } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PointCloudViewer } from "@/components/PointCloudViewer";
import { getCloud, getProject } from "@/lib/store";
import { downloadPcd, downloadPly, downloadReport, downloadTrajectory } from "@/lib/reports";
import type { PointCloud, ProjectMeta } from "@/lib/cv/types";

export const Route = createFileRoute("/viewer/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "3D Point Cloud Viewer — GeoVision 3D" },
      {
        name: "description",
        content:
          "Orbit, zoom and inspect the reconstructed point cloud with RGB, height and intensity shading plus the recovered camera trajectory.",
      },
      { property: "og:title", content: "3D Point Cloud Viewer — GeoVision 3D" },
      {
        property: "og:description",
        content: "Interactive WebGL viewer for point clouds reconstructed from drone video in the browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ViewerPage,
});

function ViewerPage() {
  const { id } = Route.useParams();
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [cloud, setCloud] = useState<PointCloud | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    (async () => {
      const [p, c] = await Promise.all([getProject(id), getCloud(id)]);
      setProject(p);
      setCloud(c);
      setState(p && c && c.count > 0 ? "ready" : "missing");
    })();
  }, [id]);

  const stats = project?.stats;

  return (
    <AppShell
      title={project ? `${project.name} — 3D viewer` : "3D viewer"}
      subtitle={
        stats
          ? `${stats.pointCount.toLocaleString()} points from ${stats.keyframes} keyframes · ${stats.coordinateMode} frame`
          : "Reconstructed point cloud"
      }
      actions={
        project && cloud ? (
          <>
            <Button variant="secondary" asChild>
              <Link to="/analytics" search={{ project: id }}>
                <BarChart3 className="mr-2 h-4 w-4" /> Analytics
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <Download className="mr-2 h-4 w-4" /> Download
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => downloadPly(project, cloud)}>
                  Point cloud (.ply)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => downloadPcd(project, cloud)}>
                  Point cloud (.pcd)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => downloadReport(project)}>Report (.json)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => downloadTrajectory(project)}>
                  Trajectory (.csv)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null
      }
    >
      {state === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading point cloud…</p>
      ) : state === "missing" || !cloud || !project ? (
        <Card>
          <CardContent className="space-y-3 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              No point cloud is stored for this project. Run the reconstruction first.
            </p>
            <Button asChild>
              <Link to="/projects">Back to projects</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{stats?.mode} mode</Badge>
            <Badge variant="secondary">{stats?.coordinateMode}</Badge>
            <Badge variant="secondary">{project.poses.length} camera poses</Badge>
            <Badge variant="secondary">
              trajectory {stats ? stats.trajectoryLength.toFixed(2) : "0"} u
            </Badge>
          </div>
          <PointCloudViewer cloud={cloud} poses={project.poses} />
        </div>
      )}
    </AppShell>
  );
}
