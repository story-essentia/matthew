---
name: pdf-ingestion
description: Covers PDF text extraction and the memory-safe streaming ingestion pipeline for Matthew. Use when writing the ingest_pdfs Tauri command, parsing PDFs with pdf-extract, applying chunk size presets (precise/balanced/contextual), enforcing per-library chunk size locking, deduplicating files by SHA-256, reporting detailed per-file and per-chunk progress to the frontend, or handling multi-file and folder ingestion. The pipeline emits rich progress events so the UI can show exactly what is happening at every stage.
---

# PDF Ingestion — Memory-Safe Streaming Pipeline

## Crate Choice: pdf-extract (MIT)

```toml
pdf-extract = "0.7"
sha2        = "0.10"
```

Pure Rust, zero native dependencies, MIT license, identical on all platforms.

**Limitations (PDF format — not fixable by any library):**
- Tables: left-to-right text extraction. Fine for RAG.
- Embedded images in text PDFs: ignored.
- Scanned PDFs (no text layer): empty string per page — detected and reported.

## Library Settings (Locked after first import)

Both **chunk size preset** and **embedding model** are per-library settings, chosen by the user before their first import. After the first import, these are **locked** — `LibraryEntry.has_been_ingested` becomes `true` and they cannot be changed. This ensures consistency within the vector database.

The constants are defined on `ChunkPreset` and `EmbeddingModel` in `lib.rs`:

```rust
// In ingest_pdfs: read from the active library's entry
let model_id      = lib_entry.model_id.as_str(); // e.g. "BAAI/bge-m3"
let chunk_chars   = lib_entry.chunk_preset.chunk_chars();
let overlap_chars = lib_entry.chunk_preset.overlap_chars();
```

**Never hardcode chunk sizes or model IDs in the pipeline.** Always read from the active library's entry.

## Core Memory Rule

Process one PDF at a time. Embed one batch at a time. Write immediately. Drop immediately.

Peak memory: model weights (~500MB) + one batch (`safe_batch_size × ~5KB`).

## pdf-extract API

```rust
// Full text of PDF. Pages separated by '\x0C' (form feed, ASCII 12).
let text: String = pdf_extract::extract_text(path)?;
let pages: Vec<&str> = text.split('\x0C').collect();
```

## PdfExtractor

```rust
// src-tauri/src/pdf/extractor.rs
use anyhow::Result;

pub struct PdfExtractor;

pub struct PageResult {
    pub page_number: i32,
    pub text: Option<String>, // None = image-only or blank
}

impl PdfExtractor {
    pub fn new() -> Self { Self }

    pub fn extract_pages(&self, path: &str) -> Result<Vec<PageResult>> {
        let full_text = pdf_extract::extract_text(path)
            .map_err(|e| anyhow::anyhow!("PDF parse error in '{}': {}", path, e))?;

        Ok(full_text
            .split('\x0C')
            .enumerate()
            .map(|(idx, raw)| {
                let cleaned = clean_text(raw);
                PageResult {
                    page_number: idx as i32 + 1,
                    text: if cleaned.len() >= MIN_CHUNK_CHARS { Some(cleaned) } else { None },
                }
            })
            .collect())
    }
}

const MIN_CHUNK_CHARS: usize = 50;

fn clean_text(raw: &str) -> String {
    raw.replace('\r', "\n")
        .split('\n')
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
```

## Chunking (Preset-Driven)

```rust
// src-tauri/src/pdf/extractor.rs (continued)

pub struct RawChunk {
    pub text: String,
    pub page_number: i32,
    pub chunk_index: i32,
}

/// chunk_chars and overlap_chars come from ChunkPreset — never hardcoded.
pub fn chunk_page_text(
    text: &str,
    page_number: i32,
    doc_chunk_offset: i32,
    chunk_chars: usize,
    overlap_chars: usize,
) -> Vec<RawChunk> {
    let chars: Vec<char> = text.chars().collect();
    let mut chunks = Vec::new();
    let mut start = 0usize;
    let mut local_idx = 0i32;

    while start < chars.len() {
        let end = (start + chunk_chars).min(chars.len());
        let trimmed = chars[start..end].iter().collect::<String>()
            .trim().to_string();

        if trimmed.len() >= MIN_CHUNK_CHARS {
            chunks.push(RawChunk {
                text: trimmed,
                page_number,
                chunk_index: doc_chunk_offset + local_idx,
            });
            local_idx += 1;
        }
        if end == chars.len() { break; }
        start += chunk_chars - overlap_chars;
    }
    chunks
}
```

