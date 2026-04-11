---
name: rust-backend
description: Covers all Rust code in src-tauri/ for the Matthew app. Use when writing Tauri commands, defining AppState, handling errors, using async Rust patterns, emitting events to the frontend, accessing the OS keyring, resolving file paths, or registering plugins. Do not use for LanceDB schema, fastembed logic, PDF parsing, or React code — those have dedicated skills.
---

# Rust Backend — Tauri v2 Conventions

## CRITICAL: All Structs Sent to Frontend Must Use camelCase

**Every Rust struct that is serialized and sent to the React frontend MUST have `#[serde(rename_all = "camelCase")]`. Without it, Rust's snake_case field names (e.g. `chunk_count`) will arrive as snake_case in JS, while TypeScript interfaces expect camelCase (`chunkCount`), causing silent `undefined` errors.**

```rust
// CORRECT
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub chunk_count: usize,
    pub chunk_preset: String,
    pub has_been_ingested: bool,
    pub ingested_hashes: Vec<String>,
}

// WRONG — snake_case fields arrive as snake_case in JS
#[derive(Serialize)]
pub struct LibraryEntry {
    pub chunk_count: usize,  // arrives as "chunk_count" not "chunkCount"
}
```

This applies to: `LibraryEntry`, `IngestProgress`, `IngestedFile`, `SetupStatus`, `SearchResult`, and any other struct returned from a Tauri command or emitted as an event.

## Tauri Config Identifier

In `tauri.conf.json`, always use the reverse-domain identifier `io.github.story-essentia.matthew`. This ensures consistency with the cache and config directories across all platforms.

```json
{
  "identifier": "io.github.story-essentia.matthew"
}
```



Defined once in `lib.rs`, managed via `.manage()` in `main.rs`, injected into commands via `State<'_, AppState>`.

```rust
// src-tauri/src/lib.rs
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use crate::embed::engine::EmbedEngine;

pub struct AppState {
    pub embed_engine: Arc<Mutex<EmbedEngine>>,
    pub active_db: Arc<RwLock<Option<lancedb::Connection>>>,
    pub active_library_id: Arc<RwLock<Option<String>>>,
}
```

## main.rs Setup

```rust
// src-tauri/src/main.rs
mod lib;
mod commands;
mod db;
mod embed;
mod pdf;

use lib::AppState;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

#[tokio::main]
async fn main() {
    // EmbedEngine init is expensive (loads ONNX model) — do it once here
    let embed_engine = embed::engine::EmbedEngine::new()
        .expect("Failed to initialise fastembed model");

    let state = AppState {
        embed_engine: Arc::new(Mutex::new(embed_engine)),
        active_db: Arc::new(RwLock::new(None)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::libraries::list_libraries,
            commands::libraries::create_library,
            commands::libraries::open_library,
            commands::libraries::delete_library,
            commands::libraries::list_pdfs_in_folder,
            commands::ingest::ingest_pdfs,
            commands::query::search_chunks,
            commands::query::chat_completion,
            commands::query::save_api_key,
            commands::query::get_api_key,
            commands::query::save_model_preference,
            commands::query::get_model_preference,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## AppError — One Type For Everything

```rust
// src-tauri/src/lib.rs (continued)
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: String,    // machine-readable: "DB_NOT_OPEN", "EMBED_FAILED", etc.
    pub message: String, // human-readable, displayed in the UI
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError { code: "INTERNAL".into(), message: e.to_string() }
    }
}

