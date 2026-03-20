// Prevents additional console window on Windows in release — DO NOT REMOVE.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

use matthew_lib::embed::engine::EmbedEngine;
use matthew_lib::AppState;
use tauri::Manager;

#[tokio::main]
async fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Only initialize EmbedEngine on startup if BGE-M3 is already cached.
            // If not cached, we leave it as a placeholder to allow instant launch.
            // The user can trigger a download later from the UI.
            if matthew_lib::embed::engine::is_bgem3_cached() {
                tokio::spawn(async move {
                    use fastembed::EmbeddingModel;
                    match EmbedEngine::new_with_progress(handle.clone(), EmbeddingModel::BGEM3).await {
                        Ok(engine) => {
                            let state = handle.state::<AppState>();
                            let mut lock = state.embed_engine.lock().await;
                            *lock = engine;
                        }
                        Err(e) => {
                            eprintln!("Failed to auto-initialise EmbedEngine: {e}");
                        }
                    }
                });
            }

            Ok(())
        })
        .manage(AppState {
            embed_engine:       Arc::new(Mutex::new(EmbedEngine::placeholder())),
            active_db:          Arc::new(RwLock::new(None)),
            active_library_id:  Arc::new(RwLock::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            matthew_lib::commands::ingest::ingest_pdfs,
            matthew_lib::commands::ingest::list_pdfs_in_folder,
            matthew_lib::commands::libraries::list_libraries,
            matthew_lib::commands::libraries::create_library,
            matthew_lib::commands::libraries::open_library,
            matthew_lib::commands::libraries::delete_library,
            matthew_lib::commands::libraries::open_existing_library,
            matthew_lib::commands::libraries::set_library_preset,
            matthew_lib::commands::libraries::set_library_model,
            matthew_lib::commands::libraries::list_ingested_files,
            matthew_lib::commands::query::search_chunks,
            matthew_lib::commands::query::chat_completion,
            matthew_lib::commands::query::save_api_key,
            matthew_lib::commands::query::get_api_key,
            matthew_lib::commands::query::save_model_preference,
            matthew_lib::commands::query::get_model_preference,
            matthew_lib::commands::setup::get_setup_status,
            matthew_lib::commands::setup::list_embedding_models,
            matthew_lib::commands::setup::download_embedding_model,
            matthew_lib::commands::setup::initialize_embedding_model,
            matthew_lib::commands::chats::list_chats,
            matthew_lib::commands::chats::load_chat,
            matthew_lib::commands::chats::save_chat,
            matthew_lib::commands::chats::delete_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
