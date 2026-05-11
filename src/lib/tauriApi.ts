import { invoke } from "@tauri-apps/api/core";
import type { ShaderProject } from "./shaderTypes";

export interface AppSettings {
  shadertoy_api_key?: string | null;
}

export interface ImportedShader {
  shader_id: string;
  source_url: string;
  title: string;
  json: unknown;
}

export interface StoredProject {
  id: string;
  name: string;
  author: string;
  description: string;
  tags: string[];
  source_url?: string | null;
  updated_at: string;
  project: ShaderProject;
}

export interface ProjectSummary {
  id: string;
  name: string;
  author: string;
  description: string;
  tags: string[];
  source_url?: string | null;
  updated_at: string;
}

const isTauri = "__TAURI_INTERNALS__" in window;
const projectsKey = "shadertester.projects";
const lastProjectKey = "shadertester.lastProjectId";

export async function loadSettings(): Promise<AppSettings> {
  if (!isTauri) {
    return {
      shadertoy_api_key: window.localStorage.getItem("shadertester.apiKey")
    };
  }

  return invoke<AppSettings>("load_settings");
}

export async function saveApiKey(apiKey: string): Promise<void> {
  if (!isTauri) {
    window.localStorage.setItem("shadertester.apiKey", apiKey);
    return;
  }

  await invoke("save_shadertoy_api_key", { apiKey });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  if (!isTauri) {
    return localProjects().map((project) => ({
      id: project.id,
      name: project.name,
      author: project.author,
      description: project.description,
      tags: project.tags,
      source_url: project.sourceUrl,
      updated_at: new Date().toISOString()
    }));
  }

  return invoke<ProjectSummary[]>("list_projects");
}

export async function loadLastProject(): Promise<StoredProject | null> {
  if (!isTauri) {
    const projects = localProjects();
    const lastProjectId = window.localStorage.getItem(lastProjectKey);
    const project = projects.find((item) => item.id === lastProjectId) ?? projects[0];
    return project ? localStoredProject(project) : null;
  }

  return invoke<StoredProject | null>("load_last_project");
}

export async function loadProject(projectId: string): Promise<StoredProject | null> {
  if (!isTauri) {
    const project = localProjects().find((item) => item.id === projectId);
    if (project) window.localStorage.setItem(lastProjectKey, project.id);
    return project ? localStoredProject(project) : null;
  }

  return invoke<StoredProject | null>("load_project", { projectId });
}

export async function saveProject(project: ShaderProject): Promise<StoredProject> {
  if (!isTauri) {
    const projects = localProjects();
    const nextProjects = [project, ...projects.filter((item) => item.id !== project.id)];
    window.localStorage.setItem(projectsKey, JSON.stringify(nextProjects));
    window.localStorage.setItem(lastProjectKey, project.id);
    return localStoredProject(project);
  }

  return invoke<StoredProject>("save_project", { project });
}

export async function deleteProject(projectId: string): Promise<void> {
  if (!isTauri) {
    const nextProjects = localProjects().filter((project) => project.id !== projectId);
    window.localStorage.setItem(projectsKey, JSON.stringify(nextProjects));
    if (window.localStorage.getItem(lastProjectKey) === projectId) {
      if (nextProjects[0]) window.localStorage.setItem(lastProjectKey, nextProjects[0].id);
      else window.localStorage.removeItem(lastProjectKey);
    }
    return;
  }

  await invoke("delete_project", { projectId });
}

export async function loadCachedAssetDataUrl(assetId: string): Promise<string | null> {
  if (!isTauri) {
    return assetId.startsWith("data:") || assetId.startsWith("http") ? assetId : null;
  }

  return invoke<string | null>("load_cached_asset_data_url", { sourcePath: assetId });
}

export async function importShader(shaderIdOrUrl: string): Promise<ImportedShader> {
  if (!isTauri) {
    throw new Error("Run ShaderTester as a desktop app to import from Shadertoy.");
  }

  return invoke<ImportedShader>("import_shader_from_shadertoy", { shaderIdOrUrl });
}

function localProjects(): ShaderProject[] {
  try {
    return JSON.parse(window.localStorage.getItem(projectsKey) ?? "[]") as ShaderProject[];
  } catch {
    return [];
  }
}

function localStoredProject(project: ShaderProject): StoredProject {
  return {
    id: project.id,
    name: project.name,
    author: project.author,
    description: project.description,
    tags: project.tags,
    source_url: project.sourceUrl,
    updated_at: new Date().toISOString(),
    project
  };
}
