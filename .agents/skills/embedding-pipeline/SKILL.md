---
name: embedding-pipeline
description: Covers fastembed (version 5) and LanceDB (version 0.26) integration for Matthew. Use when writing EmbedEngine, handling first-run model download with progress reporting, generating embeddings with BGE-M3, defining the LanceDB Arrow schema, inserting chunks, building vector indexes, running similarity search, or implementing memory-safe adaptive batch sizing. This skill contains verified API patterns — follow it exactly and do not guess at API shapes.
---

# Embedding Pipeline — fastembed 5 + LanceDB 0.26

## Why Not LanceDB's Built-in Embedding Registry?

LanceDB's Rust SDK embedding registry only supports OpenAI (requires cloud API key + internet).
Local embedding functions are marked "Coming Soon" in the Rust SDK.
Therefore: we call fastembed ourselves and pass vectors to LanceDB manually. This is correct and intentional.

## Confirmed Versions

```toml
fastembed  = "5"       # latest: 5.12.0
lancedb    = "0.26"    # latest: 0.26.2
arrow      = "57"      # must match lancedb's dependency exactly
arrow-array   = "57"
arrow-schema  = "57"
sysinfo    = "0.30"    # for adaptive batch sizing
```

## Multi-Model Support

Matthew supports multiple embedding models via `fastembed-rs`. The system dynamically handles different vector dimensions (384, 768, 1024) based on the library's selected model.

| Model ID | Repository Name (HF) | Dimensions | Search Prefix |
|---|---|---|---|
| `BAAI/bge-m3` | `BAAI/bge-m3` | 1024 | none |
| `mxbai-embed-large-v1` | `mixedbread-ai/mxbai-embed-large-v1` | 1024 | none |
| `nomic-embed-text-v1.5` | `nomic-ai/nomic-embed-text-v1.5` | 768 | `search_query: ` |
| `multilingual-e5-large` | `intfloat/multilingual-e5-large` | 1024 | `query: ` |
| `bge-base-en-v1.5` | `BAAI/bge-base-en-v1.5` | 768 | none |
| `all-MiniLM-L6-v2` | `sentence-transformers/all-MiniLM-L6-v2` | 384 | none |

### Canonical Repository Mapping

`fastembed-rs` requires specific registry strings. `EmbedEngine` handles this mapping:

```rust
fn internal_repo_name(model_id: &str) -> &str {
    match model_id {
        "BAAI/bge-m3" => "BAAI/bge-m3",
        "mxbai-embed-large-v1" => "mixedbread-ai/mxbai-embed-large-v1",
        "nomic-embed-text-v1.5" => "nomic-ai/nomic-embed-text-v1.5",
        "multilingual-e5-large" => "intfloat/multilingual-e5-large",
        "bge-base-en-v1.5" => "BAAI/bge-base-en-v1.5",
        "all-MiniLM-L6-v2" => "sentence-transformers/all-MiniLM-L6-v2",
        _ => model_id,
    }
}
```

### Cache Detection

On-disk folder names are stored in `~/.cache/io.github.story-essentia.matthew/fastembed/` (and formerly `~/.cache/huggingface/hub/`). `is_model_cached` must check for these specific folder patterns:

```rust
pub fn is_model_cached(model_id: &str) -> bool {
    let folder_name = match model_id {
        id if id.contains("snowflake") => id.replace("/", "--").replace("snowflake", "Snowflake"),
        "bge-base-en-v1.5" => "models--Xenova--bge-base-en-v1.5".into(),
        "all-MiniLM-L6-v2" => "models--Qdrant--all-MiniLM-L6-v2".into(),
        "multilingual-e5-large" => "models--intfloat--multilingual-e5-large".into(),
        id => format!("models--{}", id.replace("/", "--")),
    };
    // ... check path exists ...
}
```

## EmbedEngine — Model Hot-Swapping