impl From<lancedb::Error> for AppError {
    fn from(e: lancedb::Error) -> Self {
        AppError { code: "LANCEDB".into(), message: e.to_string() }
    }
}
```

All commands return `Result<T, AppError>`. Tauri serialises the `Err` variant to JSON automatically — the frontend receives it as a thrown JS exception from `invoke()`.

## Command Signature Pattern

```rust
#[tauri::command]
pub async fn my_command(
    some_arg: String,
    state: State<'_, AppState>,
    app: AppHandle,            // include only if you need path resolution or event emit
) -> Result<ReturnType, AppError> {
    // ...
}
```

Rules:
- Always `async`.
- Never `unwrap()` or `expect()` inside a command — always use `?`.
- Use `tokio::sync::Mutex` / `RwLock`, never `std::sync::Mutex` in async code.

## Locking Rules — Critical

Never hold an `Arc<Mutex<>>` lock across an `.await` point:

```rust
// CORRECT — lock acquired, work done, lock dropped before any await
let result = {
    let engine = state.embed_engine.lock().await;
    engine.embed_batch(texts)?  // synchronous call inside spawn_blocking
};
// lock is dropped here; result is moved out

// WRONG — lock held across await = potential deadlock
let engine = state.embed_engine.lock().await;
some_other_async_fn().await;   // deadlock risk
```

## Emitting Progress Events

For long-running ingestion, emit typed events — never return from the command until done.

**CRITICAL: `use tauri::Emitter;` is required to call `.emit()` on AppHandle.**
`Manager` does NOT provide `.emit()` — they are separate traits. Always import both if you need both path resolution and event emission:

```rust
use tauri::{AppHandle, Emitter, Manager};
```

```rust
// Payload struct must derive Clone + Serialize
#[derive(Clone, Serialize)]
pub struct IngestProgress {
    pub current_file: usize,
    pub total_files: usize,
    pub file_name: String,
    pub phase: String,          // "parsing" | "embedding" | "storing" | "done" | "error"
    pub chunks_so_far: usize,
    pub error: Option<String>,  // populated only on per-file errors
}

// Emit inside an async command:
app.emit("ingest:progress", IngestProgress { ... })
    .map_err(|e| AppError { code: "EVENT".into(), message: e.to_string() })?;
```

## File Paths — Always Use Tauri Resolver

```rust
use tauri::Manager;

// Config dir: ~/.config/matthew/ on Linux
//             ~/Library/Application Support/matthew/ on macOS
//             %APPDATA%\matthew\ on Windows
let config_dir = app.path().app_config_dir()
    .map_err(|e| AppError { code: "PATH".into(), message: e.to_string() })?;

let registry = config_dir.join("libraries.json");
tokio::fs::create_dir_all(&config_dir).await?;
```

## Library Registry Helpers

```rust
// src-tauri/src/commands/libraries.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub chunk_count: usize,
    pub chunk_preset: ChunkPreset, // use the enum
    pub model_id: String,          // The embedding model for this library
    pub has_been_ingested: bool,
    pub ingested_hashes: Vec<String>,
}

pub async fn load_registry(app: &AppHandle) -> anyhow::Result<Vec<LibraryEntry>> {
    let path = app.path().app_config_dir()?.join("libraries.json");
    if !path.exists() { return Ok(vec![]); }
    let raw = tokio::fs::read_to_string(&path).await?;
    Ok(serde_json::from_str(&raw)?)
}

pub async fn save_registry(app: &AppHandle, entries: &[LibraryEntry]) -> anyhow::Result<()> {
    let path = app.path().app_config_dir()?.join("libraries.json");
    tokio::fs::create_dir_all(path.parent().unwrap()).await?;
    tokio::fs::write(&path, serde_json::to_string_pretty(entries)?).await?;
    Ok(())
}
```

## Settings — File-Based API Key Storage

We do NOT use the `keyring` crate as it is unreliable on some Linux distributions (requiring dbus/gnome-keyring). Instead, we use a simple `settings.json` file in the app config directory.

```rust
// src-tauri/src/commands/query.rs
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    model:   Option<String>,
}

fn load_settings(app: &AppHandle) -> Result<AppSettings, AppError> {
    let path = app.path().app_config_dir()?.join("settings.json");
    if !path.exists() { return Ok(AppSettings::default()); }
    let raw = std::fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&raw)?)
}

