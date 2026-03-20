use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use crate::AppError;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatMeta {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub chat_path: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub role: String,
    pub content: String,
    pub sources: Option<Vec<crate::db::store::SearchResult>>,
    pub query: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatData {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub messages: Vec<StoredMessage>,
}

#[tauri::command]
pub fn list_chats(library_path: String, _app: AppHandle) -> Result<Vec<ChatMeta>, AppError> {
    let chats_dir = PathBuf::from(&library_path).join("chats");
    if !chats_dir.exists() {
        return Ok(Vec::new());
    }

    let mut metas = Vec::new();
    let entries = fs::read_dir(chats_dir)
        .map_err(|e| AppError { code: "FS".into(), message: e.to_string() })?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "json") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(data) = serde_json::from_str::<ChatData>(&content) {
                    metas.push(ChatMeta {
                        id: data.id,
                        title: data.title,
                        created_at: data.created_at,
                        chat_path: path.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }

    // Sort newest first
    metas.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(metas)
}

#[tauri::command]
pub fn load_chat(chat_path: String, _app: AppHandle) -> Result<ChatData, AppError> {
    let content = fs::read_to_string(&chat_path)
        .map_err(|e| AppError { code: "FS".into(), message: e.to_string() })?;
    
    let data = serde_json::from_str::<ChatData>(&content)
        .map_err(|e| AppError { code: "PARSE".into(), message: e.to_string() })?;
        
    Ok(data)
}

#[tauri::command]
pub fn save_chat(library_path: String, chat: ChatData, _app: AppHandle) -> Result<(), AppError> {
    let chats_dir = PathBuf::from(&library_path).join("chats");
    if !chats_dir.exists() {
        fs::create_dir_all(&chats_dir)
            .map_err(|e| AppError { code: "FS".into(), message: e.to_string() })?;
    }

    let chat_path = chats_dir.join(format!("{}.json", chat.id));
    let content = serde_json::to_string_pretty(&chat)
        .map_err(|e| AppError { code: "PARSE".into(), message: e.to_string() })?;

    fs::write(&chat_path, content)
        .map_err(|e| AppError { code: "FS".into(), message: e.to_string() })?;

    Ok(())
}

#[tauri::command]
pub fn delete_chat(chat_path: String, _app: AppHandle) -> Result<(), AppError> {
    if PathBuf::from(&chat_path).exists() {
        fs::remove_file(&chat_path)
            .map_err(|e| AppError { code: "FS".into(), message: e.to_string() })?;
    }
    Ok(())
}