To prevent dimension mismatches when switching libraries, `EmbedEngine` provides an `ensure_model` method that re-initializes the ONNX runtime if the requested `model_id` differs from the currently loaded one.

```rust
pub struct EmbedEngine {
    pub model: TextEmbedding,
    pub active_model_id: String, // tracks currently loaded model
    pub safe_batch_size: usize,
}

impl EmbedEngine {
    pub async fn ensure_model(&mut self, model_id: &str) -> Result<()> {
        if self.active_model_id == model_id { return Ok(()); }
        
        let new_model = tokio::task::spawn_blocking(move || {
            TextEmbedding::try_new(InitOptions::new(map_model_id(model_id)))
        }).await??;

        self.model = new_model;
        self.active_model_id = model_id.to_string();
        Ok(())
    }

    pub async fn embed_query(&mut self, query: &str, model_id: &str) -> Result<Vec<f32>> {
        self.ensure_model(model_id).await?;
        let prefix = get_model_prefixes(model_id).unwrap_or_default();
        let query_with_prefix = format!("{}{}", prefix, query);
        // ... embed ...
    }
}
```

## LanceDB Schema (Dynamic Dimensions)

The `embedding` field uses `FixedSizeList`, but the dimension size is passed dynamically during table creation, not hardcoded in the schema function.

```rust
pub fn chunks_schema(dims: i32) -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        // ... other fields ...
        Field::new(
            "embedding",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                dims, // passed from model info
            ),
            false,
        ),
    ]))
}
```

### React: First-Run Screen

```tsx
// src/components/FirstRunScreen.tsx
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Download, CheckCircle, AlertCircle } from "lucide-react";

type DownloadStatus = "idle" | "downloading" | "complete" | "error";

export default function FirstRunScreen({ onComplete }: { onComplete: () => void }) {
  const [status, setStatus] = useState<DownloadStatus>("idle");
  const [message, setMessage] = useState("Preparing embedding model…");

  useEffect(() => {
    const unlisten = listen<{ status: string; message: string }>(
      "model:download",
      (event) => {
        const { status, message } = event.payload;
        setStatus(status as DownloadStatus);
        setMessage(message);
        if (status === "complete") {
          // Brief pause so user sees the checkmark, then hand off
          setTimeout(onComplete, 1200);
        }
      }
    );
    return () => { unlisten.then(fn => fn()); };
  }, [onComplete]);

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 gap-8 p-8">
      <div className="flex flex-col items-center gap-3 text-center max-w-sm">

        {status === "complete" ? (
          <CheckCircle size={40} className="text-emerald-500" />
        ) : status === "error" ? (
          <AlertCircle size={40} className="text-rose-500" />
        ) : (
          <Download size={40} className="text-indigo-400 animate-pulse" />
        )}

        <h1 className="text-base font-semibold text-zinc-200">
          {status === "complete" ? "Ready" :
           status === "error"    ? "Download failed" :
           "First-time setup"}
        </h1>

        <p className="text-sm text-zinc-500 leading-relaxed">{message}</p>

        {(status === "idle" || status === "downloading") && (
          <>
            {/* Indeterminate progress bar — fastembed doesn't expose byte-level progress */}
            <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden mt-2">
              <div className="h-full bg-indigo-500 rounded-full animate-[shimmer_1.5s_ease-in-out_infinite] w-1/3" />
            </div>
            <p className="text-xs text-zinc-600">
              The AI model is stored locally and never uploaded anywhere.
              Internet is only needed for this one-time download.
            </p>
          </>
        )}

        {status === "error" && (
          <p className="text-xs text-zinc-600">
            Check your internet connection and restart the app.
          </p>
        )}
      </div>
    </div>
  );
}
```

### App.tsx — Gate Main UI on Model Readiness

