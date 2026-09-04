// Interactive point-cloud viewer. Renders the real reconstruction produced by
// the pipeline — no synthetic geometry is ever substituted.

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Crosshair, Expand, Grid3x3, Move3d, Ruler } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { PointCloud, Pose } from "@/lib/cv/types";

export type ColorMode = "rgb" | "height" | "intensity";

function turbo(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  const r = Math.min(1, Math.max(0, 1.5 - Math.abs(4 * x - 3)));
  const g = Math.min(1, Math.max(0, 1.5 - Math.abs(4 * x - 2)));
  const b = Math.min(1, Math.max(0, 1.5 - Math.abs(4 * x - 1)));
  return [r, g, b];
}

function buildGeometry(cloud: PointCloud, mode: ColorMode, center: THREE.Vector3) {
  const geom = new THREE.BufferGeometry();
  const n = cloud.count;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = cloud.positions[i * 3] - center.x;
    pos[i * 3 + 1] = cloud.positions[i * 3 + 1] - center.y;
    pos[i * 3 + 2] = cloud.positions[i * 3 + 2] - center.z;
  }
  const colors = new Float32Array(n * 3);

  if (mode === "rgb") {
    colors.set(cloud.colors.subarray(0, n * 3));
  } else if (mode === "height") {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = pos[i * 3 + 1];
      if (y < min) min = y;
      if (y > max) max = y;
    }
    const range = max - min || 1;
    for (let i = 0; i < n; i++) {
      const [r, g, b] = turbo((pos[i * 3 + 1] - min) / range);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const lum =
        0.299 * cloud.colors[i * 3] + 0.587 * cloud.colors[i * 3 + 1] + 0.114 * cloud.colors[i * 3 + 2];
      const [r, g, b] = turbo(lum);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
  }

  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geom.computeBoundingSphere();
  return geom;
}

function Cloud({ geometry, size }: { geometry: THREE.BufferGeometry; size: number }) {
  return (
    <points geometry={geometry}>
      <pointsMaterial vertexColors size={size} sizeAttenuation />
    </points>
  );
}

function Trajectory({ poses, center }: { poses: Pose[]; center: THREE.Vector3 }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pts = new Float32Array(poses.length * 3);
    poses.forEach((p, i) => {
      pts[i * 3] = p.position[0] - center.x;
      pts[i * 3 + 1] = p.position[1] - center.y;
      pts[i * 3 + 2] = p.position[2] - center.z;
    });
    g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    return g;
  }, [poses, center]);

  if (poses.length < 2) return null;
  return (
    <group>
      <primitive object={new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#ff7a45" }))} />
      {poses.map((p) => (
        <mesh
          key={p.frameIndex}
          position={[p.position[0] - center.x, p.position[1] - center.y, p.position[2] - center.z]}
        >
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshBasicMaterial color="#ffb08a" />
        </mesh>
      ))}
    </group>
  );
}

export function PointCloudViewer({ cloud, poses }: { cloud: PointCloud; poses: Pose[] }) {
  const [size, setSize] = useState(0.06);
  const [mode, setMode] = useState<ColorMode>("rgb");
  const [grid, setGrid] = useState(true);
  const [axes, setAxes] = useState(true);
  const [showTrajectory, setShowTrajectory] = useState(true);
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls> | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const { center, radius } = useMemo(() => {
    if (!cloud.count) return { center: new THREE.Vector3(), radius: 10 };
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let i = 0; i < cloud.count; i++) {
      sx += cloud.positions[i * 3];
      sy += cloud.positions[i * 3 + 1];
      sz += cloud.positions[i * 3 + 2];
    }
    const c = new THREE.Vector3(sx / cloud.count, sy / cloud.count, sz / cloud.count);
    let r = 0;
    for (let i = 0; i < cloud.count; i++) {
      const d = Math.hypot(
        cloud.positions[i * 3] - c.x,
        cloud.positions[i * 3 + 1] - c.y,
        cloud.positions[i * 3 + 2] - c.z,
      );
      if (d > r) r = d;
    }
    return { center: c, radius: Math.max(1, r) };
  }, [cloud]);

  const geometry = useMemo(() => buildGeometry(cloud, mode, center), [cloud, mode, center]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const camPos: [number, number, number] = [radius * 1.2, radius * 0.9, radius * 1.6];

  function resetCamera() {
    const c = controlsRef.current as unknown as
      | { object: THREE.Camera; target: THREE.Vector3; update: () => void }
      | null;
    if (!c) return;
    c.object.position.set(camPos[0], camPos[1], camPos[2]);
    c.target.set(0, 0, 0);
    c.update();
  }

  function toggleFullscreen() {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }

  return (
    <div ref={wrapRef} className="grid gap-4 bg-background lg:grid-cols-[1fr_16rem]">
      <div className="relative h-[32rem] overflow-hidden rounded-lg border border-border bg-secondary/30 lg:h-[38rem]">
        <Canvas camera={{ position: camPos, fov: 55, near: 0.01, far: radius * 40 }}>
          <color attach="background" args={["#0b0f14"]} />
          <ambientLight intensity={0.8} />
          <Cloud geometry={geometry} size={size} />
          {showTrajectory ? <Trajectory poses={poses} center={center} /> : null}
          {grid ? <gridHelper args={[radius * 4, 24, "#2a3441", "#1b232c"]} /> : null}
          {axes ? <axesHelper args={[radius * 0.6]} /> : null}
          <OrbitControls ref={controlsRef} enablePan enableZoom enableRotate makeDefault />
        </Canvas>
        <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-background/80 px-2 py-1 font-mono text-[11px] text-muted-foreground">
          {cloud.count.toLocaleString()} points · extent {(radius * 2).toFixed(1)} u
        </div>
      </div>

      <div className="space-y-5 rounded-lg border border-border p-4">
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider">Color mode</Label>
          <div className="grid grid-cols-3 gap-1">
            {(["rgb", "height", "intensity"] as ColorMode[]).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={mode === m ? "default" : "secondary"}
                onClick={() => setMode(m)}
              >
                {m === "rgb" ? "RGB" : m === "height" ? "Height" : "Intens."}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="flex items-center justify-between font-mono text-xs uppercase tracking-wider">
            <span>Point size</span>
            <span>{size.toFixed(3)}</span>
          </Label>
          <Slider
            value={[size]}
            min={0.01}
            max={0.4}
            step={0.005}
            onValueChange={(v) => setSize(v[0])}
          />
        </div>

        <Toggle icon={<Grid3x3 className="h-4 w-4" />} label="Grid" checked={grid} onChange={setGrid} />
        <Toggle icon={<Ruler className="h-4 w-4" />} label="Axes" checked={axes} onChange={setAxes} />
        <Toggle
          icon={<Move3d className="h-4 w-4" />}
          label="Trajectory"
          checked={showTrajectory}
          onChange={setShowTrajectory}
        />

        <div className="space-y-2 pt-2">
          <Button className="w-full" variant="secondary" onClick={resetCamera}>
            <Crosshair className="mr-2 h-4 w-4" /> Reset camera
          </Button>
          <Button className="w-full" variant="secondary" onClick={toggleFullscreen}>
            <Expand className="mr-2 h-4 w-4" /> Fullscreen
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Left-drag orbits, right-drag pans, scroll zooms.
        </p>
      </div>
    </div>
  );
}

function Toggle({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-sm">
        {icon}
        {label}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
