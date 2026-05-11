import { useEffect, useState } from "react";
import { Copy, ExternalLink, FolderOpen, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";
import type { ShaderProject } from "../lib/shaderTypes";
import type { ProjectSummary } from "../lib/tauriApi";

interface ProjectLibraryProps {
  currentProject: ShaderProject;
  projects: ProjectSummary[];
  isDirty: boolean;
  status: string;
  onOpenProject: (projectId: string) => void;
  onCreateProject: () => void;
  onRenameProject: (name: string) => void;
  onDuplicateProject: (name: string) => void;
  onDeleteProject: (projectId: string) => void;
  onRefresh: () => void;
}

export function ProjectLibrary({
  currentProject,
  projects,
  isDirty,
  status,
  onOpenProject,
  onCreateProject,
  onRenameProject,
  onDuplicateProject,
  onDeleteProject,
  onRefresh
}: ProjectLibraryProps) {
  const [renameValue, setRenameValue] = useState(currentProject.name);
  const [copyName, setCopyName] = useState(`${currentProject.name} Copy`);

  useEffect(() => {
    setRenameValue(currentProject.name);
    setCopyName(`${currentProject.name} Copy`);
  }, [currentProject.id, currentProject.name]);

  const currentSummary = projects.find((project) => project.id === currentProject.id);
  const sourceUrl = currentProject.sourceUrl ?? currentSummary?.source_url;
  const sortedProjects = [...projects].sort((left, right) => (
    Number(left.id !== currentProject.id) - Number(right.id !== currentProject.id)
      || left.name.localeCompare(right.name)
  ));

  return (
    <section className="library-view" aria-label="Project library">
      <header className="library-header">
        <div>
          <span className="eyebrow">Library</span>
          <h1>Projects</h1>
        </div>
        <div className="library-actions">
          <button type="button" onClick={onRefresh} title="Refresh library">
            <RefreshCcw size={15} />
            <span>Refresh</span>
          </button>
          <button type="button" onClick={onCreateProject} title="New starter project">
            <Plus size={15} />
            <span>New</span>
          </button>
        </div>
      </header>

      <div className="library-layout">
        <div className="project-list" aria-label="Saved projects">
          {sortedProjects.length === 0 ? (
            <div className="empty-library">
              <span>No saved projects</span>
            </div>
          ) : sortedProjects.map((project) => {
            const isActive = project.id === currentProject.id;
            return (
              <article className={isActive ? "project-row active" : "project-row"} key={project.id}>
                <button type="button" className="project-open" onClick={() => onOpenProject(project.id)}>
                  <span className="project-row-title">
                    <strong>{project.name}</strong>
                    {isActive && <span>{isDirty ? "Unsaved" : "Open"}</span>}
                  </span>
                  <span>{project.author || "Local"}</span>
                  <span>{project.source_url ? "Shadertoy import" : "Local project"} · {formatDate(project.updated_at)}</span>
                  {project.description && <span>{project.description}</span>}
                  {project.tags.length > 0 && (
                    <span className="project-tags">
                      {project.tags.slice(0, 4).map((tag) => <em key={tag}>{tag}</em>)}
                    </span>
                  )}
                </button>
                <div className="project-row-actions">
                  <button type="button" title={`Open ${project.name}`} onClick={() => onOpenProject(project.id)}>
                    <FolderOpen size={15} />
                  </button>
                  <button type="button" title={`Delete ${project.name}`} onClick={() => onDeleteProject(project.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="project-inspector" aria-label="Current project">
          <div className="inspector-heading">
            <span className="eyebrow">Current Project</span>
            <h2>{currentProject.name}</h2>
            <p>{status}</p>
          </div>

          <dl className="project-meta">
            <div>
              <dt>Author</dt>
              <dd>{currentProject.author || "Local"}</dd>
            </div>
            <div>
              <dt>Passes</dt>
              <dd>{currentProject.passes.filter((pass) => pass.type !== "common").length}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{currentSummary ? formatDate(currentSummary.updated_at) : "Not saved"}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>
                {sourceUrl ? (
                  <a href={sourceUrl} target="_blank" rel="noreferrer">
                    Shadertoy <ExternalLink size={12} />
                  </a>
                ) : "Local"}
              </dd>
            </div>
          </dl>

          <form
            className="library-form"
            onSubmit={(event) => {
              event.preventDefault();
              onRenameProject(renameValue);
            }}
          >
            <label htmlFor="project-name">Project name</label>
            <div className="library-form-row">
              <input
                id="project-name"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
              />
              <button type="submit" title="Rename project">
                <Save size={15} />
                <span>Rename</span>
              </button>
            </div>
          </form>

          <form
            className="library-form"
            onSubmit={(event) => {
              event.preventDefault();
              onDuplicateProject(copyName);
            }}
          >
            <label htmlFor="project-copy-name">Save as</label>
            <div className="library-form-row">
              <input
                id="project-copy-name"
                value={copyName}
                onChange={(event) => setCopyName(event.target.value)}
              />
              <button type="submit" title="Save copy">
                <Copy size={15} />
                <span>Copy</span>
              </button>
            </div>
          </form>

          <button
            className="library-danger"
            type="button"
            onClick={() => onDeleteProject(currentProject.id)}
          >
            <Trash2 size={15} />
            <span>Delete Current Project</span>
          </button>
        </aside>
      </div>
    </section>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
