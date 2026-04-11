<!--
  Sync Impact Report
  ───────────────────
  Version change: 0.0.0 (template) → 1.0.0
  Modified principles: N/A (initial creation)
  Added sections:
    - 7 Core Principles (I–VII)
    - Technology Stack Constraints
    - Development Workflow
    - Governance
  Removed sections: none
  Templates requiring updates:
    ✅ plan-template.md — "Constitution Check" section references
       constitution generically; no update needed
    ✅ spec-template.md — no constitution-specific references; compatible
    ✅ tasks-template.md — no constitution-specific references; compatible
  Follow-up TODOs: none
-->

# Matthew Constitution

## Core Principles

### I. Local-First Privacy

All document processing — PDF parsing, text chunking, embedding
generation, and vector search — MUST execute entirely on the user's
machine. Documents MUST NOT be uploaded to any remote service.

The only permitted network calls are:

- **LLM chat** via OpenRouter (user's query + retrieved passages are
  sent to the chosen model).
- **One-time model download** when a new embedding model is selected
  for the first time.

Every new feature MUST declare whether it introduces network traffic.
If it does, the README and Settings tab MUST be updated to disclose it.

### II. Fixed Technology Stack

The technology stack is locked. Substitutions MUST NOT be made without
a constitution amendment.

| Layer | Technology | Locked Version |
|---|---|---|
| Desktop shell | Tauri | v2 |
| Backend | Rust | stable |
| Frontend | React + TypeScript | React 18 |
| Build tool | Vite | v5 |
| Styling | Tailwind CSS + shadcn/ui | Tailwind v3 |
| Vector database | LanceDB | 0.26 |
| Arrow ecosystem | arrow / arrow-array / arrow-schema | 57 |
| lance-arrow | lance-arrow | 2.0 |
| Embeddings | fastembed (local ONNX) | 5 |
| PDF parsing | pdf-extract | 0.7 |
| LLM provider | OpenRouter API | — |
| Settings storage | File-based (settings.json) | — |
| Font | DM Sans (locally bundled) | — |

**Explicitly banned:**

- `keyring` crate — silently fails on some Linux distributions.
- Google Fonts CDN or any remote font loading — violates offline
  capability.
- `localStorage` in the frontend — all persistence goes through
  Tauri commands and the filesystem.

### III. Per-Library Isolation

Each library is a self-contained unit with its own vector database,
embedding model, chunk preset, and chat history. Cross-library state
contamination MUST NOT occur.

Non-negotiable rules:

- **Embedding model** is chosen before the first import and locked
  permanently after it (`has_been_ingested = true`). Switching models
  on an existing library would make vectors incompatible.
- **Chunk size preset** (precise / balanced / contextual) follows the
  same lock rule.
- **Chat history** is stored per-library at
  `{library_path}/chats/{id}.json` and MUST be cleared from UI state
  when the user switches libraries.
- **Deduplication** uses SHA-256 hashes stored per-library in the
  registry. The same PDF imported into two different libraries is
  allowed; reimporting the same PDF into the same library is blocked.

### IV. Memory-Safe Processing

The ingestion pipeline MUST be memory-safe on machines with as little
as 2 GB of available RAM. The following rules are non-negotiable:

- Process **one PDF at a time**, sequentially.
- Embed **one batch at a time** using adaptive batch sizing based on
  `sysinfo`-reported available memory.
- **Insert to LanceDB immediately** after each batch completes.
- **Drop embeddings and records** immediately after insertion —
  never buffer more than one batch.
- Peak memory budget: model weights (~500 MB for the largest model)
  plus one batch (~`safe_batch_size × 5 KB`).

### V. Offline-Capable by Default

After the one-time embedding model download, the core workflow
(ingest → search) MUST function with zero internet connectivity.

Requirements:

- DM Sans font MUST be bundled locally in `src/assets/fonts/`,
  declared via `@font-face` in `index.css`.
- Embedding models are cached in
  `~/.cache/io.github.story-essentia.matthew/fastembed/`.
- The app MUST NOT fetch remote assets (CDN stylesheets, icon fonts,
  analytics scripts) at any point.
- Chat (which requires OpenRouter) MUST degrade gracefully when
  offline — the user MUST see a clear error, not a hang or crash.

### VI. Fail Gracefully, Never Crash

The app MUST NOT crash on user-recoverable errors. All error handling
follows these rules:

- **One error type**: `AppError { code, message }` for all Tauri
  commands. `code` is machine-readable (`"DB_NOT_OPEN"`,
  `"EMBED_FAILED"`); `message` is human-readable and displayed in
  the UI.
