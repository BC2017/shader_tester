import { useCallback, useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { ShaderPass } from "../lib/shaderTypes";

interface EditorPaneProps {
  pass: ShaderPass;
  showMinimap: boolean;
  onChange: (code: string) => void;
}

export function EditorPane({ pass, showMinimap, onChange }: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const layoutEditor = useCallback(() => {
    const container = containerRef.current;
    const editor = editorRef.current;
    if (!container || !editor) return;
    const width = Math.floor(container.clientWidth);
    const height = Math.floor(container.clientHeight);
    if (width <= 0 || height <= 0) return;
    editor.layout({ width, height });
  }, []);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    window.requestAnimationFrame(layoutEditor);
  }, [layoutEditor]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const scheduleLayout = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(layoutEditor);
    };
    const observer = new ResizeObserver(scheduleLayout);
    observer.observe(container);
    window.addEventListener("resize", scheduleLayout);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", scheduleLayout);
    };
  }, [layoutEditor]);

  useEffect(() => {
    window.requestAnimationFrame(layoutEditor);
  }, [layoutEditor, pass.id]);

  return (
    <section className="editor-pane" aria-label="Shader editor">
      <div className="pane-header">
        <div>
          <span className="eyebrow">GLSL</span>
          <h1>{pass.name}</h1>
        </div>
        <span className={`pass-pill ${pass.type}`}>{pass.type}</span>
      </div>
      <div className="editor-body" ref={containerRef}>
        <Editor
          height="100%"
          language="cpp"
          theme="vs-dark"
          value={pass.code}
          options={{
            fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
            fontSize: 13,
            minimap: { enabled: showMinimap },
            scrollBeyondLastLine: false,
            automaticLayout: false,
            tabSize: 4,
            wordWrap: "on"
          }}
          onMount={handleMount}
          onChange={(value) => onChange(value ?? "")}
        />
      </div>
    </section>
  );
}
