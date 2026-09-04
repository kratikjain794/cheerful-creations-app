import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Boxes } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listProjects } from "@/lib/store";
import type { ProjectMeta } from "@/lib/cv/types";

export const Route = createFileRoute("/viewer/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "3D Viewer — Pick a Reconstruction | GeoVision 3D" },
      {
        name: "description",
        content:
          "Open any completed GeoVision 3D reconstruction in the interactive WebGL point-cloud viewer.",
      },
      { property: "og:title", content: "3D Viewer — Pick a Reconstruction" },
      {
        property: "og:description",
        content: "Choose a reconstructed point cloud to orbit, inspect and export.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ViewerIndex,
});

function ViewerIndex() {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);

  useEffect(() => {
    listProjects()
      .then((all) => setProjects(all.filter((p) => (p.stats?.pointCount ?? 0) > 0)))
      .catch(() => setProjects([]));
  }, []);

  return (
    <AppShell
      title="3D viewer"
      subtitle="Every completed reconstruction stored on this device."
      actions={
        <Button asChild>
          <Link to="/new">New reconstruction</Link>
        </Button>
      }
    >
      {projects === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              No point clouds yet. Run a reconstruction to generate one.
            </p>
            <Button asChild>
              <Link to="/new">Start reconstruction</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Boxes className="h-4 w-4 text-primary" /> {p.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2 font-mono text-xs">
                  <Badge variant="secondary">
                    {(p.stats?.pointCount ?? 0).toLocaleString()} pts
                  </Badge>
                  <Badge variant="secondary">{p.stats?.keyframes ?? 0} keyframes</Badge>
                  <Badge variant="secondary">{p.stats?.coordinateMode ?? "LOCAL"}</Badge>
                </div>
                <Button asChild variant="secondary" className="w-full">
                  <Link to="/viewer/$id" params={{ id: p.id }}>
                    Open viewer
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
