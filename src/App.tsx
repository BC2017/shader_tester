import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Code2, Download, FolderOpen, KeyRound, Pause, Play, Plus, RotateCcw, Save, Settings, Sparkles } from "lucide-react";
import { defaultProject } from "./lib/defaultProject";
import { upgradeProject } from "./lib/projectMigrations";
import type { ShaderChannel, ShaderPass, ShaderProject } from "./lib/shaderTypes";
import { shadertoyJsonToProject } from "./lib/shadertoyImport";
import {
  deleteProject,
  importShader,
  loadLastProject,
  loadProject,
  loadSettings,
  listProjects,
  saveApiKey,
  saveProject
} from "./lib/tauriApi";
import type { ProjectSummary, StoredProject } from "./lib/tauriApi";
import { EditorPane } from "./components/EditorPane";
import { PreviewPane } from "./components/PreviewPane";
import { SetupPanel } from "./components/SetupPanel";
import { ChannelPanel } from "./components/ChannelPanel";
import { ProjectLibrary } from "./components/ProjectLibrary";

const bufferSlots = [
  { id: "buffer-a", name: "Buffer A" },
  { id: "buffer-b", name: "Buffer B" },
  { id: "buffer-c", name: "Buffer C" },
  { id: "buffer-d", name: "Buffer D" }
];

