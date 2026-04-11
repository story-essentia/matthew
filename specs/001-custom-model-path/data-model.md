# Data Model: Custom Model Storage Path

## Entities

### `AppSettings` (Rust Backend)
Location: `src-tauri/src/commands/query.rs`

Modified:
Add `model_storage_path: Option<String>` with `#[serde(rename_all = "camelCase")]` rules.

```rust
#[derive(serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    api_key: Option<String>,
    model: Option<String>,
    model_storage_path: Option<String>, // [NEW] Allows user-chosen directory
}
```

## Validation Rules
- When saving `model_storage_path`, ensure the path exists or attempt to create it. If it fails, return an `AppError` to the frontend.
- When loading `InitOptions` for `fastembed`, if `model_storage_path` is present and valid, apply it using `.with_cache_dir(Path::new(&path))`.
