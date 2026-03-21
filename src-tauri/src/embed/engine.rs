use anyhow::Result;
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use serde::Serialize;
use sysinfo::System;
use tauri::{AppHandle, Emitter};

// ── Download progress event ───────────────────────────────────────────────────

/// Emitted on the "model:download" channel so the frontend can show a progress UI.
#[derive(Clone, Serialize)]
pub struct ModelDownloadEvent {
    pub status:  String, // "downloading" | "complete" | "error"
    pub message: String, // human-readable, shown in the FirstRunScreen
}

// ── Cache detection ───────────────────────────────────────────────────────────

/// Returns the vector dimension for a given model ID.
pub fn get_model_dims(model_id: &str) -> usize {
    match model_id {
        "BAAI/bge-m3"                           |
        "mixedbread-ai/mxbai-embed-large-v1"    |
        "lightonai/modernbert-embed-large"       |
        "Alibaba-NLP/gte-large-en-v1.5"         |
        "intfloat/multilingual-e5-large"         |
        "Snowflake/snowflake-arctic-embed-l"     => 1024,

        "nomic-ai/nomic-embed-text-v1.5"         |
        "BAAI/bge-base-en-v1.5"                 |
        "Snowflake/snowflake-arctic-embed-m"     |
        "Snowflake/snowflake-arctic-embed-m-long" => 768,

        "Snowflake/snowflake-arctic-embed-s"     |
        "Snowflake/snowflake-arctic-embed-xs"    |
        "sentence-transformers/all-MiniLM-L6-v2" => 384,

        _ => 1024,
    }
}

/// Returns the internal HuggingFace repository name for a given model ID.
pub fn internal_repo_name(model_id: &str) -> &str {
    match model_id {
        // Use canonical fastembed-rs 5.x strings for HF repo paths
        "BAAI/bge-m3"                           => "BAAI/bge-m3",
        "mixedbread-ai/mxbai-embed-large-v1"    => "mixedbread-ai/mxbai-embed-large-v1",
        "lightonai/modernbert-embed-large"       => "lightonai/modernbert-embed-large",
        "Alibaba-NLP/gte-large-en-v1.5"         => "Alibaba-NLP/gte-large-en-v1.5",
        "nomic-ai/nomic-embed-text-v1.5"         => "nomic-ai/nomic-embed-text-v1.5",

        // Snowflake Arctic (Canonical is Snowflake/...)
        "Snowflake/snowflake-arctic-embed-m"     |
        "snowflake/snowflake-arctic-embed-m"     => "Snowflake/snowflake-arctic-embed-m",

        "Snowflake/snowflake-arctic-embed-l"     |
        "snowflake/snowflake-arctic-embed-l"     => "Snowflake/snowflake-arctic-embed-l",

        "Snowflake/snowflake-arctic-embed-s"     |
        "snowflake/snowflake-arctic-embed-s"     => "Snowflake/snowflake-arctic-embed-s",

        "Snowflake/snowflake-arctic-embed-xs"    |
        "snowflake/snowflake-arctic-embed-xs"    => "Snowflake/snowflake-arctic-embed-xs",

        "Snowflake/snowflake-arctic-embed-m-long" |
        "snowflake/snowflake-arctic-embed-m-long" => "Snowflake/snowflake-arctic-embed-m-long",

        // BGE Base (Canonical for fastembed-rs v5 is Xenova/...)
        "BAAI/bge-base-en-v1.5"                 |
        "Xenova/bge-base-en-v1.5"               => "Xenova/bge-base-en-v1.5",

        // AllMiniLM (Official for fastembed-rs v5 is Qdrant/...)
        "sentence-transformers/all-MiniLM-L6-v2" |
        "Qdrant/all-MiniLM-L6-v2-onnx"          => "Qdrant/all-MiniLM-L6-v2-onnx",

        // Multilingual E5 (Official for fastembed-rs v5 is Qdrant/...)
        "intfloat/multilingual-e5-large"         |
        "Qdrant/multilingual-e5-large-onnx"     => "Qdrant/multilingual-e5-large-onnx",

        _ => model_id,
    }
}

/// Returns (query_prefix, passage_prefix) if applicable for the model.
pub fn get_model_prefixes(model_id: &str) -> (Option<&str>, Option<&str>) {
    let internal = internal_repo_name(model_id);
    
    // Snowflake and Nomic v1.5 models
    if internal.to_lowercase().contains("snowflake-arctic-embed") || 
       internal.contains("nomic-ai/nomic-embed-text-v1.5") 
    {
        return (Some("Represent as search_query: "), Some("Represent as search_document: "));
    }
    
    // BGE and E5 models
    if internal.to_lowercase().contains("bge-") || 
       internal.to_lowercase().contains("multilingual-e5") ||
       internal.to_lowercase().contains("gte-large") 
    {
        return (Some("query: "), Some("passage: "));
    }
    
    (None, None)
}

