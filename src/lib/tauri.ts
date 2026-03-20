// ALL Tauri invoke/listen calls must go through this file.
// Components and hooks must never import @tauri-apps directly.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  LibraryEntry,
  SearchResult,
  ChatMessage,
  ChatResponse,
  IngestProgress,
  ModelDownloadEvent,
  SetupStatus,
  IngestedFile,
  ChatMeta,
  ChatData,
} from "@/types";



// ── Libraries ─────────────────────────────────────────────────────────────────

export function listLibraries(): Promise<LibraryEntry[]> {
  return invoke<LibraryEntry[]>("list_libraries");
}

export function createLibrary(
  name: string,
  path: string,
  preset: LibraryEntry["chunkPreset"],
): Promise<LibraryEntry> {
  return invoke<LibraryEntry>("create_library", { name, path, preset });
}

export function openLibrary(id: string): Promise<void> {
  return invoke<void>("open_library", { id });
}

export function deleteLibrary(id: string): Promise<void> {
  return invoke<void>("delete_library", { id });
}

export function openExistingLibrary(
  name: string,
  path: string,
  preset: LibraryEntry["chunkPreset"],
): Promise<LibraryEntry> {
  return invoke<LibraryEntry>("open_existing_library", { name, path, preset });
}

export function setLibraryPreset(
  id: string,
  preset: LibraryEntry["chunkPreset"],
): Promise<void> {
  return invoke<void>("set_library_preset", { id, preset });
}

export function listIngestedFiles(libraryId: string): Promise<IngestedFile[]> {
  return invoke<IngestedFile[]>("list_ingested_files", { libraryId });
}

export function setLibraryModel(id: string, modelId: string): Promise<void> {
  return invoke('set_library_model', { id, modelId });
}

// ── Ingest ────────────────────────────────────────────────────────────────────

export function ingestPdfs(paths: string[]): Promise<number> {
  return invoke<number>("ingest_pdfs", { paths });
}

export function listPdfsInFolder(folderPath: string): Promise<string[]> {
  return invoke<string[]>("list_pdfs_in_folder", { folderPath });
}

// ── Search & Chat ─────────────────────────────────────────────────────────────

export function searchChunks(query: string, topK: number): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search_chunks", { query, topK });
}

export function chatCompletion(
  messages: ChatMessage[],
  context: SearchResult[],
  topK: number,
): Promise<ChatResponse> {
  return invoke<ChatResponse>("chat_completion", { messages, context, topK });
}

export interface ModelInfo {
  id: string;
  displayName: string;
  description: string;
  bestFor: string;
  sizeMb: number;
  dims: number;
  multilingual: boolean;
  recommended: boolean;
  isNew: boolean;
  isFast: boolean;
  cached: boolean;
}

export async function listEmbeddingModels(): Promise<ModelInfo[]> {
  return invoke('list_embedding_models');
}

export async function downloadEmbeddingModel(modelId: string): Promise<void> {
  return invoke('download_embedding_model', { modelId });
}

export async function initializeEmbeddingModel(modelId: string): Promise<void> {
  return invoke('initialize_embedding_model', { modelId });
}

export async function getSetupStatus(): Promise<{ modelCached: boolean }> {
  return invoke('get_setup_status');
}

export function listChats(libraryPath: string): Promise<ChatMeta[]> {
  return invoke<ChatMeta[]>("list_chats", { libraryPath });
}

export function loadChat(chatPath: string): Promise<ChatData> {
  return invoke<ChatData>("load_chat", { chatPath });
}

export function saveChat(libraryPath: string, chat: ChatData): Promise<void> {
  return invoke<void>("save_chat", { libraryPath, chat });
}

export function deleteChat(chatPath: string): Promise<void> {
  return invoke<void>("delete_chat", { chatPath });
}

// ── API key & model preference ────────────────────────────────────────────────

export function saveApiKey(key: string): Promise<void> {
  return invoke<void>("save_api_key", { key });
}

export function getApiKey(): Promise<string | null> {
  return invoke<string | null>("get_api_key");
}

export function saveModelPreference(model: string): Promise<void> {
  return invoke<void>("save_model_preference", { model });
}

export function getModelPreference(): Promise<string | null> {
  return invoke<string | null>("get_model_preference");
}

// ── Event listeners ───────────────────────────────────────────────────────────

export function onModelDownload(
  handler: (event: any) => void,
): Promise<UnlistenFn> {
  return listen("model:download", (e) => handler(e.payload));
}

export function onIngestProgress(
  handler: (progress: IngestProgress) => void,
): Promise<UnlistenFn> {
  return listen<IngestProgress>("ingest:progress", (e) => handler(e.payload));
}
