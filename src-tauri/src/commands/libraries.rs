use std::collections::HashMap;

use tauri::{AppHandle, Manager, State};
use uuid::Uuid;
use chrono::Utc;
use futures::TryStreamExt;
use arrow_array::{cast::AsArray, RecordBatch};
use lancedb::query::{ExecutableQuery, QueryBase, Select};

use crate::{
    AppError, AppState, ChunkPreset, LibraryEntry,
    db::store::{open_connection, ensure_chunks_table},
};

// ── Serialisable return types ─────────────────────────────────────────────────

/// One row in the ingested-files list returned to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestedFile {
    pub source_file: String,
    pub chunk_count: usize,
}
// ── LibraryMeta ──────────────────────────────────────────────────────────────

/// Subset of LibraryEntry stored within the library folder itself so settings
/// can be recovered when re-importing an existing library.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LibraryMeta {
    pub chunk_preset: ChunkPreset,
    pub model_id:     Option<String>,
}

// ── Registry helpers ──────────────────────────────────────────────────────────

/// Load the library registry from `{app_config_dir}/libraries.json`.
/// Returns an empty Vec if the file does not exist yet.
pub async fn load_registry(app: &AppHandle) -> anyhow::Result<Vec<LibraryEntry>> {
    let path = app
        .path()
        .app_config_dir()?
        .join("libraries.json");
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = tokio::fs::read_to_string(&path).await?;
    Ok(serde_json::from_str(&raw)?)
}

/// Persist the library registry to `{app_config_dir}/libraries.json`.
pub async fn save_registry(app: &AppHandle, entries: &[LibraryEntry]) -> anyhow::Result<()> {
    let path = app
        .path()
        .app_config_dir()?
        .join("libraries.json");
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(&path, serde_json::to_string_pretty(entries)?).await?;
    Ok(())
}

/// Save metadata to `library.json` inside the library folder.
pub async fn save_library_meta(path: &str, meta: &LibraryMeta) -> anyhow::Result<()> {
    let file_path = std::path::Path::new(path).join("library.json");
    let raw = serde_json::to_string_pretty(meta)?;
    tokio::fs::write(file_path, raw).await?;
    Ok(())
}

/// Load metadata from `library.json` inside the library folder.
pub async fn load_library_meta(path: &str) -> anyhow::Result<Option<LibraryMeta>> {
    let file_path = std::path::Path::new(path).join("library.json");
    if !file_path.exists() {
        return Ok(None);
    }
    let raw = tokio::fs::read_to_string(file_path).await?;
    Ok(Some(serde_json::from_str(&raw)?))
}

// ── list_libraries ────────────────────────────────────────────────────────────

/// Return all known libraries from the registry.
#[tauri::command]
pub async fn list_libraries(app: AppHandle) -> Result<Vec<LibraryEntry>, AppError> {
    load_registry(&app)
        .await
        .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })
}

// ── create_library ────────────────────────────────────────────────────────────

/// Create a new library at `path` with the given `name` and `preset`.
/// Initialises a LanceDB database and an empty chunks table at that path,
/// then appends the entry to the registry.
/// Returns the new `LibraryEntry` so the frontend can immediately display it.
#[tauri::command]
pub async fn create_library(
    name:   String,
    path:   String,
    preset: ChunkPreset,
    app:    AppHandle,
) -> Result<LibraryEntry, AppError> {
    // Create the LanceDB directory and empty table to validate the path early.
    // Each library gets its own named subfolder so multiple libraries can
    // share the same parent directory without conflicting.
    let db_path = format!("{}/{}", path.trim_end_matches('/'), name.trim());

    tokio::fs::create_dir_all(&db_path)
        .await
        .map_err(|e| AppError { code: "IO".into(), message: e.to_string() })?;

    let _conn = open_connection(&db_path)
        .await
        .map_err(|e| AppError { code: "LANCEDB".into(), message: e.to_string() })?;
    // Libraries used to default to 1024 dims here, but we now delay table
    // creation until the first ingestion so the dimensions correctly match
    // whichever model the user selects.
    let entry = LibraryEntry {
        id:               Uuid::new_v4().to_string(),
        name,
        path:             db_path.clone(),
        created_at:       Utc::now().to_rfc3339(),
        chunk_count:      0,
        ingested_hashes:  vec![],
        chunk_preset:     preset,
        has_been_ingested: false,
        model_id:          None,
    };

    let mut registry = load_registry(&app)
        .await
        .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;

    registry.push(entry.clone());

    save_registry(&app, &registry)
        .await
        .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;

    // Save metadata to the library folder as well for portability
    save_library_meta(&db_path, &LibraryMeta {
        chunk_preset: entry.chunk_preset.clone(),
        model_id:     entry.model_id.clone(),
    })
    .await
    .map_err(|e| AppError { code: "METADATA".into(), message: e.to_string() })?;

    Ok(entry)
}

