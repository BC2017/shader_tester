use rusqlite::{params, Connection};
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
            import_shader_from_shadertoy
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShaderTester");
}
