use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    AppError, AppState,
    db::store::{ensure_chunks_table, insert_chunks, create_vector_index, ChunkRecord},
    pdf::extractor::{chunk_page_text, file_sha256, PdfExtractor},
    commands::libraries::{load_registry, save_registry},
};

// ── IngestProgress event ──────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IngestPhase {
    Parsing,
    Chunking,
    Embedding,
    Storing,
    Skipped,  // duplicate detected via SHA-256
    Done,
    Error,    // per-file error — pipeline continues to next file
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestProgress {
    pub current_file:        usize,
    pub total_files:         usize,
    pub file_name:           String,
    pub phase:               IngestPhase,
    pub file_chunks_done:    usize,
    pub file_chunks_total:   usize,
    pub total_chunks_added:  usize,
    pub total_files_skipped: usize,
    pub pages_extracted:     usize,
    pub image_only_pages:    usize,
    pub error:               Option<String>, // Some only when phase == Error
}

// ── ingest_pdfs ───────────────────────────────────────────────────────────────

/// Stream-ingest a list of PDF paths into the active LanceDB library.
/// Emits `"ingest:progress"` events throughout so the frontend can show a
/// detailed live progress display.
#[tauri::command]
pub async fn ingest_pdfs(
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<usize, AppError> {
    // ── 1. Guard: a library must be open ─────────────────────────────────────
    let conn = {
        let db = state.active_db.read().await;
        db.clone().ok_or(AppError {
            code:    "DB_NOT_OPEN".into(),
            message: "Open a library in the Libraries tab first.".into(),
        })?
    };

    let (batch_size, dims) = {
        let engine = state.embed_engine.lock().await;
        (engine.safe_batch_size.max(1), engine.dims())
    };

    let table = ensure_chunks_table(&conn, dims).await?;
    let extractor = PdfExtractor::new();
    let total_files = paths.len();
    let mut total_chunks_added   = 0usize;
    let mut total_files_skipped  = 0usize;

    let mut registry = load_registry(&app)
        .await
        .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;

    // ── 2. Identify the active library and read its preset settings ──────────
    let active_id = state.active_library_id.read().await.clone()
        .ok_or(AppError {
            code:    "DB_NOT_OPEN".into(),
            message: "No active library.".into(),
        })?;

    // Read chunk settings in a short scope — borrow of registry ends here.
    let (chunk_chars, overlap_chars, active_model_id) = {
        let entry = registry.iter()
            .find(|l| l.id == active_id)
            .ok_or(AppError {
                code:    "LIB_NOT_FOUND".into(),
                message: "Active library not found in registry.".into(),
            })?;
        (
            entry.chunk_preset.chunk_chars(),
            entry.chunk_preset.overlap_chars(),
            entry.model_id.clone().unwrap_or_else(|| "BAAI/bge-m3".into())
        )
    };


    let emit = |p: IngestProgress| { app.emit("ingest:progress", p).ok(); };

    // ── 5. Per-file loop ──────────────────────────────────────────────────────
    for (file_idx, path) in paths.iter().enumerate() {
        let file_name = std::path::Path::new(path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let base = IngestProgress {
            current_file: file_idx + 1, total_files,
            file_name: file_name.clone(),
            phase: IngestPhase::Parsing,
            file_chunks_done: 0, file_chunks_total: 0,
            total_chunks_added, total_files_skipped,
            pages_extracted: 0, image_only_pages: 0,
            error: None,
        };

        // Deduplication via SHA-256
        let hash = match file_sha256(path) {
            Ok(h) => h,
            Err(e) => {
                emit(IngestProgress {
                    phase: IngestPhase::Error,
                    error: Some(format!("Could not hash file: {e}")),
                    ..base.clone()
                });
                continue;
            }
        };

        // Short borrow to check the hash list — dropped before any mutation.
        let already_ingested = {
            registry.iter()
                .find(|l| l.id == active_id)
                .map(|l| l.ingested_hashes.contains(&hash))
                .unwrap_or(false)
        };
        if already_ingested {
            total_files_skipped += 1;
            emit(IngestProgress {
                phase: IngestPhase::Skipped,
                total_files_skipped,
                ..base.clone()
            });
            continue;
        }

        // Parse
        emit(IngestProgress { phase: IngestPhase::Parsing, ..base.clone() });

        let pages = match extractor.extract_pages(path) {
            Ok(p)  => p,
            Err(e) => {
                emit(IngestProgress {
                    phase: IngestPhase::Error,
                    error: Some(e.to_string()),
                    ..base.clone()
                });
                continue;
            }
        };

        let pages_extracted  = pages.iter().filter(|p| p.text.is_some()).count();
        let image_only_pages = pages.iter().filter(|p| p.text.is_none()).count();

        // Chunk using preset values
        emit(IngestProgress {
            phase: IngestPhase::Chunking, pages_extracted, image_only_pages,
            ..base.clone()
        });

        let doc_id = Uuid::new_v4().to_string();
        let mut raw_chunks = Vec::new();
        for page in &pages {
            if let Some(text) = &page.text {
                let offset = raw_chunks.len() as i32;
                raw_chunks.extend(chunk_page_text(text, page.page_number, offset, chunk_chars, overlap_chars));
            }
        }

        if raw_chunks.is_empty() {
            emit(IngestProgress {
                phase: IngestPhase::Error,
                pages_extracted, image_only_pages,
                error: Some(if image_only_pages > 0 {
                    "No extractable text — this PDF may be a scanned document.".into()
                } else {
                    "No text content found in this PDF.".into()
                }),
                ..base.clone()
            });
            continue;
        }

        let file_chunks_total = raw_chunks.len();
        let mut file_chunks_done = 0usize;

        // Embed + store one batch at a time (memory-safe)
        for chunk_batch in raw_chunks.chunks(batch_size) {
            let texts: Vec<String> = chunk_batch.iter().map(|c| c.text.clone()).collect();

            emit(IngestProgress {
                phase: IngestPhase::Embedding,
                file_chunks_done, file_chunks_total,
                pages_extracted, image_only_pages,
                total_chunks_added, total_files_skipped,
                ..base.clone()
            });

            // Acquire lock, run the synchronous embed on the current thread via
            // block_in_place (avoids moving the MutexGuard into spawn_blocking).
            let embeddings = {
                let mut engine = state.embed_engine.lock().await;
                tokio::task::block_in_place(|| engine.embed_batch(&active_model_id, texts))
                    .map_err(|e| AppError { code: "EMBED".into(), message: e.to_string() })?
            };

            emit(IngestProgress {
                phase: IngestPhase::Storing,
                file_chunks_done, file_chunks_total,
                pages_extracted, image_only_pages,
                total_chunks_added, total_files_skipped,
                ..base.clone()
            });

            let records: Vec<ChunkRecord> = chunk_batch
                .iter()
                .zip(embeddings)
                .map(|(raw, embedding)| ChunkRecord {
                    id:          Uuid::new_v4().to_string(),
                    doc_id:      doc_id.clone(),
                    source_path: path.clone(),
                    file_name:   file_name.clone(),
                    page_number: Some(raw.page_number),
                    chunk_index: raw.chunk_index,
                    text:        raw.text.clone(),
                    embedding,
                })
                .collect();

            let n = records.len();
            insert_chunks(&table, records, dims).await?;
            file_chunks_done    += n;
            total_chunks_added  += n;
            // records and embeddings are dropped here
        }
        // raw_chunks dropped here

        {
            if let Some(entry) = registry.iter_mut().find(|l| l.id == active_id) {
                entry.ingested_hashes.push(hash);
                entry.chunk_count      += file_chunks_done;
                entry.has_been_ingested = true;

                // Ensure the model ID is locked into the registry if this was the first import.
                if entry.model_id.is_none() {
                    entry.model_id = Some(active_model_id.clone());
                }
            }
        }

        save_registry(&app, &registry)
            .await
            .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;
    }

    // Rebuild the vector index after all files are stored
    create_vector_index(&table).await?;

    emit(IngestProgress {
        current_file: total_files, total_files,
        file_name: String::new(),
        phase: IngestPhase::Done,
        file_chunks_done: 0, file_chunks_total: 0,
        total_chunks_added, total_files_skipped,
        pages_extracted: 0, image_only_pages: 0,
        error: None,
    });

    Ok(total_chunks_added)
}

// ── list_pdfs_in_folder ───────────────────────────────────────────────────────

/// Recursively find all .pdf files under a folder.
/// Returns their absolute paths as strings.
#[tauri::command]
pub async fn list_pdfs_in_folder(folder_path: String) -> Result<Vec<String>, AppError> {
    let mut pdf_paths = Vec::new();
    let mut stack     = vec![std::path::PathBuf::from(&folder_path)];

    while let Some(dir) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&dir)
            .await
            .map_err(|e| AppError { code: "IO".into(), message: e.to_string() })?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| AppError { code: "IO".into(), message: e.to_string() })?
        {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().map(|e| e.eq_ignore_ascii_case("pdf")).unwrap_or(false) {
                pdf_paths.push(p.to_string_lossy().to_string());
            }
        }
    }

    Ok(pdf_paths)
}