/// Returns true if the specific ONNX model file already exists in the HF cache.
pub fn is_model_cached(model_id: &str) -> bool {
    let Some(cache_base) = dirs::cache_dir() else { return false };
    let hf_repo = internal_repo_name(model_id);
    let folder_name = hf_repo.replace("/", "--");
    let model_dir = cache_base
        .join("io.github.story-essentia.matthew")
        .join("fastembed")
        .join(format!("models--{}", folder_name));

    model_dir.exists() && model_dir.join("snapshots").exists()
}

pub fn is_bgem3_cached() -> bool {
    is_model_cached("BAAI/bge-m3")
}

/// Map our UI model ID to the fastembed enum.
pub fn map_model_id(model_id: &str) -> anyhow::Result<EmbeddingModel> {
    match internal_repo_name(model_id) {
        "BAAI/bge-m3"                           => Ok(EmbeddingModel::BGEM3),
        "mixedbread-ai/mxbai-embed-large-v1"    => Ok(EmbeddingModel::MxbaiEmbedLargeV1),
        "lightonai/modernbert-embed-large"       => Ok(EmbeddingModel::ModernBertEmbedLarge),
        "Snowflake/snowflake-arctic-embed-l"     => Ok(EmbeddingModel::SnowflakeArcticEmbedL),
        "Snowflake/snowflake-arctic-embed-m"     => Ok(EmbeddingModel::SnowflakeArcticEmbedM),
        "Snowflake/snowflake-arctic-embed-s"     => Ok(EmbeddingModel::SnowflakeArcticEmbedS),
        "Snowflake/snowflake-arctic-embed-xs"    => Ok(EmbeddingModel::SnowflakeArcticEmbedXS),
        "Snowflake/snowflake-arctic-embed-m-long" => Ok(EmbeddingModel::SnowflakeArcticEmbedMLong),
        "BAAI/bge-base-en-v1.5"                 |
        "Xenova/bge-base-en-v1.5"               => Ok(EmbeddingModel::BGEBaseENV15),

        "sentence-transformers/all-MiniLM-L6-v2" |
        "Qdrant/all-MiniLM-L6-v2-onnx"          => Ok(EmbeddingModel::AllMiniLML6V2),

        "intfloat/multilingual-e5-large"         |
        "Qdrant/multilingual-e5-large-onnx"     => Ok(EmbeddingModel::MultilingualE5Large),

        "Alibaba-NLP/gte-large-en-v1.5"         => Ok(EmbeddingModel::GTELargeENV15),
        "nomic-ai/nomic-embed-text-v1.5"         => Ok(EmbeddingModel::NomicEmbedTextV15),
        _ => Err(anyhow::anyhow!("Unknown model code: {}", model_id)),
    }
}

// ── EmbedEngine ───────────────────────────────────────────────────────────────

pub struct EmbedEngine {
    model:           Option<TextEmbedding>, // None until new_with_progress() completes
    active_model_id: Option<String>,        // tracks which model is currently loaded
    dims:            usize,
    pub safe_batch_size: usize,
}

impl EmbedEngine {
    /// Cheap placeholder stored in AppState while async init is in progress.
    /// Any call to embed_batch/embed_query while the model is None returns an error.
    pub fn placeholder() -> Self {
        Self { model: None, active_model_id: None, dims: 0, safe_batch_size: 0 }
    }

    /// Initialise an embedding model, emitting Tauri events so the frontend can drive a
    /// real progress bar during the first-run download.
    ///
    /// `TextEmbedding::try_new` is synchronous and **blocking** — it is run
    /// inside `spawn_blocking` so we never park the async runtime.
    pub async fn new_with_progress(app: AppHandle, model_enum: EmbeddingModel) -> Result<Self> {
        // Signal the frontend immediately so it can switch to the download UI.
        app.emit(
            "model:download",
            ModelDownloadEvent {
                status:  "downloading".into(),
                message: format!("Preparing model... This only happens once and enables fully offline search."),
            },
        )
        .ok();

        // Run the blocking ONNX initialisation on a dedicated thread.
        let m_copy = model_enum.clone();
        let model = tokio::task::spawn_blocking(move || {
            let cache_dir = dirs::cache_dir()
                .expect("Could not determine system cache directory")
                .join("io.github.story-essentia.matthew")
                .join("fastembed");

            std::fs::create_dir_all(&cache_dir)
                .expect("Could not create cache directory");

            TextEmbedding::try_new(
                InitOptions::new(m_copy)
                    .with_cache_dir(cache_dir)
                    .with_show_download_progress(true),
            )
        })
        .await
        .map_err(|e| anyhow::anyhow!("embed thread panicked: {}", e))??;

        app.emit(
            "model:download",
            ModelDownloadEvent {
                status:  "complete".into(),
                message: "Model ready.".into(),
            },
        )
        .ok();

        let dims = match model_enum {
            EmbeddingModel::BGEM3                 |
            EmbeddingModel::MxbaiEmbedLargeV1     |
            EmbeddingModel::ModernBertEmbedLarge  |
            EmbeddingModel::SnowflakeArcticEmbedL |
            EmbeddingModel::GTELargeENV15         |
            EmbeddingModel::MultilingualE5Large   => 1024,

            EmbeddingModel::NomicEmbedTextV15     |
            EmbeddingModel::SnowflakeArcticEmbedMLong |
            EmbeddingModel::SnowflakeArcticEmbedM     |
            EmbeddingModel::BGEBaseENV15         => 768,

            EmbeddingModel::SnowflakeArcticEmbedS     |
            EmbeddingModel::SnowflakeArcticEmbedXS    |
            EmbeddingModel::AllMiniLML6V2         => 384,

            _ => 1024,
        };

        Ok(Self {
            model: Some(model),
            active_model_id: Some(format!("{:?}", model_enum)),
            dims,
            safe_batch_size: Self::compute_batch_size(),
        })
    }

