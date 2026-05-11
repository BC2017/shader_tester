import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Activity } from "lucide-react";
import type { RuntimeStats, ShaderProject } from "../lib/shaderTypes";
import { ShadertoyRuntime } from "../lib/shadertoyRuntime";

interface PreviewPaneProps {
  project: ShaderProject;
  saveStatus: string;
}

const emptyStats: RuntimeStats = {
  frame: 0,
  time: 0,
  fps: 0,
  resolution: [0, 0]
};

export function PreviewPane({ project, saveStatus }: PreviewPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<ShadertoyRuntime | null>(null);
  const [status, setStatus] = useState({ ok: true, message: "Waiting", stats: emptyStats });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let runtime: ShadertoyRuntime;
    try {
      runtime = new ShadertoyRuntime(canvas);
    } catch (error) {
      setStatus({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        stats: emptyStats
      });
      return;
    }

    runtimeRef.current = runtime;
    runtime.onStatus(setStatus);
    runtime.load(project);
    const firstFrame = window.requestAnimationFrame(() => {
      runtime.resize();
      runtime.start();
    });

    const resize = () => runtime.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    window.addEventListener("resize", resize);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      runtime.stop();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    runtimeRef.current?.load(project);
  }, [project]);

  return (
    <section className="preview-pane" aria-label="Shader preview">
      <div className="pane-header">
        <div>
          <span className="eyebrow">Renderer</span>
          <h1>Live Preview</h1>
        </div>
        <div className={status.ok ? "render-status ok" : "render-status error"}>
          {status.ok ? <Activity size={15} /> : <AlertTriangle size={15} />}
          <span>{status.message}</span>
        </div>
      </div>
      <div className="canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
      <footer className="stats-row">
        <span>{Math.round(status.stats.fps)} fps</span>
        <span>Frame {status.stats.frame}</span>
        <span>{status.stats.resolution[0]} x {status.stats.resolution[1]}</span>
        <span className="save-state">{saveStatus}</span>
      </footer>
    </section>
  );
}
