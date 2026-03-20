use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use serde::{Deserialize, Serialize};

use crate::embed::engine::EmbedEngine;

// ── Modules ──────────────────────────────────────────────────────────────────
pub mod commands;
pub mod db;
pub mod embed;
pub mod pdf;

// ── AppState ──────────────────────────────────────────────────────────────────

/// Shared state injected into every Tauri command via `State<'_, AppState>`.
pub struct AppState {
    /// fastembed TextEmbedding is synchronous and NOT Clone.
    /// Wrapped in Arc<Mutex> so only one embed call runs at a time.
    pub embed_engine: Arc<Mutex<EmbedEngine>>,

    /// Active LanceDB connection. None = no library open.
    pub active_db: Arc<RwLock<Option<lancedb::Connection>>>,

    /// ID of the currently open library. None = no library selected.
    pub active_library_id: Arc<RwLock<Option<String>>>,
}

// ── AppError ──────────────────────────────────────────────────────────────────

/// Single error type returned by all Tauri commands.
/// Tauri serialises the `Err` variant to JSON automatically; the frontend
/// receives it as a thrown JS exception from `invoke()`.
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

// ── ChunkPreset ───────────────────────────────────────────────────────────────

/// Per-library chunking strategy, locked after the first import.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ChunkPreset {
    Precise,
    Balanced,
    Contextual,
}

impl ChunkPreset {
    pub fn chunk_chars(&self) -> usize {
        match self {
            Self::Precise    => 512,
            Self::Balanced   => 2048,
            Self::Contextual => 4096,
        }
    }

    pub fn overlap_chars(&self) -> usize {
        match self {
            Self::Precise    => 100,
            Self::Balanced   => 400,
            Self::Contextual => 800,
        }
    }
}

// ── LibraryEntry ──────────────────────────────────────────────────────────────

/// A single row in the library registry (persisted to libraries.json).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub chunk_count: usize,
    pub ingested_hashes: Vec<String>, // SHA-256 of each ingested PDF (dedup)
    pub chunk_preset: ChunkPreset,
    pub has_been_ingested: bool,
    #[serde(default)]
    pub model_id: Option<String>,
}

// ── Retrieval top-K constants ─────────────────────────────────────────────────

pub const TOPK_FOCUSED:  usize = 5;
pub const TOPK_STANDARD: usize = 10; // default
pub const TOPK_BROAD:    usize = 20;

pub const TOPK_MAX_SEARCH: usize = 100;
pub const TOPK_MAX_CHAT:   usize = 50;  // LLM context window constraint

/// Show a quality warning in the UI when chat top-K exceeds this value.
pub const TOPK_CHAT_WARN:  usize = 10;