// ── open_existing_library ─────────────────────────────────────────────────────

/// Register an existing LanceDB directory as a library without modifying it.
/// Verifies that `chunks.lance` exists at the path, reads the row count, then
/// appends a new `LibraryEntry` to the registry.
#[tauri::command]
pub async fn open_existing_library(
    name:   String,
    path:   String,
    preset: ChunkPreset,
    app:    AppHandle,
) -> Result<LibraryEntry, AppError> {
    let lance_dir = std::path::Path::new(&path).join("chunks.lance");
    if !lance_dir.exists() {
        return Err(AppError {
            code:    "NOT_A_LIBRARY".into(),
            message: format!("No chunks.lance folder found at '{path}'. This does not look like a Matthew library."),
        });
    }

    // Try to load metadata from the folder first to know the dimensions.
    let meta = load_library_meta(&path).await.ok().flatten();
    let recovered_model = meta.as_ref().and_then(|m| m.model_id.clone());
    let dims = recovered_model.as_ref().map(|id| crate::embed::engine::get_model_dims(id)).unwrap_or(1024);

    // Connect read-only style — open_connection opens or creates; since the
    // directory already exists LanceDB will just open it.
    let conn = open_connection(&path)
        .await
        .map_err(|e| AppError { code: "LANCEDB".into(), message: e.to_string() })?;
    let table = ensure_chunks_table(&conn, dims)
        .await
        .map_err(|e| AppError { code: "LANCEDB".into(), message: e.to_string() })?;

    let chunk_count = table
        .count_rows(None)
        .await
        .map_err(|e| AppError { code: "LANCEDB".into(), message: e.to_string() })?;

    // Guard: don't register the same path twice.
    let mut registry = load_registry(&app)
        .await
        .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;

    if registry.iter().any(|l| l.path == path) {
        return Err(AppError {
            code:    "ALREADY_REGISTERED".into(),
            message: "This library is already in your list.".into(),
        });
    }

    let recovered_preset = meta.as_ref().map(|m| m.chunk_preset.clone()).unwrap_or(preset);

    let entry = LibraryEntry {
        id:                Uuid::new_v4().to_string(),
        name,
        path:              path.clone(),
        created_at:        Utc::now().to_rfc3339(),
        chunk_count,
        ingested_hashes:   vec![],  // unknown — dedup will simply re-check on next import
        chunk_preset:      recovered_preset,
        has_been_ingested: chunk_count > 0,
        model_id:          recovered_model,
    };

    registry.push(entry.clone());
    save_registry(&app, &registry)
        .await
        .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;

    Ok(entry)
}

// ── open_library ──────────────────────────────────────────────────────────────

/// Open an existing library by ID — connects to its LanceDB database and
/// sets it as the active library in AppState.
#[tauri::command]
pub async fn open_library(
    id:    String,
    state: State<'_, AppState>,
    app:   AppHandle,
) -> Result<(), AppError> {
    let registry = load_registry(&app)
        .await
        .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;

    let entry = registry
        .iter()
        .find(|l| l.id == id)
        .ok_or(AppError {
            code:    "LIB_NOT_FOUND".into(),
            message: format!("No library with id '{id}' found in registry."),
        })?;

    let conn = open_connection(&entry.path)
        .await
        .map_err(|e| AppError { code: "LANCEDB".into(), message: e.to_string() })?;

    *state.active_db.write().await         = Some(conn);
    *state.active_library_id.write().await = Some(id);

    Ok(())
}

// ── delete_library ────────────────────────────────────────────────────────────

/// Remove a library from the registry and delete its LanceDB directory.
/// If the deleted library is currently active, clears the active state.
#[tauri::command]
pub async fn delete_library(
    id:    String,
    state: State<'_, AppState>,
    app:   AppHandle,
) -> Result<(), AppError> {
    let mut registry = load_registry(&app)
        .await
        .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;

    let pos = registry
        .iter()
        .position(|l| l.id == id)
        .ok_or(AppError {
            code:    "LIB_NOT_FOUND".into(),
            message: format!("No library with id '{id}' found in registry."),
        })?;

    let _entry = registry.remove(pos);

    // Files are intentionally left on disk — only the registry entry is removed.

    // If this was the active library, clear the state.
    let is_active = state
        .active_library_id
        .read()
        .await
        .as_deref()
        == Some(id.as_str());

    if is_active {
        *state.active_db.write().await         = None;
        *state.active_library_id.write().await = None;
    }

    save_registry(&app, &registry)
        .await
        .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;

    Ok(())
}

