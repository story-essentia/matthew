use serde::Serialize;
use crate::embed::engine::is_bgem3_cached;

// ── SetupStatus ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub model_cached: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,          // "BAAI/bge-m3"
    pub display_name: String, // "BAAI / bge-m3"
    pub description: String,
    pub best_for: String,
    pub size_mb: u32,
    pub dims: u32,
    pub multilingual: bool,
    pub recommended: bool,
    pub is_new: bool,
    pub is_fast: bool,
    pub cached: bool,
}

#[tauri::command]
pub async fn list_embedding_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            id:           "BAAI/bge-m3".into(),
            display_name: "BAAI / bge-m3".into(),
            description:  "Multilingual · 1024 dims".into(),
            best_for:     "Multilingual".into(),
            size_mb:      1200,
            dims:         1024,
            multilingual: true,
            recommended:  true,
            is_new:       false,
            is_fast:      false,
            cached:       crate::embed::engine::is_model_cached("BAAI/bge-m3"),
        },
        ModelInfo {
            id:           "mixedbread-ai/mxbai-embed-large-v1".into(),
            display_name: "mxbai-embed-large-v1".into(),
            description:  "English · 1024 dims".into(),
            best_for:     "Best English quality".into(),
            size_mb:      670,
            dims:         1024,
            multilingual: false,
            recommended:  false,
            is_new:       false,
            is_fast:      false,
            cached:       crate::embed::engine::is_model_cached("mixedbread-ai/mxbai-embed-large-v1"),
        },
        ModelInfo {
            id:           "lightonai/modernbert-embed-large".into(),
            display_name: "modernbert-embed-large".into(),
            description:  "English · 1024 dims".into(),
            best_for:     "Best new English".into(),
            size_mb:      570,
            dims:         1024,
            multilingual: false,
            recommended:  false,
            is_new:       true,
            is_fast:      false,
            cached:       crate::embed::engine::is_model_cached("lightonai/modernbert-embed-large"),
        },
        ModelInfo {
            id:           "Snowflake/snowflake-arctic-embed-l".into(),
            display_name: "arctic-embed-l".into(),
            description:  "English · 1024 dims".into(),
            best_for:     "Strong English".into(),
            size_mb:      670,
            dims:         1024,
            multilingual: false,
            recommended:  false,
            is_new:       false,
            is_fast:      false,
            cached:       crate::embed::engine::is_model_cached("Snowflake/snowflake-arctic-embed-l"),
        },
        ModelInfo {
            id:           "Alibaba-NLP/gte-large-en-v1.5".into(),
            display_name: "gte-large-en-v1.5".into(),
            description:  "English · 1024 dims".into(),
            best_for:     "Strong English alt".into(),
            size_mb:      670,
            dims:         1024,
            multilingual: false,
            recommended:  false,
            is_new:       false,
            is_fast:      false,
            cached:       crate::embed::engine::is_model_cached("Alibaba-NLP/gte-large-en-v1.5"),
        },
        ModelInfo {
            id:           "intfloat/multilingual-e5-large".into(),
            display_name: "multilingual-e5-large".into(),
            description:  "Multilingual · 1024 dims".into(),
            best_for:     "Multi-lingual alt".into(),
            size_mb:      560,
            dims:         1024,
            multilingual: true,
            recommended:  false,
            is_new:       false,
            is_fast:      false,
            cached:       crate::embed::engine::is_model_cached("intfloat/multilingual-e5-large"),
        },
        ModelInfo {
            id:           "nomic-ai/nomic-embed-text-v1.5".into(),
            display_name: "nomic-embed-text-v1.5".into(),
            description:  "English · 768 dims".into(),
            best_for:     "Long context".into(),
            size_mb:      270,
            dims:         768,
            multilingual: false,
            recommended:  false,
            is_new:       false,
            is_fast:      false,
            cached:       crate::embed::engine::is_model_cached("nomic-ai/nomic-embed-text-v1.5"),
        },
        ModelInfo {
            id:           "Snowflake/snowflake-arctic-embed-m".into(),
            display_name: "arctic-embed-m".into(),
            description:  "English · 768 dims".into(),
            best_for:     "Balanced English".into(),
            size_mb:      220,
            dims:         768,
            multilingual: false,
            recommended:  false,
            is_new:       false,
            is_fast:      false,
            cached:       crate::embed::engine::is_model_cached("Snowflake/snowflake-arctic-embed-m"),
        },
        ModelInfo {
            id:           "BAAI/bge-base-en-v1.5".into(),
            display_name: "bge-base-en-v1.5".into(),
            description:  "English · 768 dims".into(),
            best_for:     "Solid baseline".into(),
            size_mb:      210,
            dims:         768,
            multilingual: false,
            recommended:  false,
            is_new:       false,
            is_fast:      false,
            cached:       crate::embed::engine::is_model_cached("BAAI/bge-base-en-v1.5"),
        },
        ModelInfo {
            id:           "sentence-transformers/all-MiniLM-L6-v2".into(),
            display_name: "all-MiniLM-L6-v2".into(),
            description:  "English · 384 dims".into(),
            best_for:     "Lightweight".into(),
            size_mb:      90,
            dims:         384,
            multilingual: false,
            recommended:  false,
            is_new:       false,
            is_fast:      true,
            cached:       crate::embed::engine::is_model_cached("sentence-transformers/all-MiniLM-L6-v2"),
        },
    ]
}

// ── get_setup_status ──────────────────────────────────────────────────────────

/// Check whether the BGE-M3 model is already cached on disk.
#[tauri::command]
pub async fn get_setup_status() -> SetupStatus {
    SetupStatus {
        model_cached: is_bgem3_cached(),
    }
}

// ── initialize_embedding_model ───────────────────────────────────────────

#[tauri::command]
pub async fn initialize_embedding_model(
    model_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), crate::AppError> {
    // Only initialize if already on disk. This prevents auto-download on mount/tab-switch.
    if !crate::embed::engine::is_model_cached(&model_id) {
        return Ok(());
    }
    let model = crate::embed::engine::map_model_id(&model_id)?;
    crate::embed::engine::EmbedEngine::download_model(app, model, state)
        .await
        .map_err(Into::into)
}

// ── download_embedding_model ──────────────────────────────────────────────

#[tauri::command]
pub async fn download_embedding_model(
    model_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), crate::AppError> {
    let model = crate::embed::engine::map_model_id(&model_id)?;
    crate::embed::engine::EmbedEngine::download_model(app, model, state)
        .await
        .map_err(Into::into)
}
