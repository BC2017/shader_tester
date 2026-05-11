import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Activity } from "lucide-react";
import type { RuntimeStats, ShaderProject } from "../lib/shaderTypes";
import { ShadertoyRuntime } from "../lib/shadertoyRuntime";
import { loadCachedAssetDataUrl } from "../lib/tauriApi";

interface PreviewPaneProps {
  project: ShaderProject;
  isPaused: boolean;
  saveStatus: string;
}

const emptyStats: RuntimeStats = {
  frame: 0,
  time: 0,
  fps: 0,
  resolution: [0, 0]
};

const previewAspectRatio = 16 / 9;

export function PreviewPane({ project, isPaused, saveStatus }: PreviewPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const canvasFrameRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<ShadertoyRuntime | null>(null);
  const [status, setStatus] = useState({ ok: true, message: "Waiting", stats: emptyStats });
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const hasFrameSize = frameSize.width > 0 && frameSize.height > 0;
  const frameStyle = useMemo(() => (
    hasFrameSize
      ? {
        width: `${frameSize.width}px`,
        height: `${frameSize.height}px`
      }
      : {
        width: "0px",
        height: "0px"
      }
  ), [frameSize.height, frameSize.width, hasFrameSize]);

  useLayoutEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;

    let resizeFrame = 0;
    const measureFrame = () => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const width = Math.min(rect.width, rect.height * previewAspectRatio);
      const height = width / previewAspectRatio;
      setFrameSize((current) => (
        Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
          ? current
          : { width, height }
      ));
    };
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(measureFrame);
    };

    measureFrame();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(wrap);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      window.cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let runtime: ShadertoyRuntime;
    try {
      runtime = new ShadertoyRuntime(canvas, {
        loadAsset: loadCachedAssetDataUrl
      });
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

    let resizeFrame = 0;
    const resize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => runtime.resize());
    };
    const observer = new ResizeObserver(resize);
    if (canvasFrameRef.current) observer.observe(canvasFrameRef.current);
    window.addEventListener("resize", resize);
    return () => {
      window.cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      runtime.stop();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    runtimeRef.current?.load(project);
  }, [project]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (!hasFrameSize) {
      runtime.pause();
      return;
    }
    runtime.resize();
    if (isPaused) runtime.pause();
    else runtime.start();
  }, [frameSize.height, frameSize.width, hasFrameSize, isPaused]);

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
      <div className="canvas-wrap" ref={canvasWrapRef}>
        <div
          className="canvas-frame"
          ref={canvasFrameRef}
          style={frameStyle}
        >
          <canvas ref={canvasRef} />
        </div>
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