// ── set_library_preset ────────────────────────────────────────────────────────

/// Update the chunk preset for a library.
/// Only permitted before the first import (enforced via `has_been_ingested`
/// on the frontend; the backend trusts the call).
#[tauri::command]
pub async fn set_library_preset(
    id:     String,
    preset: ChunkPreset,
    app:    AppHandle,
) -> Result<(), AppError> {
    let mut registry = load_registry(&app)
        .await
        .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;

    let (path, meta) = {
        let entry = registry
            .iter_mut()
            .find(|l| l.id == id)
            .ok_or(AppError {
                code:    "LIB_NOT_FOUND".into(),
                message: format!("No library with id '{id}' found in registry."),
            })?;

        entry.chunk_preset = preset;
        (entry.path.clone(), LibraryMeta {
            chunk_preset: entry.chunk_preset.clone(),
            model_id:     entry.model_id.clone(),
        })
    };

    save_registry(&app, &registry)
        .await
        .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;

    // Update metadata on disk
    save_library_meta(&path, &meta)
        .await
        .map_err(|e| AppError { code: "METADATA".into(), message: e.to_string() })?;

    Ok(())
}

// ── set_library_model ────────────────────────────────────────────────────────

/// Update the embedding model ID for a library.
/// Only permitted before the first import.
#[tauri::command]
pub async fn set_library_model(
    id:       String,
    model_id: String,
    app:      AppHandle,
) -> Result<(), AppError> {
    let mut registry = load_registry(&app)
        .await
        .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;

    let (path, meta) = {
        let entry = registry
            .iter_mut()
            .find(|l| l.id == id)
            .ok_or(AppError {
                code:    "LIB_NOT_FOUND".into(),
                message: format!("No library with id '{id}' found in registry."),
            })?;

        if entry.has_been_ingested {
            return Err(AppError {
                code:    "MODEL_LOCKED".into(),
                message: "Model cannot be changed after first import.".into(),
            });
        }

        entry.model_id = Some(model_id);
        (entry.path.clone(), LibraryMeta {
            chunk_preset: entry.chunk_preset.clone(),
            model_id:     entry.model_id.clone(),
        })
    };

    save_registry(&app, &registry)
        .await
        .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;

    // Update metadata on disk
    save_library_meta(&path, &meta)
        .await
        .map_err(|e| AppError { code: "METADATA".into(), message: e.to_string() })?;

    Ok(())
}

// ── list_ingested_files ───────────────────────────────────────────────────────

/// Return a list of distinct source files stored in this library's LanceDB
/// table, each with its chunk count, sorted alphabetically by file name.
/// LanceDB does not support GROUP BY, so we fetch all `file_name` values and
/// aggregate in Rust.
#[tauri::command]
pub async fn list_ingested_files(
    library_id: String,
    app:        AppHandle,
) -> Result<Vec<IngestedFile>, AppError> {
    let registry = load_registry(&app)
        .await
        .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;

    let entry = registry
        .iter()
        .find(|l| l.id == library_id)
        .ok_or(AppError {
            code:    "LIB_NOT_FOUND".into(),
            message: format!("No library with id '{library_id}' found in registry."),
        })?;

    let conn = open_connection(&entry.path)
        .await
        .map_err(|e| AppError { code: "LANCEDB".into(), message: e.to_string() })?;

    let dims = entry.model_id.as_ref()
        .map(|id| crate::embed::engine::get_model_dims(id))
        .unwrap_or(1024);

    let table = ensure_chunks_table(&conn, dims)
        .await
        .map_err(|e| AppError { code: "LANCEDB".into(), message: e.to_string() })?;

    // Collect all batches then aggregate.
    // Split into two steps with explicit error types to resolve inference.
    let stream = table
        .query()
        .select(Select::Columns(vec!["file_name".into()]))
        .execute()
        .await
        .map_err(|e: lancedb::Error| AppError { code: "LANCEDB".into(), message: e.to_string() })?;

    let batches: Vec<RecordBatch> = stream
        .try_collect()
        .await
        .map_err(|e: lancedb::Error| AppError { code: "LANCEDB".into(), message: e.to_string() })?;

    let mut counts: HashMap<String, usize> = HashMap::new();

    for batch in &batches {
        if let Some(col) = batch.column_by_name("file_name") {
            let arr = col.as_string::<i32>();
            for v in arr.iter().flatten() {
                *counts.entry(v.to_string()).or_insert(0) += 1;
            }
        }
    }

    let mut files: Vec<IngestedFile> = counts
        .into_iter()
        .map(|(source_file, chunk_count)| IngestedFile { source_file, chunk_count })
        .collect();

    files.sort_by(|a, b| a.source_file.cmp(&b.source_file));

    Ok(files)
}
