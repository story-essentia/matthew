# Implementation Plan: Custom Model Storage Path

**Branch**: `001-custom-model-path` | **Date**: 2026-04-10 | **Spec**: [specs/001-custom-model-path/spec.md](spec.md)
**Input**: Feature specification from `/specs/001-custom-model-path/spec.md`

## Summary

Resolve a hidden Windows cache hang issue by allowing users to select a custom model storage directory. This custom directory replaces the fastembed default cache path, and is configured in the Settings tab via a standard OS folder picker. 

## Technical Context

**Language/Version**: Rust stable (Backend) / TypeScript + React 18 (Frontend)
**Primary Dependencies**: `tauri-plugin-dialog`, `fastembed-rs`
**Storage**: File-based `settings.json` via Tauri commands
**Testing**: Manual test + existing Rust commands
**Target Platform**: Windows, Linux, macOS (Tauri desktop app)
**Project Type**: Desktop app
**Performance Goals**: N/A (UI prompt)
**Constraints**: Must run fully offline; `localStorage` is completely banned; models must be handled safely.
**Scale/Scope**: Impacts single `TextEmbedding` initialization; minor UI additions.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Local-First Privacy**: File paths are kept locally, no network calls introduced.
- [x] **Fixed Technology Stack**: Uses existing `tauri-plugin-dialog`.
- [x] **Per-Library Isolation**: Safe. Setting is explicitly global since models are shared cross-library.
- [x] **Offline-Capable by Default**: No network components included.
- [x] **Fail Gracefully**: Validation will return `AppError` on unwriteable directories.
- [x] **Strict Frontend-Backend Contract**: Command responses all mapped correctly; no shared state.

## Project Structure

### Documentation (this feature)

```text
specs/001-custom-model-path/
├── plan.md              # This file
├── research.md          # Research options and plugin validations
├── data-model.md        # DB / Settings Schema modifications
├── quickstart.md        # Walkthrough
└── contracts/           # New Tauri Command specs
```

### Source Code (repository root)

```text
src-tauri/
└── src/
    ├── commands/
    │   └── query.rs         # Modification of AppSettings and commands
    └── embed/
        └── engine.rs        # Initializing fastembed with custom cache_dir

src/
├── components/
│   └── FirstRunScreen.tsx   # Add 'Change Directory' button to prompt
├── tabs/
│   └── Settings.tsx         # Add directory config controls
└── lib/
    └── tauri.ts             # Add save/get command wrappers
```

**Structure Decision**: The logic impacts the existing `query.rs` commands where settings live, `engine.rs` where models are spun up, and the main React components (`Settings` and `FirstRunScreen`).

## Complexity Tracking

> No violations of the Constitution or complex structures were needed for this fix.