```tsx
// src/App.tsx
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Shell from "./components/layout/Shell";
import FirstRunScreen from "./components/FirstRunScreen";

export default function App() {
  const [modelReady, setModelReady] = useState<boolean | null>(null); // null = checking

  useEffect(() => {
    invoke<{ modelCached: boolean }>("get_setup_status").then(({ modelCached }) => {
      setModelReady(modelCached);
    });
  }, []);

  if (modelReady === null) return null; // brief flash while checking

  if (!modelReady) {
    return <FirstRunScreen onComplete={() => setModelReady(true)} />;
  }

  return <Shell />;
}
```

## LanceDB Schema (1024 dimensions — matches BGE-M3)

```rust
// src-tauri/src/db/schema.rs
use arrow_schema::{DataType, Field, Schema};
use std::sync::Arc;

pub fn chunks_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id",           DataType::Utf8,  false),
        Field::new("doc_id",       DataType::Utf8,  false),
        Field::new("source_path",  DataType::Utf8,  false),
        Field::new("file_name",    DataType::Utf8,  false),
        Field::new("page_number",  DataType::Int32, true),
        Field::new("chunk_index",  DataType::Int32, false),
        Field::new("text",         DataType::Utf8,  false),
        Field::new(
            "embedding",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                dims as i32,  // Passed from model info — no longer hardcoded
            ),
            false,
        ),
    ]))
}
```

## LanceDB Connection and Table

```rust
// src-tauri/src/db/store.rs
use lancedb::{connect, query::{ExecutableQuery, QueryBase}, Connection, Table};
use anyhow::Result;

pub async fn open_connection(path: &str) -> Result<Connection> {
    connect(path).execute().await.map_err(Into::into)
}

pub async fn ensure_chunks_table(conn: &Connection) -> Result<Table> {
    let schema = crate::db::schema::chunks_schema();
    match conn.open_table("chunks").execute().await {
        Ok(t) => Ok(t),
        Err(_) => conn.create_empty_table("chunks", schema)
            .execute().await.map_err(Into::into),
    }
}
```

## Inserting Chunks

```rust
// Required imports — ALL of these are needed
use arrow_array::{Array, FixedSizeListArray, Float32Array, Int32Array,
                  RecordBatch, RecordBatchIterator, StringArray};
use lance_arrow::FixedSizeListArrayExt;  // brings try_new_from_values into scope
                                          // Cargo.toml: lance-arrow = "2.0"  ← must be 2.0, not 0.26

pub async fn insert_chunks(table: &Table, chunks: Vec<ChunkRecord>) -> Result<()> {
    if chunks.is_empty() { return Ok(()); }
    let schema = crate::db::schema::chunks_schema();

    let flat: Vec<f32> = chunks.iter().flat_map(|c| c.embedding.iter().copied()).collect();
    let embedding_array = FixedSizeListArray::try_new_from_values(
        Float32Array::from(flat), dims as i32 // dynamic based on model
    )?;

    let batch = RecordBatch::try_new(schema.clone(), vec![
        Arc::new(StringArray::from_iter_values(chunks.iter().map(|c| c.id.as_str()))),
        Arc::new(StringArray::from_iter_values(chunks.iter().map(|c| c.doc_id.as_str()))),
        Arc::new(StringArray::from_iter_values(chunks.iter().map(|c| c.source_path.as_str()))),
        Arc::new(StringArray::from_iter_values(chunks.iter().map(|c| c.file_name.as_str()))),
        Arc::new(Int32Array::from(chunks.iter().map(|c| c.page_number).collect::<Vec<_>>())),
        Arc::new(Int32Array::from(chunks.iter().map(|c| c.chunk_index).collect::<Vec<_>>())),
        Arc::new(StringArray::from_iter_values(chunks.iter().map(|c| c.text.as_str()))),
        Arc::new(embedding_array),
    ])?;

    // Must use RecordBatchIterator — Vec<RecordBatch> does not implement IntoArrow
    let reader = RecordBatchIterator::new(
        vec![batch].into_iter().map(Ok),
        schema,
    );
    table.add(reader).execute().await.map(|_| ()).map_err(Into::into)
}
```

