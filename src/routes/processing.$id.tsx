import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Box, CheckCircle2, CircleDashed, Loader2, MinusCircle } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  DEFAULT_PARAMS,
  initialSteps,
  runPipeline,
  type PipelineParams,
  type PipelineStep,
} from "@/lib/cv/pipeline";
import { deleteJob, getJob, getProject, saveCloud, saveProject } from "@/lib/store";
import type { ProjectMeta } from "@/lib/cv/types";

export const Route = createFileRoute("/processing/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Processing Reconstruction — GeoVision 3D" },
      {
        name: "description",
        content:
          "Live progress of the 11-step GeoVision 3D pipeline: frame extraction, quality analysis, feature matching, pose recovery, depth and point-cloud generation.",
      },
      { property: "og:title", content: "Processing Reconstruction — GeoVision 3D" },
      {
        property: "og:description",
        content: "Watch every reconstruction step compute in real time with streaming logs and timings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProcessingPage,
});

function ProcessingPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const started = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  const [steps, setSteps] = useState<PipelineStep[]>(() => initialSteps());
  const [logs, setLogs] = useState<string[]>([]);
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [state, setState] = useState<"loading" | "running" | "done" | "failed">("loading");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (state !== "running") return;
    const t0 = performance.now();
    const timer = window.setInterval(() => setElapsed((performance.now() - t0) / 1000), 200);
    return () => window.clearInterval(timer);
  }, [state]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      const existing = await getProject(id);
      if (!existing) {
        setState("failed");
        setError("This project no longer exists in local storage.");
        return;
      }
      setProject(existing);

      if (existing.status === "ready") {
        setState("done");
        setSteps((s) => s.map((x) => ({ ...x, status: "done", progress: 1 })));
        setLogs(existing.logs);
        return;
      }

      const job = await getJob(id);
      if (!job) {
        setState("failed");
        setError(
          "The uploaded video for this project is no longer available. Videos are kept only for the run that follows the upload — start a new reconstruction.",
        );
        return;
      }

      setState("running");
      try {
        const { project: result, cloud } = await runPipeline(
          {
            project: existing,
            videoFile: job.video,
            metadataFile: job.metadata,
            params: { ...DEFAULT_PARAMS, ...(job.params as Partial<PipelineParams>) },
          },
          {
            onSteps: (s) => setSteps(s),
            onLog: (line) => setLogs((prev) => [...prev, line]),
          },
        );
        await saveProject(result);
        if (result.status === "ready") {
          await saveCloud(id, cloud);
          await deleteJob(id);
          setProject(result);
          setState("done");
        } else {
          setProject(result);
          setError(result.error ?? "The reconstruction failed.");
          setState("failed");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected pipeline failure.";
        setError(message);
        setState("failed");
        const failed: ProjectMeta = { ...existing, status: "failed", error: message };
        await saveProject(failed);
        setProject(failed);
      }
    })();
  }, [id]);

  const doneCount = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const current = steps.find((s) => s.status === "running");
  const overall =
    steps.reduce((a, s) => a + (s.status === "done" || s.status === "skipped" ? 1 : s.progress), 0) /
    steps.length;

  return (
    <AppShell
      title={project ? project.name : "Processing"}
      subtitle={
        state === "running"
          ? `Running ${current?.label ?? "pipeline"} — everything is computed on this machine.`
          : state === "done"
            ? "Reconstruction complete. Open the point cloud or inspect the analytics."
            : "Pipeline status"
      }
      actions={
        state === "done" ? (
          <>
            <Button onClick={() => navigate({ to: "/viewer/$id", params: { id } })}>
              <Box className="mr-2 h-4 w-4" /> Open 3D viewer
            </Button>
            <Button variant="secondary" asChild>
              <Link to="/analytics" search={{ project: id }}>
                Analytics
              </Link>
            </Button>
          </>
        ) : (
          <Button variant="secondary" asChild>
            <Link to="/projects">All projects</Link>
          </Button>
        )
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Pipeline</CardTitle>
            <Badge variant={state === "failed" ? "destructive" : state === "done" ? "default" : "secondary"}>
              {state === "running"
                ? `${doneCount}/${steps.length} steps · ${elapsed.toFixed(1)}s`
                : state.toUpperCase()}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-1 flex justify-between font-mono text-xs text-muted-foreground">
                <span>Overall</span>
                <span>{Math.round(overall * 100)}%</span>
              </div>
              <Progress value={overall * 100} />
            </div>

            <ol className="space-y-3">
              {steps.map((s) => (
                <li key={s.id} className="flex gap-3">
                  <StepIcon status={s.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{s.label}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {s.ms ? `${s.ms.toFixed(0)} ms` : s.status === "running" ? `${Math.round(s.progress * 100)}%` : ""}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{s.detail || s.description}</p>
                    {s.status === "running" ? <Progress className="mt-2 h-1" value={s.progress * 100} /> : null}
                  </div>
                </li>
              ))}
            </ol>

            {error ? (
              <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-base">Live log</CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            <div
              ref={logRef}
              className="h-[28rem] overflow-auto rounded-md border border-border bg-secondary/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground"
            >
              {logs.length ? (
                logs.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-words">
                    {line}
                  </div>
                ))
              ) : (
                <span>Waiting for the pipeline to start…</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function StepIcon({ status }: { status: PipelineStep["status"] }) {
  const cls = "mt-0.5 h-4 w-4 shrink-0";
  if (status === "running") return <Loader2 className={`${cls} animate-spin text-accent`} />;
  if (status === "done") return <CheckCircle2 className={`${cls} text-primary`} />;
  if (status === "skipped") return <MinusCircle className={`${cls} text-muted-foreground`} />;
  if (status === "failed") return <AlertTriangle className={`${cls} text-destructive`} />;
  return <CircleDashed className={`${cls} text-muted-foreground`} />;
}
