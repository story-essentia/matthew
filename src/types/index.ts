export type { UnlistenFn } from "@tauri-apps/api/event";

// ── Library ───────────────────────────────────────────────────────────────────

export type ChunkPreset = "precise" | "balanced" | "contextual";

/** Mirrors LibraryEntry in src-tauri/src/lib.rs */
export interface LibraryEntry {
  id:               string;
  name:             string;
  path:             string;
  createdAt:        string;   // RFC3339
  chunkCount:       number;
  ingestedHashes:   string[]; // SHA-256 of each ingested PDF
  chunkPreset:      ChunkPreset;
  hasBeenIngested:  boolean;  // true = preset is locked
  modelId:          string | null;
}

// ── Search ────────────────────────────────────────────────────────────────────

/** Mirrors SearchResult in src-tauri/src/db/store.rs */
export interface SearchResult {
  text:        string;
  fileName:    string;
  pageNumber:  number | null;
  chunkIndex:  number;
  score:       number; // 1.0 - cosine_distance; higher = more relevant
}

// ── Chat ──────────────────────────────────────────────────────────────────────

/** Mirrors ChatMessage in src-tauri/src/commands/query.rs */
export interface ChatMessage {
  role:     "system" | "user" | "assistant";
  content:  string;
  // Only set on assistant messages — the retrieved chunks and originating query.
  sources?: SearchResult[];
  query?:   string;
}

/** Mirrors ChatResponse in src-tauri/src/commands/query.rs */
export interface ChatResponse {
  reply:   string;
  sources: SearchResult[];
}

export interface ChatMeta {
  id:        string;
  title:     string;
  createdAt: string;
  chatPath:  string;
}

export interface StoredMessage {
  role:    string;
  content: string;
  sources?: SearchResult[];
  query?:   string;
}

export interface ChatData {
  id:        string;
  title:     string;
  createdAt: string;
  messages:  StoredMessage[];
}

// ── Ingestion progress ────────────────────────────────────────────────────────

export type IngestPhase =
  | "parsing"
  | "chunking"
  | "embedding"
  | "storing"
  | "skipped"
  | "done"
  | "error";

/** Mirrors IngestProgress in src-tauri/src/commands/ingest.rs */
export interface IngestProgress {
  currentFile:       number;
  totalFiles:        number;
  fileName:          string;
  phase:             IngestPhase;
  fileChunksDone:    number;
  fileChunksTotal:   number;
  totalChunksAdded:  number;
  totalFilesSkipped: number;
  pagesExtracted:    number;
  imageOnlyPages:    number;
  error:             string | null;
}

// ── Model download ────────────────────────────────────────────────────────────

/** Mirrors ModelDownloadEvent in src-tauri/src/embed/engine.rs */
export interface ModelDownloadEvent {
  status:  "downloading" | "complete" | "error";
  message: string;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

/** Mirrors SetupStatus in src-tauri/src/commands/setup.rs */
export interface SetupStatus {
  modelCached: boolean;
}

// ── Ingested files ────────────────────────────────────────────────────────────

/** Mirrors IngestedFile in src-tauri/src/commands/libraries.rs */
export interface IngestedFile {
  sourceFile: string;
  chunkCount: number;
}
