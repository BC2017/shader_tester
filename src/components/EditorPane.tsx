import Editor from "@monaco-editor/react";
import type { ShaderPass } from "../lib/shaderTypes";

interface EditorPaneProps {
  pass: ShaderPass;
  onChange: (code: string) => void;
}

export function EditorPane({ pass, onChange }: EditorPaneProps) {
  return (
    <section className="editor-pane" aria-label="Shader editor">
      <div className="pane-header">
        <div>
          <span className="eyebrow">GLSL</span>
          <h1>{pass.name}</h1>
        </div>
        <span className={`pass-pill ${pass.type}`}>{pass.type}</span>
      </div>
      <Editor
        height="100%"
        language="cpp"
        theme="vs-dark"
        value={pass.code}
        options={{
          fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
          fontSize: 13,
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 4,
          wordWrap: "on"
        }}
        onChange={(value) => onChange(value ?? "")}
      />
    </section>
  );
}