const defaultBufferCode = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 previous = texture(iChannel0, uv).rgb;
    vec3 color = vec3(uv, 0.5 + 0.5 * sin(iTime));
    fragColor = vec4(mix(color, previous, 0.12), 1.0);
}`;

function App() {
  const skipNextAutoSaveRef = useRef(false);
  const [project, setProject] = useState<ShaderProject>(() => freshDefaultProject());
  const [activeView, setActiveView] = useState<"workspace" | "library">("workspace");
  const [activePassId, setActivePassId] = useState("buffer-a");
  const [projectSummaries, setProjectSummaries] = useState<ProjectSummary[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [importTarget, setImportTarget] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [saveStatus, setSaveStatus] = useState("Not saved");
  const [libraryStatus, setLibraryStatus] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [hasLoadedProject, setHasLoadedProject] = useState(false);
  const [isPreviewPaused, setIsPreviewPaused] = useState(false);
  const [showEditorMinimap, setShowEditorMinimap] = useState(true);
  const [showChannelEditor, setShowChannelEditor] = useState(true);

  const refreshProjectSummaries = useCallback(async () => {
    try {
      const summaries = await listProjects();
      setProjectSummaries(summaries);
      setLibraryStatus(summaries.length > 0 ? `${summaries.length} project${summaries.length === 1 ? "" : "s"}` : "No saved projects");
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const activateProject = useCallback((nextProject: ShaderProject, statusMessage: string) => {
    const upgradedProject = upgradeProject(nextProject);
    setProject(upgradedProject);
    setActivePassId(defaultActivePassId(upgradedProject));
    setSaveStatus(statusMessage);
    setImportStatus("");
    setIsDirty(false);
  }, []);

  useEffect(() => {
    Promise.all([loadSettings(), loadLastProject()])
      .then(([settings, storedProject]) => {
        if (settings.shadertoy_api_key) setApiKey(settings.shadertoy_api_key);
        else setShowSetup(true);
        if (storedProject?.project) {
          activateProject(storedProject.project, `Loaded ${storedProject.name}`);
        } else {
          setSaveStatus("Starter project");
        }
        setHasLoadedProject(true);
        void refreshProjectSummaries();
      })
      .catch(() => {
        setShowSetup(true);
        setHasLoadedProject(true);
        void refreshProjectSummaries();
      });
  }, [activateProject, refreshProjectSummaries]);

  useEffect(() => {
    if (!hasLoadedProject) return;
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }
    setSaveStatus("Saving...");
    const timeout = window.setTimeout(() => {
      saveProject(project)
        .then((storedProject) => {
          setSaveStatus(`Saved ${new Date(storedProject.updated_at).toLocaleTimeString()}`);
          setProjectSummaries((current) => upsertProjectSummary(current, storedProject));
          setIsDirty(false);
        })
        .catch((error) => setSaveStatus(error instanceof Error ? error.message : String(error)));
    }, 600);

    return () => window.clearTimeout(timeout);
  }, [hasLoadedProject, project]);

  const activePass = useMemo(
    () => project.passes.find((pass) => pass.id === activePassId) ?? project.passes[0],
    [activePassId, project.passes]
  );
  const bufferPasses = useMemo(
    () => project.passes.filter((pass) => pass.type === "buffer"),
    [project.passes]
  );
  const missingBufferSlots = useMemo(
    () => bufferSlots.filter((slot) => !project.passes.some((pass) => pass.id === slot.id)),
    [project.passes]
  );
  const textureOptions = useMemo(() => {
    const textures = new Map<string, { assetId: string; label: string; mediaType?: "image" | "video" | "audio" }>();
    for (const pass of project.passes) {
      for (const channel of pass.channels) {
        if (channel.source.kind !== "texture") continue;
        const assetId = channel.source.assetId;
        textures.set(assetId, {
          assetId,
          mediaType: channel.source.mediaType,
          label: mediaLabel(assetId, channel.source.mediaType)
        });
      }
    }
    return [...textures.values()];
  }, [project.passes]);

  function updatePassCode(pass: ShaderPass, code: string) {
    setProject((current) => ({
      ...current,
      passes: current.passes.map((item) => (item.id === pass.id ? { ...item, code } : item))
    }));
    setIsDirty(true);
    setSaveStatus("Unsaved changes");
  }

  function updatePassChannel(pass: ShaderPass, channel: ShaderChannel) {
    setProject((current) => ({
      ...current,
      passes: current.passes.map((item) => {
        if (item.id !== pass.id) return item;
        const channels = [...item.channels.filter((existing) => existing.index !== channel.index), channel]
          .sort((left, right) => left.index - right.index);
        return { ...item, channels };
      })
    }));
    setIsDirty(true);
    setSaveStatus("Unsaved channel changes");
  }

  async function handleSaveApiKey(nextKey: string) {
    await saveApiKey(nextKey);
    setApiKey(nextKey);
    setShowSetup(false);
  }

  const handleManualSave = useCallback(async () => {
    setSaveStatus("Saving...");
    try {
      const storedProject = await saveProject(project);
      setSaveStatus(`Saved ${new Date(storedProject.updated_at).toLocaleTimeString()}`);
      setProjectSummaries((current) => upsertProjectSummary(current, storedProject));
      setIsDirty(false);
      return true;
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [project]);

  const saveBeforeProjectSwitch = useCallback(async () => {
    if (!isDirty) return true;
    const shouldSave = window.confirm("Save changes before switching projects?");
    if (!shouldSave) return false;
    return handleManualSave();
  }, [handleManualSave, isDirty]);

  const handleOpenProject = useCallback(async (projectId: string) => {
    if (projectId === project.id) {
      setActiveView("workspace");
      return;
    }
    if (!(await saveBeforeProjectSwitch())) return;

    setLibraryStatus("Opening project...");
    try {
      const storedProject = await loadProject(projectId);
      if (!storedProject?.project) throw new Error("Project was not found.");
      activateProject(storedProject.project, `Loaded ${storedProject.name}`);
      setProjectSummaries((current) => upsertProjectSummary(current, storedProject));
      setActiveView("workspace");
      void refreshProjectSummaries();
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : String(error));
    }
  }, [activateProject, project.id, refreshProjectSummaries, saveBeforeProjectSwitch]);

  const handleCreateProject = useCallback(async () => {
    if (!(await saveBeforeProjectSwitch())) return;
    const nextProject = {
      ...freshDefaultProject(),
      id: newProjectId(),
      name: "Untitled Shader",
      author: "Local",
      sourceUrl: undefined,
      tags: ["local"]
    };

    setLibraryStatus("Creating project...");
    try {
      const storedProject = await saveProject(nextProject);
      activateProject(storedProject.project, `Created ${storedProject.name}`);
      setProjectSummaries((current) => upsertProjectSummary(current, storedProject));
      setActiveView("workspace");
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : String(error));
    }
  }, [activateProject, saveBeforeProjectSwitch]);

  const handleRenameProject = useCallback(async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === project.name) return;
    const renamedProject = { ...project, name: trimmedName };

    setProject(renamedProject);
    setSaveStatus("Renaming project...");
    try {
      const storedProject = await saveProject(renamedProject);
      setSaveStatus(`Renamed ${storedProject.name}`);
      setProjectSummaries((current) => upsertProjectSummary(current, storedProject));
      setIsDirty(false);
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : String(error));
    }
  }, [project]);

  const handleDuplicateProject = useCallback(async (name: string) => {
    const copyName = name.trim() || `${project.name} Copy`;
    const projectCopy = {
      ...structuredCloneProject(project),
      id: newProjectId(),
      name: copyName,
      editable: true
    };

    setLibraryStatus("Saving copy...");
    try {
      const storedProject = await saveProject(projectCopy);
      activateProject(storedProject.project, `Saved copy ${storedProject.name}`);
      setProjectSummaries((current) => upsertProjectSummary(current, storedProject));
      setActiveView("workspace");
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : String(error));
    }
  }, [activateProject, project]);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    const projectToDelete = projectSummaries.find((summary) => summary.id === projectId);
    const projectName = projectToDelete?.name ?? (projectId === project.id ? project.name : "this project");
    if (!window.confirm(`Delete "${projectName}"? This cannot be undone.`)) return;

    setLibraryStatus("Deleting project...");
    try {
      await deleteProject(projectId);
      const summaries = await listProjects();
      setProjectSummaries(summaries);
      setLibraryStatus(summaries.length > 0 ? `${summaries.length} project${summaries.length === 1 ? "" : "s"}` : "No saved projects");

      if (projectId === project.id) {
        const nextProject = summaries[0] ? await loadProject(summaries[0].id) : null;
        if (nextProject?.project) {
          activateProject(nextProject.project, `Loaded ${nextProject.name}`);
        } else {
          const starterProject = freshDefaultProject();
          skipNextAutoSaveRef.current = true;
          setProject(starterProject);
          setActivePassId(defaultActivePassId(starterProject));
          setSaveStatus("No saved project open");
          setIsDirty(false);
        }
      }
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : String(error));
    }
  }, [activateProject, project.id, project.name, projectSummaries]);

  const handleTogglePreview = useCallback(() => {
    setIsPreviewPaused((current) => {
      setSaveStatus(current ? "Preview resumed" : "Preview paused");
      return !current;
    });
  }, []);

  const handleResetStarter = useCallback(() => {
    const starterProject = freshDefaultProject();
    setProject(starterProject);
    setActivePassId(defaultActivePassId(starterProject));
    setIsDirty(true);
    setSaveStatus("Reset to starter shader");
    setImportStatus("");
  }, []);

  const handleAddBuffer = useCallback((slot: { id: string; name: string }) => {
    const nextPass: ShaderPass = {
      id: slot.id,
      name: slot.name,
      type: "buffer",
      code: defaultBufferCode,
      channels: [
        {
          index: 0,
          source: { kind: "buffer", passId: slot.id },
          filter: "linear",
          wrap: "clamp",
          vflip: false
        }
      ]
    };

    setProject((current) => {
      const imageIndex = current.passes.findIndex((pass) => pass.type === "image");
      const insertIndex = imageIndex >= 0 ? imageIndex : current.passes.length;
      return {
        ...current,
        passes: [
          ...current.passes.slice(0, insertIndex),
          nextPass,
          ...current.passes.slice(insertIndex)
        ]
      };
    });
    setActivePassId(slot.id);
    setIsDirty(true);
    setSaveStatus(`Added ${slot.name}`);
  }, []);

  const handleRemoveActivePass = useCallback(() => {
    if (activePass.type !== "buffer" || activePass.id === "buffer-a") return;
    const removedPass = activePass;
    setProject((current) => ({
      ...current,
      passes: current.passes
        .filter((pass) => pass.id !== removedPass.id)
        .map((pass) => ({
          ...pass,
          channels: pass.channels.map((channel) => (
            channel.source.kind === "buffer" && channel.source.passId === removedPass.id
              ? { ...channel, source: { kind: "none" as const } }
              : channel
          ))
        }))
    }));
    setActivePassId("image");
    setIsDirty(true);
    setSaveStatus(`Removed ${removedPass.name}`);
  }, [activePass]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void handleManualSave();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleManualSave]);

  async function handleImport() {
    setImportStatus("Importing shader and caching assets...");
    try {
      const imported = await importShader(importTarget);
      const importedProject = shadertoyJsonToProject(imported.json, imported.source_url);
      const storedProject = await saveProject(importedProject);
      activateProject(importedProject, `Imported ${imported.title}`);
      setProjectSummaries((current) => upsertProjectSummary(current, storedProject));
      setImportStatus(`Imported ${imported.title}. It is stored locally and editable.`);
      setIsDirty(false);
      setActiveView("workspace");
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
          <button
            className={activeView === "workspace" ? "nav-item active" : "nav-item"}
            type="button"
            onClick={() => setActiveView("workspace")}
          >
            <Code2 size={17} />
            Workspace
          </button>
          <button
            className={activeView === "library" ? "nav-item active" : "nav-item"}
            type="button"
            onClick={() => {
              setActiveView("library");
              void refreshProjectSummaries();
            }}
          >
            <FolderOpen size={17} />
            Library
          </button>
          <button className="nav-item" type="button" onClick={() => setShowSetup(true)}>
            <Settings size={17} />
            Settings
          </button>
        </nav>

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
          {activeView === "workspace" ? (
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
          ) : (
            <div className="topbar-title">
              <span className="eyebrow">Project Library</span>
              <strong>{project.name}</strong>
            </div>
          )}
          {activeView === "workspace" && missingBufferSlots.length > 0 && (
            <div className="pass-actions" aria-label="Add buffer pass">
              {missingBufferSlots.map((slot) => (
                <button key={slot.id} type="button" onClick={() => handleAddBuffer(slot)}>
                  <Plus size={14} />
                  <span>{slot.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="toolbar">
            <button
              type="button"
              title={isPreviewPaused ? "Resume preview" : "Pause preview"}
              onClick={handleTogglePreview}
            >
              {isPreviewPaused ? <Play size={16} /> : <Pause size={16} />}
            </button>
            <button type="button" title="Reset to starter shader" onClick={handleResetStarter}>
              <RotateCcw size={16} />
            </button>
            <button
              type="button"
              className={isDirty ? "save-command dirty" : "save-command"}
              title="Save changes"
              onClick={handleManualSave}
            >
              <Save size={16} />
              <span>{isDirty ? "Save Changes" : "Saved"}</span>
            </button>
            <button type="button" title="API key" onClick={() => setShowSetup(true)}>
              <KeyRound size={16} />
            </button>
          </div>
        </header>

        {activeView === "workspace" ? (
          <div className="ide-grid">
            <EditorPane
              pass={activePass}
              showMinimap={showEditorMinimap}
              onChange={(code) => updatePassCode(activePass, code)}
              controls={showChannelEditor ? (
                <ChannelPanel
                  pass={activePass}
                  bufferPasses={bufferPasses}
                  textureOptions={textureOptions}
                  canRemovePass={activePass.type === "buffer" && activePass.id !== "buffer-a"}
                  onChannelChange={(channel) => updatePassChannel(activePass, channel)}
                  onRemovePass={handleRemoveActivePass}
                />
              ) : null}
            />
            <PreviewPane project={project} isPaused={isPreviewPaused} saveStatus={saveStatus} />
          </div>
        ) : (
          <ProjectLibrary
            currentProject={project}
            projects={projectSummaries}
            isDirty={isDirty}
            status={libraryStatus || saveStatus}
            onOpenProject={handleOpenProject}
            onCreateProject={handleCreateProject}
            onRenameProject={handleRenameProject}
            onDuplicateProject={handleDuplicateProject}
            onDeleteProject={handleDeleteProject}
            onRefresh={() => void refreshProjectSummaries()}
          />
        )}
      </section>

      {showSetup && (
        <SetupPanel
          initialApiKey={apiKey}
          showEditorMinimap={showEditorMinimap}
          showChannelEditor={showChannelEditor}
          isPreviewPaused={isPreviewPaused}
          onClose={() => setShowSetup(false)}
          onSave={handleSaveApiKey}
          onShowEditorMinimapChange={setShowEditorMinimap}
          onShowChannelEditorChange={setShowChannelEditor}
          onPreviewPausedChange={setIsPreviewPaused}
        />
      )}
    </main>
  );
}

function freshDefaultProject(): ShaderProject {
  return JSON.parse(JSON.stringify(defaultProject)) as ShaderProject;
}

function defaultActivePassId(project: ShaderProject) {
  return project.passes.find((pass) => pass.type === "image")?.id ?? project.passes[0].id;
}

function structuredCloneProject(project: ShaderProject): ShaderProject {
  return JSON.parse(JSON.stringify(project)) as ShaderProject;
}

function newProjectId() {
  return crypto.randomUUID ? crypto.randomUUID() : `project-${Date.now()}`;
}

function upsertProjectSummary(projects: ProjectSummary[], storedProject: StoredProject): ProjectSummary[] {
  const summary = {
    id: storedProject.id,
    name: storedProject.name,
    author: storedProject.author,
    description: storedProject.description,
    tags: storedProject.tags,
    source_url: storedProject.source_url,
    updated_at: storedProject.updated_at
  };

  return [summary, ...projects.filter((project) => project.id !== storedProject.id)];
}

function mediaLabel(assetId: string, mediaType?: "image" | "video" | "audio") {
  const pathParts = assetId.split("/").filter(Boolean);
  const pathPart = pathParts[pathParts.length - 1] ?? assetId;
  return mediaType ? `${pathPart} (${mediaType})` : pathPart;
}

export default App;
