---
name: project-architecture
description: Defines the complete structure of the Matthew desktop app. Use when scaffolding the project, setting up the Tauri v2 workspace, planning folder layout, wiring Rust commands to the React frontend, configuring tauri.conf.json, or writing Cargo.toml dependencies. Also use when the agent is unsure where a new file should live or how two parts of the app connect.
---

# Matthew — Project Architecture

## What This App Is

A local-first, offline-capable Tauri v2 desktop app for ingesting PDF documents into a LanceDB vector database and querying them semantically. Full stack runs on the user's machine — no cloud, no server, no Docker. App name: **Matthew**. Identifier: `io.github.story-essentia.matthew`.

## Tech Stack (Fixed — Do Not Substitute)

| Layer | Technology | Version |
|---|---|---|
| Desktop shell | Tauri | v2 |
| Backend language | Rust | stable |
| Frontend framework | React + TypeScript | React 18 |
| Frontend build tool | Vite | v5 |
| Styling | Tailwind CSS + shadcn/ui | Tailwind v3 |
| Vector database | LanceDB | 0.26 |
| Arrow | arrow / arrow-array / arrow-schema | 57 |
| lance-arrow | lance-arrow | **2.0** (not 0.26) |
| Embeddings | fastembed (ONNX, local) | 5 |
| Embedding models | Dynamic Support (BGE, Nomic, E5, etc.) | Dynamic dims |
| PDF parsing | pdf-extract | 0.7 |
| LLM chat | OpenRouter API | — |
| Settings storage | **File-based** (settings.json) — NOT keyring | — |
| HTTP client | reqwest | 0.12 (json + rustls-tls) |
| Markdown rendering | react-markdown | latest |
| Icons | lucide-react | latest |
| System memory detection | sysinfo | 0.30 |
| Home dir resolution | dirs | 5 |
| Deduplication | sha2 | 0.10 |
| Timestamps | chrono | 0.4 + serde feature |

## Folder Structure

```
matthew/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── lib.rs               # AppState, AppError, ChunkPreset
│       ├── commands/
│       │   ├── mod.rs
│       │   ├── setup.rs         # get_setup_status
│       │   ├── libraries.rs     # create/open/list/delete
│       │   ├── ingest.rs        # streaming pipeline
│       │   ├── query.rs         # search, chat, file-based settings
│       │   └── chats.rs         # list/load/save/delete chat history
│       ├── db/
│       │   ├── mod.rs
│       │   ├── schema.rs        # Arrow schema, 1024-dim
│       │   └── store.rs         # connection, insert, search
│       ├── embed/
│       │   ├── mod.rs
│       │   └── engine.rs        # EmbedEngine + download progress
│       └── pdf/
│           ├── mod.rs
│           └── extractor.rs     # pdf-extract + chunking
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── ui/                  # shadcn/ui — never hand-edit
│   │   ├── layout/Shell.tsx     # owns Explore state, passes libraryPath
│   │   ├── shared/
│   │   │   ├── ConnectionDot.tsx
│   │   │   ├── ChunkPresetSelector.tsx
│   │   │   └── RetrievalControl.tsx
│   │   └── FirstRunScreen.tsx
│   ├── tabs/
│   │   ├── Libraries.tsx
│   │   ├── Import.tsx
│   │   ├── Explore.tsx          # pill toggle, history drawer, ReactMarkdown
│   │   └── Settings.tsx         # API key + model selector
│   ├── hooks/
│   │   ├── useLibraries.ts
│   │   ├── useIngest.ts
│   │   └── useQuery.ts
│   ├── lib/
│   │   ├── tauri.ts
│   │   └── utils.ts
│   └── types/index.ts
├── package.json
└── .agent/skills/
```

## Four Tabs

| Tab | Key | Purpose |
|---|---|---|
| **Libraries** | `libraries` | Create, open, switch between LanceDB databases. |
| **Import** | `import` | Drop PDFs, run pipeline, track detailed progress. |
| **Explore** | `explore` | Semantic search or RAG chat with history. |
| **Settings** | `settings` | OpenRouter API key + model preference. |

## Chunk Size Presets

| Preset | Chunk chars | Overlap |
|---|---|---|
| `precise` | 512 | 100 |
| `balanced` | 2048 | 400 |
| `contextual` | 4096 | 800 |

## Settings Storage (File-Based — NOT Keyring)

Settings stored at `{app_config_dir}/settings.json`:
```json
{"apiKey": "sk-or-...", "model": "openrouter/free"}
```

IMPORTANT: keyring was removed — it silently fails on some Linux systems. Use file-based only.

## Chat History Storage

Chats stored per-library at `{library_path}/chats/{id}.json`:
```json
{
  "id": "2026-03-13-16-42-00",
  "title": "How to heal trauma?",
  "createdAt": "2026-03-13T16:42:00Z",
  "messages": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}
```

## ChatResponse — chat_completion Returns Both Reply AND Sources

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub reply: String,
    pub sources: Vec<SearchResult>,
}
```

Frontend receives `{ reply: string, sources: SearchResult[] }` — not just a string.

## OpenRouter Models

Default: `openrouter/free` (always valid — auto-selects best free model).

WARNING: Do NOT hardcode specific free model IDs like `google/gemini-2.0-flash-exp:free` — they get removed without notice.

| Tier | Model ID |
|---|---|
| Free auto | `openrouter/free` |
| Free | `meta-llama/llama-3.3-70b-instruct:free` |
| Free | `deepseek/deepseek-r1:free` |
| Free | `google/gemma-3-27b-it:free` |
| Affordable | `openai/gpt-4o-mini`, `anthropic/claude-3-5-haiku`, `google/gemini-2.0-flash` |
| SOTA | `anthropic/claude-sonnet-4-6`, `openai/gpt-4o`, `google/gemini-2.5-pro-exp-03-25` |

## Cargo.toml

```toml
[dependencies]
tauri                 = { version = "2", features = ["default"] }
tauri-plugin-dialog   = "2"
lancedb               = "0.26"
lance-arrow           = "2.0"
arrow                 = "57"
arrow-array           = "57"
arrow-schema          = "57"
fastembed             = "5"
pdf-extract           = "0.7"
sysinfo               = "0.30"
dirs                  = "5"
tokio                 = { version = "1", features = ["full"] }
serde                 = { version = "1", features = ["derive"] }
serde_json            = "1"
uuid                  = { version = "1", features = ["v4"] }
sha2                  = "0.10"
chrono                = { version = "0.4", features = ["serde"] }
anyhow                = "1"
futures               = "0.3"
reqwest               = { version = "0.12", features = ["json", "rustls-tls"] }

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

NOTE: keyring is NOT in Cargo.toml. Do not add it.
