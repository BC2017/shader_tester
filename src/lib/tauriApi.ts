import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  shadertoy_api_key?: string | null;
}

export interface ImportedShader {
  shader_id: string;
  source_url: string;
  title: string;
  json: unknown;
}

const isTauri = "__TAURI_INTERNALS__" in window;

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

export async function importShader(shaderIdOrUrl: string): Promise<ImportedShader> {
  if (!isTauri) {
    throw new Error("Run ShaderTester as a desktop app to import from Shadertoy.");
  }

  return invoke<ImportedShader>("import_shader_from_shadertoy", { shaderIdOrUrl });
}