## Vector Index and Search

**CRITICAL: Always check row count before creating an index. LanceDB requires a minimum of 256 rows to build a PQ/IVF index. Calling `create_index` on a table with fewer rows causes a hard error: "Not enough rows to train PQ. Requires 256 rows but only N available." For small libraries, skip index creation — LanceDB will use brute-force search automatically, which is actually faster at small scale.**

```rust
pub async fn create_vector_index(table: &Table) -> Result<()> {
    const MIN_ROWS_FOR_INDEX: usize = 256;
    let row_count = table.count_rows(None).await?;
    if row_count < MIN_ROWS_FOR_INDEX {
        return Ok(()); // brute-force search used automatically for small tables
    }
    table.create_index(&["embedding"], lancedb::index::Index::Auto)
        .execute().await.map_err(Into::into)
}

pub async fn search_chunks(
    table: &Table,
    query_vector: Vec<f32>,
    top_k: usize,
) -> Result<Vec<SearchResult>> {
    use futures::TryStreamExt;
    use arrow_array::cast::AsArray;

    // QueryBase brings .limit(), ExecutableQuery brings .execute()
    // Both must be imported from lancedb::query
    let batches: Vec<RecordBatch> = table
        .vector_search(query_vector)?
        .limit(top_k)
        .execute().await?
        .try_collect().await?;

    let mut results = Vec::new();
    for batch in &batches {
        let texts      = batch.column_by_name("text").unwrap().as_string::<i32>();
        let file_names = batch.column_by_name("file_name").unwrap().as_string::<i32>();
        let pages      = batch.column_by_name("page_number").unwrap()
                              .as_primitive::<arrow_array::types::Int32Type>();
        let indices    = batch.column_by_name("chunk_index").unwrap()
                              .as_primitive::<arrow_array::types::Int32Type>();
        let distances  = batch.column_by_name("_distance").unwrap()
                              .as_primitive::<arrow_array::types::Float32Type>();

        for i in 0..batch.num_rows() {
            results.push(SearchResult {
                text:        texts.value(i).to_string(),
                file_name:   file_names.value(i).to_string(),
                score:       1.0 - distances.value(i),
                // Array trait must be in scope for .is_null() — use arrow_array::Array
                page_number: if pages.is_null(i) { None } else { Some(pages.value(i)) },
                chunk_index: indices.value(i),
            });
        }
    }
    Ok(results)
}
```

## Querying Non-Vector Columns (e.g. list distinct filenames)

LanceDB has no `GROUP BY` support in Rust. Aggregate in Rust after fetching. Always use explicit `lancedb::Error` type annotations on `map_err` closures to avoid inference failures. Always import all three query traits together.

```rust
use lancedb::query::{ExecutableQuery, QueryBase, Select};  // ALL THREE always needed together
use futures::TryStreamExt;
use arrow_array::{cast::AsArray, RecordBatch};
use std::collections::HashMap;

// Split into two bindings — chaining causes type inference failure
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
```

**Key rules:**
- `use lancedb::query::{ExecutableQuery, QueryBase, Select}` — all three needed, forgetting any one causes "method not found" errors
- Split `execute().await` and `try_collect().await` into separate bindings with explicit `e: lancedb::Error` annotations — chaining causes E0282 type inference failures
- `Vec<RecordBatch>` type annotation on the `try_collect` binding is required

## Memory Safety Summary

Batch sizes are lower than the nomic version because BGE-M3 uses 1024-dim vectors (vs 768), meaning each batch consumes ~33% more memory:

| Available RAM | Batch size |
|---|---|
| < 2 GB | 4 |
| 2–4 GB | 8 |
| 4–8 GB | 16 |
| 8–16 GB | 32 |
| > 16 GB | 48 |

Never buffer more than one batch in memory at once. Insert to LanceDB after every batch. Drop embeddings immediately after insert.