## SHA-256 Deduplication

```rust
use sha2::{Digest, Sha256};
use std::io::Read;

pub fn file_sha256(path: &str) -> anyhow::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
```

## IngestProgress Event

```rust
#[derive(Clone, Serialize)]
pub struct IngestProgress {
    // File-level
    pub current_file: usize,
    pub total_files: usize,
    pub file_name: String,
    // Phase
    pub phase: IngestPhase,
    // Within-file chunk progress
    pub file_chunks_done: usize,
    pub file_chunks_total: usize,
    // Running totals
    pub total_chunks_added: usize,
    pub total_files_skipped: usize,
    // Page info
    pub pages_extracted: usize,
    pub image_only_pages: usize,
    // Error (phase == Error only)
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IngestPhase {
    Parsing,
    Chunking,
    Embedding,
    Storing,
    Skipped,   // duplicate
    Done,
    Error,     // per-file — pipeline continues to next file
}
```

## Full ingest_pdfs Command

```rust
// src-tauri/src/commands/ingest.rs
#[tauri::command]
pub async fn ingest_pdfs(
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<usize, AppError> {

    // 1. Guard: library must be open
    let conn = {
        let db = state.active_db.read().await;
        db.clone().ok_or(AppError {
            code: "DB_NOT_OPEN".into(),
            message: "Open a library in the Libraries tab first.".into(),
        })?
    };

    //     let table = ensure_chunks_table(&conn).await?; (MOVED DOWN)
    let extractor = PdfExtractor::new();
    let total_files = paths.len();
    let mut total_chunks_added = 0usize;
    let mut total_files_skipped = 0usize;

    let mut registry = load_registry(&app).await
        .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;

    // 2. Find the active library entry — needed for preset and hash list
    let active_id = state.active_library_id.read().await.clone()
        .ok_or(AppError { code: "DB_NOT_OPEN".into(), message: "No active library.".into() })?;

    let lib_entry = registry.iter_mut()
        .find(|l| l.id == active_id)
        .ok_or(AppError { code: "LIB_NOT_FOUND".into(), message: "Library not in registry.".into() })?;

    // 3. Read chunk settings from the library's preset — never hardcode
    let chunk_chars   = lib_entry.chunk_preset.chunk_chars();
    let overlap_chars = lib_entry.chunk_preset.overlap_chars();

    // 4. Ensure model is loaded and get dimensions/batch size
    let (dims, batch_size) = {
        let mut engine = state.embed_engine.lock().await;
        // Synchronously ensure model is loaded to get correct dims
        tokio::task::block_in_place(|| engine.ensure_model(&lib_entry.model_id))
            .map_err(|e| AppError { code: "EMBED".into(), message: e.to_string() })?;
        
        (engine.dims(), engine.safe_batch_size)
    };

    let table = ensure_chunks_table(&conn, dims).await?;

    let emit = |p: IngestProgress| { app.emit("ingest:progress", p).ok(); };

    for (file_idx, path) in paths.iter().enumerate() {
        let file_name = std::path::Path::new(path)
            .file_name().unwrap_or_default()
            .to_string_lossy().to_string();

        let base = IngestProgress {
            current_file: file_idx + 1, total_files,
            file_name: file_name.clone(),
            phase: IngestPhase::Parsing,
            file_chunks_done: 0, file_chunks_total: 0,
            total_chunks_added, total_files_skipped,
            pages_extracted: 0, image_only_pages: 0,
            error: None,
        };

        // Deduplication
        let hash = file_sha256(path)
            .map_err(|e| AppError { code: "HASH".into(), message: e.to_string() })?;

        if lib_entry.ingested_hashes.contains(&hash) {
            total_files_skipped += 1;
            emit(IngestProgress { phase: IngestPhase::Skipped, total_files_skipped, ..base.clone() });
            continue;
        }

        // Parse
        emit(IngestProgress { phase: IngestPhase::Parsing, ..base.clone() });

        let pages = match extractor.extract_pages(path) {
            Ok(p) => p,
            Err(e) => {
                emit(IngestProgress { phase: IngestPhase::Error, error: Some(e.to_string()), ..base.clone() });
                continue;
            }
        };

        let pages_extracted   = pages.iter().filter(|p| p.text.is_some()).count();
        let image_only_pages  = pages.iter().filter(|p| p.text.is_none()).count();

        // Chunk using preset values
        emit(IngestProgress { phase: IngestPhase::Chunking, pages_extracted, image_only_pages, ..base.clone() });

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

        // Embed + store in memory-safe batches
        for chunk_batch in raw_chunks.chunks(batch_size) {
            let texts: Vec<String> = chunk_batch.iter().map(|c| c.text.clone()).collect();

            emit(IngestProgress {
                phase: IngestPhase::Embedding,
                file_chunks_done, file_chunks_total,
                pages_extracted, image_only_pages, total_chunks_added, total_files_skipped,
                ..base.clone()
            });

            let embeddings = {
                let engine = state.embed_engine.lock().await;
                let t = texts;
                tokio::task::spawn_blocking(move || engine.embed_batch(t))
                    .await
                    .map_err(|e| AppError { code: "THREAD".into(), message: e.to_string() })??
            };

            emit(IngestProgress {
                phase: IngestPhase::Storing,
                file_chunks_done, file_chunks_total,
                pages_extracted, image_only_pages, total_chunks_added, total_files_skipped,
                ..base.clone()
            });

            let records: Vec<ChunkRecord> = chunk_batch.iter().zip(embeddings)
                .map(|(raw, embedding)| ChunkRecord {
                    id: Uuid::new_v4().to_string(),
                    doc_id: doc_id.clone(),
                    source_path: path.clone(),
                    file_name: file_name.clone(),
                    page_number: raw.page_number,
                    chunk_index: raw.chunk_index,
                    text: raw.text.clone(),
                    embedding,
                })
                .collect();

            let n = records.len();
            insert_chunks(&table, records).await?;
            file_chunks_done += n;
            total_chunks_added += n;
            // records and embeddings dropped here
        }
        // raw_chunks dropped here

        // Record hash + mark library as ingested (locks preset)
        lib_entry.ingested_hashes.push(hash);
        lib_entry.chunk_count += file_chunks_done;
        lib_entry.has_been_ingested = true;  // preset is now locked

        save_registry(&app, &registry).await
            .map_err(|e| AppError { code: "REGISTRY".into(), message: e.to_string() })?;
    }

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
```

