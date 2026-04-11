---

description: "Task list for Custom Model Storage Path"
---

# Tasks: Custom Model Storage Path

**Input**: Design documents from `/specs/001-custom-model-path/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Update `AppSettings` struct to expose `model_storage_path` locally in `src-tauri/src/commands/query.rs`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Implement `save_model_storage_path` command in `src-tauri/src/commands/query.rs` with access validation to confirm path is writable, returning AppError if not.
- [X] T003 Implement `get_model_storage_path` command in `src-tauri/src/commands/query.rs`
- [X] T004 Register new settings commands in `src-tauri/src/main.rs`
- [X] T005 [P] Create and export TypeScript command wrappers in `src/lib/tauri.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Select Custom Directory on Download (Priority: P1) 🎯 MVP

**Goal**: Present the user with an option to select a directory so they avoid silent storage failures on restricted drives like Windows OS defaults.

**Independent Test**: Can be fully tested by clicking to download a model on a fresh installation and verifying a directory selection dialog appears and sets the path state prior to fetching assets.

### Implementation for User Story 1

- [X] T006 [P] [US1] Update `src/components/FirstRunScreen.tsx` to query and store the current model path on mount using `getModelStoragePath`.
- [X] T007 [US1] Update `src/components/FirstRunScreen.tsx` to import the `@tauri-apps/plugin-dialog` to launch a directory picker.
- [X] T008 [US1] Update `src/components/FirstRunScreen.tsx` to include "Change Location" UI logic, explicitly handling `null` return values gracefully if the user cancels, and persist the choice using `saveModelStoragePath` before download.

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Persistent Model Path Storage (Priority: P2)

**Goal**: Ensure the application actively respects and displays the stored directory to the user in the primary view post-installation.

**Independent Test**: Modifying the path in Settings updates the engine, and launching the app reads the model from the newly saved path instead of recreating defaults.

### Implementation for User Story 2

- [X] T009 [P] [US2] Update `src-tauri/src/embed/engine.rs` to read the path from `settings.json` locally and append `with_cache_dir` configuration before initializing the `TextEmbedding` engine.
- [X] T010 [US2] Update `src/tabs/Settings.tsx` to create a "Model Storage Location" section displaying the current path with another "Change Location" plugin-dialog trigger natively.

**Checkpoint**: All user stories should now be independently functional.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T011 Run a manual full application loop on the desktop to verify the path persists correctly without silently trapping errors or failing to create root directories.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed sequentially in priority order (P1 → P2), but because of isolated UI footprints, they can also safely run in parallel.
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Integrates with engine cache rendering independent of the First Run setup screen.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently on the FirstRunScreen.
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently
3. Add User Story 2 → Test independent caching configuration + settings UI rendering 
4. Each story adds value without breaking previous components.
