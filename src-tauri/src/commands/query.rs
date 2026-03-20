use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::{
    AppError, AppState, TOPK_MAX_SEARCH,
    db::store::{ensure_chunks_table, search_chunks as db_search_chunks, SearchResult},
};

// ── Settings file ─────────────────────────────────────────────────────────────

const DEFAULT_MODEL: &str = "google/gemini-2.0-flash-exp:free";
const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

/// Persisted to {app_config_dir}/settings.json.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    model:   Option<String>,
}

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|d| d.join("settings.json"))
        .map_err(|e| AppError { code: "PATH".into(), message: e.to_string() })
}

fn load_settings(app: &AppHandle) -> Result<AppSettings, AppError> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| AppError { code: "SETTINGS_READ".into(), message: e.to_string() })?;
    serde_json::from_str(&raw)
        .map_err(|e| AppError { code: "SETTINGS_PARSE".into(), message: e.to_string() })
}

fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), AppError> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError { code: "SETTINGS_DIR".into(), message: e.to_string() })?;
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| AppError { code: "SETTINGS_SERIALIZE".into(), message: e.to_string() })?;
    std::fs::write(&path, json)
        .map_err(|e| AppError { code: "SETTINGS_WRITE".into(), message: e.to_string() })
}

// ── Chat types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role:    String, // "system" | "user" | "assistant"
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenRouterRequest {
    model:    String,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterResponse {
    choices: Vec<OpenRouterChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterChoice {
    message: ChatMessage,
}

// ── Return types ─────────────────────────────────────────────────────────────

/// Returned from chat_completion — includes both the LLM reply and the
/// retrieved source chunks so the frontend can offer "View sources".
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub reply:   String,
    pub sources: Vec<SearchResult>,
}

// ── search_chunks ─────────────────────────────────────────────────────────────

/// Run a vector similarity search against the active library.
/// `top_k` is clamped to `TOPK_MAX_SEARCH` (100).
#[tauri::command]
pub async fn search_chunks(
    query:    String,
    top_k:    usize,
    app:      tauri::AppHandle,
    state:    State<'_, AppState>,
) -> Result<Vec<SearchResult>, AppError> {
    let active_id = {
        let id_guard = state.active_library_id.read().await;
        id_guard.as_ref().cloned().ok_or(AppError {
            code:    "DB_NOT_OPEN".into(),
            message: "Open a library before searching.".into(),
        })?
    };

    let conn = {
        let db = state.active_db.read().await;
        db.clone().ok_or(AppError {
            code:    "DB_NOT_OPEN".into(),
            message: "Open a library before searching.".into(),
        })?
    };

    // Embed the query — acquire lock, run in block_in_place, release immediately.
    let (query_vec, dims) = {
        let registry = crate::commands::libraries::load_registry(&app).await
            .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;
        
        let mid = registry.iter()
            .find(|l| l.id == active_id)
            .and_then(|l| l.model_id.clone())
            .unwrap_or_else(|| "BAAI/bge-m3".into());

        let mut engine = state.embed_engine.lock().await;
        let v = tokio::task::block_in_place(|| engine.embed_query(&mid, &query))
            .map_err(|e| AppError { code: "EMBED".into(), message: e.to_string() })?;
        (v, engine.dims())
    };

    let table = ensure_chunks_table(&conn, dims)
        .await
        .map_err(|e| AppError { code: "LANCEDB".into(), message: e.to_string() })?;

    let clamped = top_k.min(TOPK_MAX_SEARCH);

    db_search_chunks(&table, query_vec, clamped)
        .await
        .map_err(|e| AppError { code: "SEARCH".into(), message: e.to_string() })
}

// ── chat_completion ───────────────────────────────────────────────────────────

/// Send a chat completion request to OpenRouter, injecting retrieved chunks as
/// system context. `top_k` is clamped to `TOPK_MAX_CHAT` (50).
#[tauri::command]
pub async fn chat_completion(
    messages: Vec<ChatMessage>,
    context:  Vec<SearchResult>,
    _top_k:   usize,
    app:      AppHandle,
) -> Result<ChatResponse, AppError> {
    let settings = load_settings(&app)?;

    let api_key = settings.api_key.filter(|k| !k.trim().is_empty()).ok_or(AppError {
        code:    "NO_API_KEY".into(),
        message: "OpenRouter API key not set. Please add it in Settings.".into(),
    })?;

    let model = settings.model
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());

    // Build context block from retrieved chunks.
    let context_text = context
        .iter()
        .enumerate()
        .map(|(i, r)| format!(
            "[{}] {} (p.{}, score {:.2})\n{}",
            i + 1,
            r.file_name,
            r.page_number.map(|p| p.to_string()).unwrap_or_else(|| "?".into()),
            r.score,
            r.text
        ))
        .collect::<Vec<_>>()
        .join("\n\n---\n\n");

    let system_prompt = format!(
        "You are a helpful research assistant. Answer the user's question using \
         ONLY the following document excerpts. If the answer cannot be found in \
         the excerpts, say so.\n\nDocument excerpts:\n\n{context_text}"
    );

    let mut all_messages = vec![ChatMessage {
        role:    "system".into(),
        content: system_prompt,
    }];
    all_messages.extend(messages);

    let client = Client::new();
    let resp = client
        .post(OPENROUTER_URL)
        .bearer_auth(&api_key)
        .json(&OpenRouterRequest {
            model,
            messages: all_messages,
        })
        .send()
        .await
        .map_err(|e| AppError { code: "HTTP".into(), message: e.to_string() })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body   = resp.text().await.unwrap_or_default();
        return Err(AppError {
            code:    "OPENROUTER".into(),
            message: format!("{status}: {body}"),
        });
    }

    let parsed: OpenRouterResponse = resp
        .json()
        .await
        .map_err(|e| AppError { code: "PARSE".into(), message: e.to_string() })?;

    parsed
        .choices
        .into_iter()
        .next()
        .map(|c| ChatResponse { reply: c.message.content, sources: context })
        .ok_or(AppError {
            code:    "EMPTY_RESPONSE".into(),
            message: "OpenRouter returned no choices.".into(),
        })
}

// ── API key ───────────────────────────────────────────────────────────────────

/// Save the OpenRouter API key to settings.json.
#[tauri::command]
pub async fn save_api_key(key: String, app: AppHandle) -> Result<(), AppError> {
    let mut settings = load_settings(&app)?;
    settings.api_key = if key.trim().is_empty() { None } else { Some(key) };
    save_settings(&app, &settings)
}

/// Retrieve the OpenRouter API key. Returns `None` if not set.
#[tauri::command]
pub async fn get_api_key(app: AppHandle) -> Result<Option<String>, AppError> {
    Ok(load_settings(&app)?.api_key)
}

// ── Model preference ──────────────────────────────────────────────────────────

/// Save the preferred OpenRouter model identifier to settings.json.
#[tauri::command]
pub async fn save_model_preference(model: String, app: AppHandle) -> Result<(), AppError> {
    let mut settings = load_settings(&app)?;
    settings.model = if model.trim().is_empty() { None } else { Some(model) };
    save_settings(&app, &settings)
}

/// Retrieve the preferred model. Returns `None` if not set.
#[tauri::command]
pub async fn get_model_preference(app: AppHandle) -> Result<Option<String>, AppError> {
    Ok(load_settings(&app)?.model)
}

