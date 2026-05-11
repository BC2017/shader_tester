use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use thiserror::Error;

#[derive(Debug, Error)]
enum AppError {
    #[error("{0}")]
    Anyhow(#[from] anyhow::Error),
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
    #[error("{0}")]
    Sql(#[from] rusqlite::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Http(#[from] reqwest::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct AppSettings {
    shadertoy_api_key: Option<String>,
}

#[derive(Debug, Serialize)]
struct ImportedShader {
    shader_id: String,
    source_url: String,
    title: String,
    json: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct StoredProject {
    id: String,
    name: String,
    author: String,
    description: String,
    tags: Vec<String>,
    source_url: Option<String>,
    updated_at: String,
    project: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct ProjectSummary {
    id: String,
    name: String,
    author: String,
    tags: Vec<String>,
    updated_at: String,
}

fn app_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app.path().app_data_dir()?;
    fs::create_dir_all(&dir)?;
    fs::create_dir_all(dir.join("assets"))?;
    Ok(dir)
}

fn db(app: &AppHandle) -> Result<Connection, AppError> {
    let conn = Connection::open(app_dir(app)?.join("shadertester.sqlite3"))?;
    conn.execute_batch(
        r#"
        create table if not exists settings (
            key text primary key,
            value text not null
        );

        create table if not exists imported_shaders (
            id text primary key,
            source_url text not null,
            title text not null,
            json text not null,
            imported_at text not null
        );

        create table if not exists cached_assets (
            id text primary key,
            source_path text not null unique,
            local_path text not null,
            content_type text,
            cached_at text not null
        );

        create table if not exists projects (
            id text primary key,
            name text not null,
            author text not null,
            description text not null,
            tags text not null,
            source_url text,
            project_json text not null,
            created_at text not null,
            updated_at text not null,
            last_opened_at text
        );
        "#,
    )?;
    Ok(conn)
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<AppSettings, AppError> {
    let conn = db(&app)?;
    let api_key = conn
        .query_row(
            "select value from settings where key = 'shadertoy_api_key'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    Ok(AppSettings {
        shadertoy_api_key: api_key,
    })
}

#[tauri::command]
fn save_shadertoy_api_key(app: AppHandle, api_key: String) -> Result<(), AppError> {
    let conn = db(&app)?;
    conn.execute(
        "insert into settings (key, value) values ('shadertoy_api_key', ?1)
         on conflict(key) do update set value = excluded.value",
        params![api_key.trim()],
    )?;
    Ok(())
}

#[tauri::command]
fn list_projects(app: AppHandle) -> Result<Vec<ProjectSummary>, AppError> {
    let conn = db(&app)?;
    let mut statement = conn.prepare(
        "select id, name, author, tags, updated_at
         from projects
         order by datetime(coalesce(last_opened_at, updated_at)) desc, name asc",
    )?;

    let projects = statement
        .query_map([], |row| {
            let tags_json: String = row.get(3)?;
            Ok(ProjectSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                author: row.get(2)?,
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                updated_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(projects)
}

#[tauri::command]
fn load_last_project(app: AppHandle) -> Result<Option<StoredProject>, AppError> {
    let conn = db(&app)?;
    let project = conn
        .query_row(
            "select id, name, author, description, tags, source_url, updated_at, project_json
             from projects
             order by datetime(coalesce(last_opened_at, updated_at)) desc, name asc
             limit 1",
            [],
            stored_project_from_row,
        )
        .optional()?;

    if let Some(project) = &project {
        touch_project(&conn, &project.id)?;
    }

    Ok(project)
}

#[tauri::command]
fn load_project(app: AppHandle, project_id: String) -> Result<Option<StoredProject>, AppError> {
    let conn = db(&app)?;
    let project = conn
        .query_row(
            "select id, name, author, description, tags, source_url, updated_at, project_json
             from projects
             where id = ?1",
            params![project_id],
            stored_project_from_row,
        )
        .optional()?;

    if let Some(project) = &project {
        touch_project(&conn, &project.id)?;
    }

    Ok(project)
}

#[tauri::command]
fn save_project(app: AppHandle, project: serde_json::Value) -> Result<StoredProject, AppError> {
    let conn = db(&app)?;
    let id = string_field(&project, "id", "local-project");
    let name = string_field(&project, "name", "Untitled Shader");
    let author = string_field(&project, "author", "Local");
    let description = string_field(&project, "description", "");
    let tags = project
        .get("tags")
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(ToString::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let source_url = project
        .get("sourceUrl")
        .and_then(|value| value.as_str())
        .map(ToString::to_string);
    let now = chrono::Utc::now().to_rfc3339();
    let tags_json = serde_json::to_string(&tags)?;
    let project_json = serde_json::to_string_pretty(&project)?;

    conn.execute(
        "insert into projects (
            id, name, author, description, tags, source_url, project_json, created_at, updated_at, last_opened_at
         )
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8)
         on conflict(id) do update set
            name = excluded.name,
            author = excluded.author,
            description = excluded.description,
            tags = excluded.tags,
            source_url = excluded.source_url,
            project_json = excluded.project_json,
            updated_at = excluded.updated_at,
            last_opened_at = excluded.last_opened_at",
        params![
            id,
            name,
            author,
            description,
            tags_json,
            source_url,
            project_json,
            now,
        ],
    )?;

    Ok(StoredProject {
        id,
        name,
        author,
        description,
        tags,
        source_url,
        updated_at: now,
        project,
    })
}

#[tauri::command]
async fn import_shader_from_shadertoy(
    app: AppHandle,
    shader_id_or_url: String,
) -> Result<ImportedShader, AppError> {
    let shader_id = parse_shader_id(&shader_id_or_url)?;
    let conn = db(&app)?;
    let api_key: String = conn.query_row(
        "select value from settings where key = 'shadertoy_api_key'",
        [],
        |row| row.get(0),
    )?;

    let url = format!("https://www.shadertoy.com/api/v1/shaders/{shader_id}?key={api_key}");
    let client = reqwest::Client::new();
    let json: serde_json::Value = client.get(&url).send().await?.error_for_status()?.json().await?;
    let shader = json
        .get("Shader")
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("Shadertoy response did not include a Shader payload"))?;

    cache_shader_assets(&app, &client, &shader).await?;

    let title = shader
        .pointer("/info/name")
        .and_then(|value| value.as_str())
        .unwrap_or("Untitled Shader")
        .to_string();
    let source_url = format!("https://www.shadertoy.com/view/{shader_id}");

    conn.execute(
        "insert into imported_shaders (id, source_url, title, json, imported_at)
         values (?1, ?2, ?3, ?4, ?5)
         on conflict(id) do update set
            source_url = excluded.source_url,
            title = excluded.title,
            json = excluded.json,
            imported_at = excluded.imported_at",
        params![
            shader_id,
            source_url,
            title,
            serde_json::to_string_pretty(&shader)?,
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;

    Ok(ImportedShader {
        shader_id,
        source_url,
        title,
        json: shader,
    })
}

fn parse_shader_id(value: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    if let Ok(url) = url::Url::parse(trimmed) {
        if let Some(id) = url.path_segments().and_then(|segments| segments.last()) {
            if !id.is_empty() {
                return Ok(id.to_string());
            }
        }
    }

    if trimmed.len() >= 5 && trimmed.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Ok(trimmed.to_string());
    }

    Err(anyhow::anyhow!("Enter a Shadertoy shader ID or /view/... URL").into())
}

fn stored_project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredProject> {
    let tags_json: String = row.get(4)?;
    let project_json: String = row.get(7)?;
    Ok(StoredProject {
        id: row.get(0)?,
        name: row.get(1)?,
        author: row.get(2)?,
        description: row.get(3)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        source_url: row.get(5)?,
        updated_at: row.get(6)?,
        project: serde_json::from_str(&project_json).unwrap_or(serde_json::Value::Null),
    })
}

fn touch_project(conn: &Connection, project_id: &str) -> Result<(), AppError> {
    conn.execute(
        "update projects set last_opened_at = ?1 where id = ?2",
        params![chrono::Utc::now().to_rfc3339(), project_id],
    )?;
    Ok(())
}

fn string_field(project: &serde_json::Value, key: &str, fallback: &str) -> String {
    project
        .get(key)
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback)
        .to_string()
}

async fn cache_shader_assets(
    app: &AppHandle,
    client: &reqwest::Client,
    shader: &serde_json::Value,
) -> Result<(), AppError> {
    let Some(passes) = shader.get("renderpass").and_then(|value| value.as_array()) else {
        return Ok(());
    };

    for pass in passes {
        let Some(inputs) = pass.get("inputs").and_then(|value| value.as_array()) else {
            continue;
        };

        for input in inputs {
            let Some(src) = input.get("src").and_then(|value| value.as_str()) else {
                continue;
            };
            if src.is_empty() || src == "keyboard" || !src.starts_with("/media/") {
                continue;
            }

            let asset_url = format!("https://www.shadertoy.com{src}");
            let bytes = client.get(&asset_url).send().await?.error_for_status()?.bytes().await?;
            let digest = Sha256::digest(&bytes);
            let ext = src.rsplit('.').next().unwrap_or("asset");
            let filename = format!("{digest:x}.{ext}");
            let local_path = app_dir(app)?.join("assets").join(filename);
            fs::write(&local_path, bytes)?;

            let conn = db(app)?;
            conn.execute(
                "insert into cached_assets (id, source_path, local_path, content_type, cached_at)
                 values (?1, ?2, ?3, ?4, ?5)
                 on conflict(source_path) do update set
                    local_path = excluded.local_path,
                    content_type = excluded.content_type,
                    cached_at = excluded.cached_at",
                params![
                    format!("{digest:x}"),
                    src,
                    local_path.to_string_lossy(),
                    input.get("ctype").and_then(|value| value.as_str()),
                    chrono::Utc::now().to_rfc3339(),
                ],
            )?;
        }
    }

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_shadertoy_api_key,
            list_projects,
            load_last_project,
            load_project,
            save_project,
            import_shader_from_shadertoy
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShaderTester");
}
