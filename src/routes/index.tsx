import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  Boxes,
  Download,
  Gauge,
  MapPin,
  Rocket,
  ScanLine,
  Video,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { STEP_DEFS } from "@/lib/cv/pipeline";
import heroImage from "@/assets/recon-hero.jpg";

const TITLE = "GeoVision 3D — Drone Video to Georeferenced 3D Reconstruction";
const DESCRIPTION =
  "GeoVision 3D is an AI-powered single-pass system that turns one drone video into a georeferenced 3D point cloud entirely in your browser — real frame extraction, features, poses, depth and export.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const CAPABILITIES = [
  {
    icon: Video,
    title: "Real video ingest",
    body: "MP4, MOV and WebM drone passes are validated, probed and decoded frame-by-frame in the browser — no upload to a server.",
  },
  {
    icon: ScanLine,
    title: "Measured frame quality",
    body: "Laplacian sharpness, exposure, contrast and inter-frame motion drive adaptive keyframe selection.",
  },
  {
    icon: Boxes,
    title: "Structure from motion",
    body: "FAST corners with BRIEF descriptors, ratio-test matching, RANSAC filtering and essential-matrix pose recovery.",
  },
  {
    icon: MapPin,
    title: "Georeferencing",
    body: "GPS/IMU tracks in CSV, JSON or GPX are converted to ENU and fused with the visual trajectory via Umeyama alignment.",
  },
  {
    icon: Activity,
    title: "Full analytics",
    body: "Every chart on the analytics page comes from metrics recorded during the run — never simulated progress.",
  },
  {
    icon: Download,
    title: "Open exports",
    body: "Download the cloud as PLY or PCD, the run report as JSON and the camera trajectory as CSV.",
  },
] as const;

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-panel/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-5 py-3">
          <Link to="/" className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-primary" />
            <span className="font-display text-base font-semibold tracking-tight">GeoVision 3D</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-1 font-mono text-xs uppercase tracking-wider">
            <Link
              to="/dashboard"
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Dashboard
            </Link>
            <Link
              to="/new"
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              New reconstruction
            </Link>
            <Link
              to="/projects"
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Projects
            </Link>
            <Link
              to="/viewer"
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              3D viewer
            </Link>
            <Link
              to="/analytics"
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Analytics
            </Link>
            <Link
              to="/settings"
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Settings
            </Link>
          </nav>
          <div className="ml-auto">
            <Button asChild size="sm">
              <Link to="/new">
                <Rocket className="mr-2 h-4 w-4" /> Start reconstruction
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border">
          <img
            src={heroImage}
            alt="Point cloud reconstruction of a site captured by a drone"
            className="absolute inset-0 h-full w-full object-cover opacity-25"
            loading="eager"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/85 to-background" />
          <div className="relative mx-auto max-w-7xl px-5 py-24">
            <Badge variant="secondary" className="font-mono text-xs uppercase tracking-widest">
              Single-pass photogrammetry · runs in your browser
            </Badge>
            <h1 className="mt-6 font-display text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">
              GEOVISION 3D
            </h1>
            <p className="mt-4 max-w-3xl text-lg text-muted-foreground">
              AI-Powered Single-Pass Drone Video to Georeferenced 3D Reconstruction System
            </p>
            <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
              One continuous drone video in. A measurable, georeferenced point cloud out — computed
              locally with a real 11-step computer-vision pipeline written in TypeScript.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/new">
                  <Rocket className="mr-2 h-4 w-4" /> START RECONSTRUCTION
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link to="/dashboard">
                  <Gauge className="mr-2 h-4 w-4" /> Open dashboard
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/viewer">Browse 3D viewer</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Capabilities */}
        <section className="mx-auto max-w-7xl px-5 py-20">
          <h2 className="font-display text-3xl font-semibold tracking-tight">
            What GeoVision 3D actually does
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            No mock data and no fabricated progress — each stage reports the numbers it measured.
          </p>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <Card key={c.title}>
                <CardContent className="space-y-3 pt-6">
                  <c.icon className="h-5 w-5 text-accent" />
                  <h3 className="font-display text-lg font-semibold tracking-tight">{c.title}</h3>
                  <p className="text-sm text-muted-foreground">{c.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Pipeline */}
        <section className="border-y border-border bg-panel/40">
          <div className="mx-auto max-w-7xl px-5 py-20">
            <h2 className="font-display text-3xl font-semibold tracking-tight">
              The 11-step reconstruction pipeline
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Live progress, timings and logs for every step are streamed on the processing page.
            </p>
            <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {STEP_DEFS.map((s, i) => (
                <li
                  key={s.id}
                  className="rounded-lg border border-border bg-card p-5"
                >
                  <span className="font-mono text-xs text-primary">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-2 font-display text-base font-semibold tracking-tight">
                    {s.label}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Modes */}
        <section className="mx-auto max-w-7xl px-5 py-20">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardContent className="space-y-3 pt-6">
                <Badge variant="secondary" className="font-mono text-xs">DEMO MODE</Badge>
                <h3 className="font-display text-xl font-semibold tracking-tight">
                  Works on any machine
                </h3>
                <p className="text-sm text-muted-foreground">
                  Conservative frame sampling, reduced processing width and a capped keyframe count so
                  a full reconstruction completes quickly on a laptop with no GPU features.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-3 pt-6">
                <Badge className="font-mono text-xs">ADVANCED MODE</Badge>
                <h3 className="font-display text-xl font-semibold tracking-tight">
                  Uses what your browser exposes
                </h3>
                <p className="text-sm text-muted-foreground">
                  Enabled when WebGPU or WASM SIMD is detected: denser sampling, more keyframes,
                  finer depth stride and an optional external depth-model endpoint. Capability
                  detection lives on the Settings page.
                </p>
              </CardContent>
            </Card>
          </div>
          <div className="mt-10">
            <Button asChild size="lg">
              <Link to="/new">
                <Rocket className="mr-2 h-4 w-4" /> START RECONSTRUCTION
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-panel/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-8">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-primary" />
            <span className="font-display text-sm font-semibold tracking-tight">GeoVision 3D</span>
            <span className="text-xs text-muted-foreground">
              AI-Powered Single-Pass Drone Video to Georeferenced 3D Reconstruction System
            </span>
          </div>
          <nav className="flex flex-wrap gap-4 font-mono text-xs uppercase tracking-wider text-muted-foreground">
            <Link to="/dashboard" className="hover:text-foreground">Dashboard</Link>
            <Link to="/new" className="hover:text-foreground">New reconstruction</Link>
            <Link to="/projects" className="hover:text-foreground">Projects</Link>
            <Link to="/viewer" className="hover:text-foreground">3D viewer</Link>
            <Link to="/analytics" className="hover:text-foreground">Analytics</Link>
            <Link to="/settings" className="hover:text-foreground">Settings</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
