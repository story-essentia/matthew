use anyhow::Result;
use sha2::{Digest, Sha256};
use std::io::Read;

// ── Minimum content threshold ─────────────────────────────────────────────────

/// Pages (and chunks) shorter than this are considered blank/noise and dropped.
const MIN_CHUNK_CHARS: usize = 50;

// ── Page result ───────────────────────────────────────────────────────────────

/// One extracted page from a PDF.
pub struct PageResult {
    pub page_number: i32,
    pub text: Option<String>, // None = image-only or blank page
}

// ── Raw chunk ─────────────────────────────────────────────────────────────────

/// One sliding-window text chunk, before embeddings are generated.
pub struct RawChunk {
    pub text:        String,
    pub page_number: i32,
    pub chunk_index: i32, // document-level index, not page-level
}

// ── PdfExtractor ──────────────────────────────────────────────────────────────

pub struct PdfExtractor;

impl PdfExtractor {
    pub fn new() -> Self {
        Self
    }

    /// Extract text from every page of a PDF.
    /// Pages with no extractable text (scanned / image-only) are returned as
    /// `PageResult { text: None }` so the caller can report them to the user.
    pub fn extract_pages(&self, path: &str) -> Result<Vec<PageResult>> {
        let full_text = pdf_extract::extract_text(path).map_err(|_| {
            anyhow::anyhow!("No extractable text — try an OCR tool first.")
        })?;

        // pdf-extract separates pages with form-feed (ASCII 12, '\x0C').
        let pages = full_text
            .split('\x0C')
            .enumerate()
            .map(|(idx, raw)| {
                let cleaned = clean_text(raw);
                PageResult {
                    page_number: idx as i32 + 1,
                    // Keep the page only if it has enough real content.
                    text: if cleaned.len() >= MIN_CHUNK_CHARS {
                        Some(cleaned)
                    } else {
                        None
                    },
                }
            })
            .collect();

        Ok(pages)
    }
}

// ── Text cleaning ─────────────────────────────────────────────────────────────

/// Normalise raw PDF text into a single clean line suitable for chunking.
/// Collapses all whitespace, strips leading/trailing noise per line, and
/// removes blank lines before joining with a single space.
pub fn clean_text(raw: &str) -> String {
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

// ── Chunking ──────────────────────────────────────────────────────────────────

/// Split a page's text into overlapping chunks using the preset's character counts.
///
/// - `chunk_chars` and `overlap_chars` come from `ChunkPreset` — never hardcoded.
/// - `doc_chunk_offset` is the running chunk count across all earlier pages so
///   that `chunk_index` is document-scoped (not page-scoped).
/// - Chunks shorter than `MIN_CHUNK_CHARS` after trimming are dropped.
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
        let trimmed = chars[start..end]
            .iter()
            .collect::<String>()
            .trim()
            .to_string();

        if trimmed.len() >= MIN_CHUNK_CHARS {
            chunks.push(RawChunk {
                text:        trimmed,
                page_number,
                chunk_index: doc_chunk_offset + local_idx,
            });
            local_idx += 1;
        }

        if end == chars.len() {
            break;
        }
        // Advance by (chunk_chars - overlap_chars) so consecutive chunks share
        // `overlap_chars` of context at their boundary.
        start += chunk_chars - overlap_chars;
    }

    chunks
}

// ── SHA-256 deduplication ─────────────────────────────────────────────────────

/// Compute the SHA-256 hex digest of a file.
/// Used to skip files that have already been ingested into this library.
/// Reads in 8 KiB blocks to avoid loading the whole PDF into memory.
pub fn file_sha256(path: &str) -> Result<String> {
    let mut file   = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf    = [0u8; 8192];

    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}