#[tauri::command]
pub async fn save_api_key(key: String, app: AppHandle) -> Result<(), AppError> {
    let mut settings = load_settings(&app)?;
    settings.api_key = if key.trim().is_empty() { None } else { Some(key) };
    // ... save to file ...
    Ok(())
}
```

## Module Layout

```
src-tauri/src/
├── main.rs          — builder, plugin registration, state init
├── lib.rs           — AppState, AppError, shared From<> impls
├── commands/
│   ├── mod.rs       — pub mod declarations
│   ├── libraries.rs — list/create/open/delete library + list_pdfs_in_folder
│   ├── ingest.rs    — ingest_pdfs (streaming pipeline via events)
│   └── query.rs     — search_chunks, chat_completion, keyring commands
├── db/
│   ├── mod.rs
│   ├── schema.rs    — Arrow schema definition
│   └── store.rs     — open_connection, ensure_table, insert_chunks, search
├── embed/
│   ├── mod.rs
│   └── engine.rs    — EmbedEngine (wraps fastembed TextEmbedding)
└── pdf/
    ├── mod.rs
    └── extractor.rs — PdfExtractor: parse pages, sliding-window chunking
```

## What Not To Do

- No `unwrap()` / `expect()` in commands or library code.
- No `std::sync::Mutex` in async context — always `tokio::sync::Mutex`.
- No hardcoded paths — always `app.path().app_config_dir()` or similar.
- No API keys in logs, serde-serialised structs, or error messages.
- No blocking I/O on the async runtime — wrap with `tokio::task::spawn_blocking`.

## v13 Changes

### Settings — File-Based (keyring removed)

```rust
// src-tauri/src/commands/query.rs
#[derive(serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    api_key: Option<String>,
    model: Option<String>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app.path().app_config_dir()?.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Result<AppSettings, AppError> {
    let path = settings_path(app)?;
    if !path.exists() { return Ok(AppSettings::default()); }
    let text = fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&text)?)
}

fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), AppError> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
    fs::write(&path, serde_json::to_string_pretty(settings)?)?;
    Ok(())
}
```

### ChatResponse — chat_completion returns reply + sources

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub reply: String,
    pub sources: Vec<SearchResult>,
}
// chat_completion returns Result<ChatResponse, AppError>
// The retrieved context chunks are moved into ChatResponse.sources
```

### SearchResult must have camelCase

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]  // REQUIRED — nested in ChatResponse
pub struct SearchResult {
    pub id: String,
    pub doc_id: String,
    pub source_path: String,
    pub file_name: String,
    pub page_number: Option<i32>,
    pub chunk_index: i32,
    pub text: String,
    pub score: f32,
}
```

### chats.rs — Chat History Commands

```rust
// src-tauri/src/commands/chats.rs
#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatMeta {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub chat_path: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub role: String,
    pub content: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatData {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub messages: Vec<StoredMessage>,
}

// Commands: list_chats, load_chat, save_chat, delete_chat
// Chats stored at: {library_path}/chats/{id}.json
// list_chats returns vec sorted newest first by createdAt
// If chats/ dir doesn't exist, list_chats returns empty vec
```

Register in main.rs invoke_handler:
```rust
commands::chats::list_chats,
commands::chats::load_chat,
commands::chats::save_chat,
commands::chats::delete_chat,
```

### Int32Builder for Nullable Columns

When building Arrow arrays with nullable i32 values, use the explicit builder pattern:

```rust
use arrow_array::builder::Int32Builder;

let mut page_builder = Int32Builder::new();
for c in &chunks {
    match c.page_number {
        Some(p) => page_builder.append_value(p),
        None    => page_builder.append_null(),
    }
}
let page_array = Arc::new(page_builder.finish());
```

Do NOT use `Int32Array::from(Vec<Option<i32>>)` — it may silently produce incorrect null bitmaps.
