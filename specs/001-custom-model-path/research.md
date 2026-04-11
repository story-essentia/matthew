# Research Notes: Custom Model Storage Path

## Directory Selection Dialog
**Decision**: Use `@tauri-apps/plugin-dialog` in the frontend.
**Rationale**: `package.json` already contains `@tauri-apps/plugin-dialog: ^2.6.0`, and `tauri.conf.json` / `main.rs` have the plugin configured (`tauri_plugin_dialog::init()`). This allows the React UI to invoke native directory pickers without needing a new custom rust command just for the dialog.
**Alternatives considered**: Rust backend dialog (requires writing a new Tauri command wrapper, redundant work).

## Application Settings Extension
**Decision**: Extend `AppSettings` in `src-tauri/src/commands/query.rs` with an `Option<String>` for `model_storage_path`.
**Rationale**: Settings are currently managed via a `settings.json` stored in the app config directory. The Rust backend handles the saving and loading. Extending this struct automatically enables persistence using the existing logic, maintaining consistency. New frontend command wrappers `get_model_storage_path` and `save_model_storage_path` will be needed.
**Alternatives considered**: Using `localStorage` (banned by constitution).

## Setting the Custom Directory in Fastembed
**Decision**: Provide `cache_dir` parameter natively supported by `fastembed` `InitOptions`.
**Rationale**: `fastembed-rs` provides `with_cache_dir()` when creating the `InitOptions` for `TextEmbedding::try_new`. We will read the setting from `settings.json` prior to engine initialization.
**Alternatives considered**: Environment variables like `HF_HOME`, which bleed to the user's overall OS state. Changing `cache_dir` in `InitOptions` isolates the change strictly to the app.
