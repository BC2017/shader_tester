import { useEffect, useMemo, useState } from "react";
import { Code2, Download, FolderOpen, KeyRound, Play, Save, Settings, Sparkles } from "lucide-react";
import { defaultProject } from "./lib/defaultProject";
import type { ShaderPass, ShaderProject } from "./lib/shaderTypes";
import { shadertoyJsonToProject } from "./lib/shadertoyImport";
import {
  importShader,
  listProjects,
  loadLastProject,
  loadProject,
  loadSettings,
  saveApiKey,
  saveProject,
  type ProjectSummary
} from "./lib/tauriApi";
import { EditorPane } from "./components/EditorPane";
import { PreviewPane } from "./components/PreviewPane";
import { SetupPanel } from "./components/SetupPanel";

function App() {
  const [project, setProject] = useState<ShaderProject>(defaultProject);
  const [activePassId, setActivePassId] = useState("buffer-a");
  const [apiKey, setApiKey] = useState("");
  const [importTarget, setImportTarget] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [saveStatus, setSaveStatus] = useState("Not saved");
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [showSetup, setShowSetup] = useState(false);
  const [hasLoadedProject, setHasLoadedProject] = useState(false);

  useEffect(() => {
    Promise.all([loadSettings(), loadLastProject(), listProjects()])
      .then(([settings, storedProject, projects]) => {
        if (settings.shadertoy_api_key) setApiKey(settings.shadertoy_api_key);
        else setShowSetup(true);
        if (storedProject?.project) {
          setProject(storedProject.project);
          setActivePassId(storedProject.project.passes.find((pass) => pass.type === "image")?.id ?? storedProject.project.passes[0].id);
          setSaveStatus(`Loaded ${storedProject.name}`);
        } else {
          setSaveStatus("Starter project");
        }
        setProjectList(projects);
        setHasLoadedProject(true);
      })
      .catch(() => {
        setShowSetup(true);
        setHasLoadedProject(true);
      });
  }, []);

  useEffect(() => {
    if (!hasLoadedProject) return;
    setSaveStatus("Saving...");
    const timeout = window.setTimeout(() => {
      saveProject(project)
        .then((storedProject) => {
          setSaveStatus(`Saved ${new Date(storedProject.updated_at).toLocaleTimeString()}`);
          return listProjects();
        })
        .then(setProjectList)
        .catch((error) => setSaveStatus(error instanceof Error ? error.message : String(error)));
    }, 600);

    return () => window.clearTimeout(timeout);
  }, [hasLoadedProject, project]);

  const activePass = useMemo(
    () => project.passes.find((pass) => pass.id === activePassId) ?? project.passes[0],
    [activePassId, project.passes]
  );

  function updatePassCode(pass: ShaderPass, code: string) {
    setProject((current) => ({
      ...current,
      passes: current.passes.map((item) => (item.id === pass.id ? { ...item, code } : item))
    }));
  }

  async function handleSaveApiKey(nextKey: string) {
    await saveApiKey(nextKey);
    setApiKey(nextKey);
    setShowSetup(false);
  }

  async function handleManualSave() {
    setSaveStatus("Saving...");
    try {
      const storedProject = await saveProject(project);
      setSaveStatus(`Saved ${new Date(storedProject.updated_at).toLocaleTimeString()}`);
      setProjectList(await listProjects());
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleLoadProject(projectId: string) {
    const storedProject = await loadProject(projectId);
    if (!storedProject?.project) return;
    setProject(storedProject.project);
    setActivePassId(storedProject.project.passes.find((pass) => pass.type === "image")?.id ?? storedProject.project.passes[0].id);
    setSaveStatus(`Loaded ${storedProject.name}`);
    setProjectList(await listProjects());
  }

  async function handleImport() {
    setImportStatus("Importing shader and caching assets...");
    try {
      const imported = await importShader(importTarget);
      const importedProject = shadertoyJsonToProject(imported.json, imported.source_url);
      await saveProject(importedProject);
      setProject(importedProject);
      setActivePassId(importedProject.passes.find((pass) => pass.type === "image")?.id ?? importedProject.passes[0].id);
      setImportStatus(`Imported ${imported.title}. It is stored locally and editable.`);
      setProjectList(await listProjects());
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Workspace">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={18} />
          </div>
          <div>
            <strong>ShaderTester</strong>
            <span>Offline shader IDE</span>
          </div>
        </div>

        <nav className="nav-stack" aria-label="Primary">
          <button className="nav-item active" type="button">
            <Code2 size={17} />
            Workspace
          </button>
          <button className="nav-item" type="button">
            <FolderOpen size={17} />
            Library
          </button>
          <button className="nav-item" type="button" onClick={() => setShowSetup(true)}>
            <Settings size={17} />
            Settings
          </button>
        </nav>

        <section className="library-panel">
          <div className="section-title">
            <span className="eyebrow">Library</span>
            <span>{projectList.length}</span>
          </div>
          <div className="project-list">
            {projectList.length === 0 ? (
              <p>No saved projects yet.</p>
            ) : (
              projectList.map((savedProject) => (
                <button
                  key={savedProject.id}
                  className={savedProject.id === project.id ? "active" : ""}
                  type="button"
                  onClick={() => handleLoadProject(savedProject.id)}
                >
                  <strong>{savedProject.name}</strong>
                  <span>{savedProject.author}</span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="project-card">
          <span className="eyebrow">Current Project</span>
          <h2>{project.name}</h2>
          <p>{project.description}</p>
          <div className="tag-row">
            {project.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </section>

        <section className="import-panel">
          <label htmlFor="import-target">Import from Shadertoy</label>
          <div className="import-row">
            <input
              id="import-target"
              value={importTarget}
              onChange={(event) => setImportTarget(event.target.value)}
              placeholder="ID or /view URL"
            />
            <button type="button" onClick={handleImport} aria-label="Import shader">
              <Download size={16} />
            </button>
          </div>
          <p>{importStatus || (apiKey ? "Online import is ready." : "Add an API key in settings first.")}</p>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="pass-tabs" role="tablist" aria-label="Shader passes">
            {project.passes.map((pass) => (
              <button
                key={pass.id}
                className={pass.id === activePass.id ? "active" : ""}
                onClick={() => setActivePassId(pass.id)}
                type="button"
              >
                {pass.name}
              </button>
            ))}
          </div>
          <div className="toolbar">
            <button type="button" title="Run">
              <Play size={16} />
            </button>
            <button type="button" title="Save" onClick={handleManualSave}>
              <Save size={16} />
            </button>
            <button type="button" title="API key" onClick={() => setShowSetup(true)}>
              <KeyRound size={16} />
            </button>
          </div>
        </header>

        <div className="ide-grid">
          <EditorPane pass={activePass} onChange={(code) => updatePassCode(activePass, code)} />
          <PreviewPane project={project} saveStatus={saveStatus} />
        </div>
      </section>

      {showSetup && (
        <SetupPanel
          initialApiKey={apiKey}
          onClose={() => setShowSetup(false)}
          onSave={handleSaveApiKey}
        />
      )}
    </main>
  );
}

export default App;
