# Matthew Constitution

**Version**: 1.0  
**Ratified**: 2026-03-27  
**Last Amended**: 2026-03-27

## What This App Is

Matthew is a **local-first, offline-capable Tauri v2 desktop app** for ingesting PDF documents into a LanceDB vector database and querying them semantically.  
The full stack runs entirely on the user’s machine — **no cloud, no server, no Docker**.  
App name: **Matthew**  
Tauri identifier: `io.github.story-essentia.matthew`

## Tech Stack (Fixed — Do Not Substitute)

| Layer                  | Technology                          | Version / Constraint                  |
|------------------------|-------------------------------------|---------------------------------------|
| Desktop shell          | Tauri                               | v2                                    |
| Backend language       | Rust                                | stable                                |
| Frontend framework     | React + TypeScript                  | React 18                              |
| Frontend build tool    | Vite                                | v5                                    |
| Styling                | Tailwind CSS + shadcn/ui            | Tailwind v3                           |
| Vector database        | LanceDB                             | 0.26                                  |
| Arrow ecosystem        | arrow / arrow-array / arrow-schema  | 57                                    |
| LanceDB Arrow bridge   | lance-arrow                         | **2.0** (not 0.26)                    |
| Embeddings             | fastembed (ONNX, local)             | 5                                     |
| PDF parsing            | pdf-extract                         | 0.7                                   |
| LLM chat               | OpenRouter API                      | —                                     |
| Settings storage       | File-based (`settings.json`)        | **NOT keyring**                       |
| HTTP client            | reqwest                             | 0.12 (json + rustls-tls)              |
| Markdown rendering     | react-markdown                      | latest                                |
| Icons                  | lucide-react                        | latest                                |
| System memory detection| sysinfo                             | 0.30                                  |
| Home dir resolution    | dirs                                | 5                                     |
| Deduplication          | sha2                                | 0.10                                  |
| Timestamps             | chrono                              | 0.4 + serde feature                   |

**Any deviation from this stack requires explicit approval and constitution amendment.**

## Core Architecture Decisions

- **Four permanent tabs** (in this exact order):  
  **Libraries** → **Import** → **Explore** → **Settings**

- **Chunk size presets** (locked per library after first import):  
  - `precise`: 512 chars + 100 overlap  
  - `balanced`: 2048 chars + 400 overlap  
  - `contextual`: 4096 chars + 800 overlap

- **Settings storage**: Always file-based at `{app_config_dir}/settings.json`. Keyring is permanently removed.

- **Chat history storage**: Per-library at `{library_path}/chats/{id}.json` (ISO timestamp ID, newest-first listing).

- **Chat API response**: `chat_completion` **always** returns `ChatResponse { reply: string, sources: SearchResult[] }` — never a plain string.

- **OpenRouter default model**: `openrouter/free`. Never hardcode specific free model IDs (they are removed without notice).

- **Frontend identifier & branding**: App name is **Matthew** (Capital M). Use the exact Tauri identifier `io.github.story-essentia.matthew`.

- **All Rust structs sent to frontend**: MUST use `#[serde(rename_all = "camelCase")]` (including nested structs like `SearchResult`).

- **Memory-safety rule**: Never hold locks across `.await`. Process one PDF / one batch at a time. Drop data immediately after use.

- **Verification rule**: Code generation is **not complete** until it compiles error-free. Where tests exist, they must pass. The agent must explicitly hand off to the user for final `cargo check` / `cargo test` verification.

## Agent Operating Principles (Non-Negotiable)

These rules were distilled from real errors and fixes during Matthew’s initial build. They apply to **every** interaction with the AI partner and every skill.

1. **Never invent package versions.**  
   For every dependency, state that the version must be verified on crates.io / npmjs.com before adding it.

2. **Distinguish between what you know and what you’re guessing.**  
   If something is inferred from patterns, label it clearly. Never present guesses as facts.

3. **Flag ecosystem-specific risks upfront.**  
   Before recommending any package, warn if the ecosystem is fast-moving and API shapes may have changed.

4. **Separate architecture decisions from implementation details.**  
   Architecture and data-flow rules age slowly and belong here. Exact method signatures and import paths must be verified against running code before being written into skills.

5. **Never write skill files from memory alone.**  
   Skill files may only document patterns that have been proven to compile and run in the current session. Unverified code blocks must be marked “unverified — must be tested”.

6. **Build and verify incrementally.**  
   For any new component, insist on a minimal working proof before building the full pipeline around it.

7. **For external services and APIs, always search current documentation.**  
   Never rely on training knowledge for API endpoints, auth formats, model IDs, or rate limits.

8. **When something fails, update the skills (and this constitution) immediately.**  
   Every bug fixed is a lesson. Update the relevant skill **and**, if the lesson is project-wide or meta, also update this constitution before continuing.

9. **Code generation is not complete until it compiles error-free and (where applicable) passes relevant tests.**  
   The agent must treat “compiles cleanly + tests pass” as the definition of done. Because the agent cannot always run tests itself, it must generate the smallest possible change, explicitly tell the user “Ready for verification — please run `cargo check` (or `cargo test`) and report any errors”, and wait for user confirmation before declaring the task complete.

## Governance

- This Constitution is the **single source of truth** for the entire Matthew project.  
- Every skill file in `.agent/skills/` **must** begin with this exact line at the top (after the YAML header):

  > **CRITICAL: Always follow the Matthew Constitution at `../CONSTITUTION.md` as the single source of truth before applying any domain-specific rules below.**

- Any proposed change to the Constitution must be documented, justified, and versioned.  
- Skills may contain detailed “how-to” patterns and verified code examples, but they **must never contradict** this Constitution.