- **No `unwrap()` / `expect()`** in commands or library code —
  always propagate with `?`.
- **Per-file error resilience** in the ingestion pipeline: a single
  corrupt or image-only PDF MUST NOT abort the entire batch. The
  pipeline logs the error, emits an `IngestPhase::Error` event, and
  continues to the next file.
- **No blocking I/O on the async runtime** — wrap CPU-bound work
  (embedding, PDF parsing) with `tokio::task::spawn_blocking`.
- **No `std::sync::Mutex`** in async code — always use
  `tokio::sync::Mutex` / `RwLock`.

### VII. Strict Frontend-Backend Contract

The boundary between Rust and React is a typed contract that MUST
be maintained consistently.

Rules:

- Every Rust struct serialized to the frontend MUST carry
  `#[serde(rename_all = "camelCase")]`. Missing this annotation
  causes silent `undefined` fields in TypeScript.
- All `invoke()` and `listen()` calls MUST live in
  `src/lib/tauri.ts` — components MUST NOT call Tauri APIs directly.
- `chat_completion` returns `ChatResponse { reply, sources }`, not
  a plain string. Sources are `Vec<SearchResult>`.
- Search query and chat query are **separate state values** — they
  MUST NOT share state or interfere with each other.
- Both the **Import** and **Explore** tabs MUST remain mounted at
  all times (use the `hidden` CSS class). Unmounting causes state
  loss. The **Explore** component uses a `key={libraryPath}` to
  force remount on library switch.

## Technology Stack Constraints

Beyond the locked versions in Principle II, the following constraints
govern how the stack is used:

- **Tauri identifier**: always `io.github.story-essentia.matthew`.
- **AppState** is defined once in `lib.rs`, registered via
  `.manage()` in `main.rs`, and injected into commands via
  `State<'_, AppState>`.
- **File paths** MUST use `app.path().app_config_dir()` or
  equivalent Tauri resolvers — never hardcode OS-specific paths.
- **Event emission** requires `use tauri::Emitter;` (not `Manager`)
  for `.emit()`. Import both traits when you need path resolution
  and events.
- **LanceDB vector index** requires ≥256 rows. MUST check row count
  before calling `create_index` — small tables use brute-force
  search automatically.
- **Arrow Int32 nullable columns** MUST use `Int32Builder` with
  explicit `append_value` / `append_null` — do NOT use
  `Int32Array::from(Vec<Option<i32>>)`.
- **LanceDB query imports**: always import all three —
  `ExecutableQuery`, `QueryBase`, `Select` — or method-not-found
  errors occur.

## Development Workflow

### Code Organization

- **Rust modules**: `commands/`, `db/`, `embed/`, `pdf/` under
  `src-tauri/src/`. Each has a `mod.rs` re-exporting public items.
- **React**: `tabs/`, `components/`, `hooks/`, `lib/` under `src/`.
  `components/ui/` is shadcn/ui — never hand-edit.
- **Agent skills** in `.agents/skills/` document verified API
  patterns. Consult the relevant skill before writing code in its
  domain. Do not guess at API shapes.

### Settings Storage

Settings are stored at `{app_config_dir}/settings.json` as a simple
JSON object (`apiKey`, `model`). The `keyring` crate MUST NOT be
used or added to `Cargo.toml`.

### Progress Reporting

Long-running operations (ingestion) MUST emit structured progress
events to the frontend so the UI can display real-time feedback.
The `IngestProgress` struct covers file-level, phase-level, and
chunk-level granularity.

### API Keys

API keys MUST NOT appear in logs, serialized error messages, or
any struct that could be displayed to the user beyond the Settings
tab's masked input.

## Governance

This constitution is the highest-authority document for the Matthew
project. All feature specifications, implementation plans, and task
lists MUST comply with its principles.

**Amendment procedure:**

1. Propose the change with a rationale explaining why the current
   principle is insufficient or incorrect.
2. Update this document with the new or revised principle.
3. Increment the version following semantic versioning (see below).
4. Update any affected templates or skill files.

**Versioning policy:**

- **MAJOR**: Removal or backward-incompatible redefinition of a
  core principle.
- **MINOR**: Addition of a new principle or material expansion of
  existing guidance.
- **PATCH**: Clarifications, wording fixes, non-semantic refinements.

**Compliance review:**

- Every feature spec MUST include a Constitution Check section
  (defined in `plan-template.md`) verifying alignment with active
  principles before design work begins.
- Every PR/review MUST verify that no principle is violated.

**Version**: 1.0.0 | **Ratified**: 2026-04-09 | **Last Amended**: 2026-04-09
