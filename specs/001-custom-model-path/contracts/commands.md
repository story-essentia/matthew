# Interface Contracts: Current Feature

## New Tauri Commands

### `save_model_storage_path`
```rust
#[tauri::command]
pub async fn save_model_storage_path(
    path: String,
    app: tauri::AppHandle
) -> Result<(), AppError>
```
Saves the directory to `settings.json`. Empty strings represent `None` (reset to default).

### `get_model_storage_path`
```rust
#[tauri::command]
pub async fn get_model_storage_path(
    app: tauri::AppHandle
) -> Result<Option<String>, AppError>
```
Returns the currently stored path.

## TypeScript Command Wrappers
Location: `src/lib/tauri.ts`

```ts
export async function getModelStoragePath(): Promise<string | null> {
  return invoke('get_model_storage_path');
}

export async function saveModelStoragePath(path: string): Promise<void> {
  return invoke('save_model_storage_path', { path });
}
```