    /// Ensure the engine has the correct model loaded for the given model_id.
    /// If a different model is currently active, re-initialise with the correct one.
    /// This is called automatically by embed_query / embed_batch.
    fn ensure_model(&mut self, model_id: &str) -> Result<()> {
        let needed_enum = map_model_id(model_id)?;
        let needed_tag  = format!("{:?}", needed_enum);

        if self.active_model_id.as_deref() == Some(&needed_tag) && self.model.is_some() {
            return Ok(());  // already loaded
        }

        // Re-initialise with the required model (blocking, but fast if cached).
        let cache_dir = dirs::cache_dir()
            .expect("Could not determine system cache directory")
            .join("io.github.story-essentia.matthew")
            .join("fastembed");
        std::fs::create_dir_all(&cache_dir)?;

        let new_model = TextEmbedding::try_new(
            InitOptions::new(needed_enum.clone())
                .with_cache_dir(cache_dir)
                .with_show_download_progress(false),
        )?;

        self.dims = get_model_dims(model_id);
        self.model = Some(new_model);
        self.active_model_id = Some(needed_tag);
        self.safe_batch_size = Self::compute_batch_size();
        Ok(())
    }

    /// Background download helper called from a Tauri command.
    /// Initialises a new model and swaps it into the global AppState.
    pub async fn download_model(
        app: AppHandle,
        model: EmbeddingModel,
        state: tauri::State<'_, crate::AppState>,
    ) -> Result<()> {
        let engine = Self::new_with_progress(app, model).await?;
        let mut guard = state.embed_engine.lock().await;
        *guard = engine;
        Ok(())
    }

    /// Compute a memory-safe batch size based on available RAM.
    /// BGE-M3 uses 1024-dim vectors (vs 768 for nomic), so batch sizes are
    /// ~33 % lower than a nomic-equivalent setup.
    fn compute_batch_size() -> usize {
        let mut sys = System::new_all();
        sys.refresh_memory();
        let available_mb = sys.available_memory() / 1024 / 1024;
        match available_mb {
            0..=2047     =>  4,
            2048..=4095  =>  8,
            4096..=8191  => 16,
            8192..=16383 => 32,
            _            => 48,
        }
    }

    /// Embed a batch of texts. Caller must only ever pass one batch at a time
    /// and drop the returned vectors before passing the next batch (memory safety).
    pub fn embed_batch(&mut self, model_id: &str, mut texts: Vec<String>) -> Result<Vec<Vec<f32>>> {
        self.ensure_model(model_id)?;
        let model = self.model.as_mut()
            .ok_or_else(|| anyhow::anyhow!("EmbedEngine not yet initialised"))?;

        // Apply prefix if needed
        let (_, passage_prefix) = get_model_prefixes(model_id);
        if let Some(prefix) = passage_prefix {
            for text in texts.iter_mut() {
                *text = format!("{}{}", prefix, text);
            }
        }

        model.embed(texts, Some(self.safe_batch_size)).map_err(Into::into)
    }

    /// Embed a single query string for similarity search (batch size = 1).
    pub fn embed_query(&mut self, model_id: &str, query: &str) -> Result<Vec<f32>> {
        self.ensure_model(model_id)?;
        let model = self.model.as_mut()
            .ok_or_else(|| anyhow::anyhow!("EmbedEngine not yet initialised"))?;

        let (query_prefix, _) = get_model_prefixes(model_id);
        let final_query = if let Some(prefix) = query_prefix {
            format!("{}{}", prefix, query)
        } else {
            query.to_string()
        };

        model
            .embed(vec![final_query], Some(1))?
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("empty embedding result"))
    }

    /// Returns the vector dimension of the active model.
    pub fn dims(&self) -> usize {
        self.dims
    }
}