## Folder Support

```rust
#[tauri::command]
pub async fn list_pdfs_in_folder(folder_path: String) -> Result<Vec<String>, AppError> {
    let mut pdf_paths = Vec::new();
    let mut stack = vec![std::path::PathBuf::from(&folder_path)];
    while let Some(dir) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&dir).await
            .map_err(|e| AppError { code: "IO".into(), message: e.to_string() })?;
        while let Some(entry) = entries.next_entry().await
            .map_err(|e| AppError { code: "IO".into(), message: e.to_string() })?
        {
            let p = entry.path();
            if p.is_dir() { stack.push(p); }
            else if p.extension().map(|e| e == "pdf").unwrap_or(false) {
                pdf_paths.push(p.to_string_lossy().to_string());
            }
        }
    }
    Ok(pdf_paths)
}
```

## What the Frontend Shows Per Phase

| Phase | Primary label | Secondary detail |
|---|---|---|
| `parsing` | "Reading PDF…" | filename |
| `chunking` | "Splitting into chunks…" | "N pages extracted" |
| `embedding` | "Generating embeddings…" | chunk progress bar: `done / total` |
| `storing` | "Saving to database…" | chunk progress bar: `done / total` |
| `skipped` | "Already ingested" | greyed row |
| `done` | "Complete" | "N chunks from M files" |
| `error` | error message | red row, continues to next file |

See `frontend-ui` skill for the React components that consume these events.
