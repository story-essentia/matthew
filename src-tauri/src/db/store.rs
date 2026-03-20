use std::sync::Arc;

use anyhow::Result;
use arrow_array::{
    builder::Int32Builder,
    cast::AsArray, Array, FixedSizeListArray, Float32Array, Int32Array,
    RecordBatch, RecordBatchIterator, StringArray,
};
use futures::TryStreamExt;
use lance_arrow::FixedSizeListArrayExt;
use lancedb::{connect, query::{ExecutableQuery, QueryBase}, Connection, Table};
use serde::{Deserialize, Serialize};

// ── Public data types ─────────────────────────────────────────────────────────

/// One chunk row to be inserted into LanceDB.
#[derive(Debug, Clone)]
pub struct ChunkRecord {
    pub id:          String,
    pub doc_id:      String,
    pub source_path: String,
    pub file_name:   String,
    pub page_number: Option<i32>,
    pub chunk_index: i32,
    pub text:        String,
    pub embedding:   Vec<f32>, // must be exactly 1024 elements
}

/// One result row returned by vector search, serialised to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub text:        String,
    pub file_name:   String,
    pub page_number: Option<i32>,
    pub chunk_index: i32,
    pub score:       f32, // 1.0 - cosine_distance (higher = more similar)
}

// ── Connection ────────────────────────────────────────────────────────────────

/// Open (or create) a LanceDB database at the given filesystem path.
/// Each library has its own LanceDB directory.
pub async fn open_connection(path: &str) -> Result<Connection> {
    connect(path).execute().await.map_err(Into::into)
}

// ── Table ─────────────────────────────────────────────────────────────────────

/// Open the "chunks" table, creating it with the correct Arrow schema if absent.
pub async fn ensure_chunks_table(conn: &Connection, dims: usize) -> Result<Table> {
    let schema = crate::db::schema::chunks_schema(dims);
    match conn.open_table("chunks").execute().await {
        Ok(table) => Ok(table),
        Err(_) => conn
            .create_empty_table("chunks", schema)
            .execute()
            .await
            .map_err(Into::into),
    }
}

// ── Insert ────────────────────────────────────────────────────────────────────

/// Append a batch of chunk records to the "chunks" table.
pub async fn insert_chunks(table: &Table, chunks: Vec<ChunkRecord>, dims: usize) -> Result<()> {
    if chunks.is_empty() {
        return Ok(());
    }
    let schema = crate::db::schema::chunks_schema(dims);
    // Flatten all embedding vectors into a single f32 buffer for Arrow.
    let flat: Vec<f32> = chunks
        .iter()
        .flat_map(|c| c.embedding.iter().copied())
        .collect();

    let embedding_array =
        FixedSizeListArray::try_new_from_values(Float32Array::from(flat), dims as i32)?;

    // Build a nullable page_number column using Int32Builder so that
    // Arrow's null bitmap is written explicitly for None values.
    let mut page_builder = Int32Builder::new();
    for c in &chunks {
        match c.page_number {
            Some(p) => page_builder.append_value(p),
            None    => page_builder.append_null(),
        }
    }
    let page_array = Arc::new(page_builder.finish());

    let batch = RecordBatch::try_new(
        schema,
        vec![
            Arc::new(StringArray::from_iter_values(chunks.iter().map(|c| c.id.as_str()))),
            Arc::new(StringArray::from_iter_values(chunks.iter().map(|c| c.doc_id.as_str()))),
            Arc::new(StringArray::from_iter_values(
                chunks.iter().map(|c| c.source_path.as_str()),
            )),
            Arc::new(StringArray::from_iter_values(
                chunks.iter().map(|c| c.file_name.as_str()),
            )),
            page_array,
            Arc::new(Int32Array::from(
                chunks.iter().map(|c| c.chunk_index).collect::<Vec<_>>(),
            )),
            Arc::new(StringArray::from_iter_values(chunks.iter().map(|c| c.text.as_str()))),
            Arc::new(embedding_array),
        ],
    )?;

    let reader = RecordBatchIterator::new(
        vec![batch].into_iter().map(Ok),
        crate::db::schema::chunks_schema(dims),
    );
    table.add(reader).execute().await.map(|_| ()).map_err(Into::into)
}

// ── Index ─────────────────────────────────────────────────────────────────────

/// Build (or rebuild) the ANN vector index on the "embedding" column.
/// Call this once after inserting chunks.
/// Skipped silently when the table has fewer than 256 rows — LanceDB uses
/// brute-force search automatically for small tables and will error if asked
/// to build an ANN index on too few vectors.
pub async fn create_vector_index(table: &Table) -> Result<()> {
    const MIN_ROWS_FOR_INDEX: usize = 256;

    let row_count = table.count_rows(None).await?;
    if row_count < MIN_ROWS_FOR_INDEX {
        return Ok(());
    }

    table
        .create_index(
            &["embedding"],
            lancedb::index::Index::IvfPq(
                lancedb::index::vector::IvfPqIndexBuilder::default()
                    .distance_type(lancedb::DistanceType::Cosine),
            ),
        )
        .execute()
        .await
        .map_err(Into::into)
}

// ── Search ────────────────────────────────────────────────────────────────────

/// Run approximate nearest-neighbour search against the "embedding" column.
/// Returns up to `top_k` results, sorted by descending similarity score.
/// The caller is responsible for clamping `top_k` to TOPK_MAX_* before calling.
pub async fn search_chunks(
    table: &Table,
    query_vector: Vec<f32>,
    top_k: usize,
) -> Result<Vec<SearchResult>> {
    let batches: Vec<RecordBatch> = table
        .vector_search(query_vector)?
        .distance_type(lancedb::DistanceType::Cosine)
        .limit(top_k)
        .execute()
        .await?
        .try_collect()
        .await?;

    let mut results = Vec::new();

    for batch in &batches {
        let texts      = batch.column_by_name("text").unwrap().as_string::<i32>();
        let file_names = batch.column_by_name("file_name").unwrap().as_string::<i32>();
        let pages      = batch
            .column_by_name("page_number")
            .unwrap()
            .as_primitive::<arrow_array::types::Int32Type>();
        let indices    = batch
            .column_by_name("chunk_index")
            .unwrap()
            .as_primitive::<arrow_array::types::Int32Type>();
        let distances  = batch
            .column_by_name("_distance")
            .unwrap()
            .as_primitive::<arrow_array::types::Float32Type>();

        for i in 0..batch.num_rows() {
            results.push(SearchResult {
                text:        texts.value(i).to_string(),
                file_name:   file_names.value(i).to_string(),
                score:       1.0 - distances.value(i) / 2.0, // cosine distance [0,2] → similarity [0,1]
                page_number: if pages.is_null(i) { None } else { Some(pages.value(i)) },
                chunk_index: indices.value(i),
            });
        }
    }

    Ok(results)
}
