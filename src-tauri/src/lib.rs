mod commands;
mod db;
mod error;
mod gpu;
mod monitoring;
mod rocm;
mod system;
mod environments;
mod ai_stack;
mod models;
mod benchmark;

use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let db_path = db::db_path(&app.handle())?;
            let conn = db::open(&db_path)?;
            db::init_schema(&conn)?;
            app.manage(AppState { db: Mutex::new(conn) });

            // Start background metrics sampler — emits "gpu:metrics" every 1s.
            monitoring::spawn_sampler(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // system + gpu
            commands::sys_get_overview,
            commands::sys_get_metrics,
            commands::sys_metrics_history,
            commands::sys_export_metrics,
            // rocm
            commands::rocm_detect,
            commands::rocm_compatibility,
            commands::rocm_repair_dryrun,
            // environments
            commands::env_list,
            commands::env_create,
            commands::env_delete,
            commands::env_packages,
            // ai stack
            commands::stack_detect,
            commands::stack_install,
            // models
            commands::model_search_hf,
            commands::model_ollama_list,
            commands::model_ollama_pull,
            commands::model_ollama_delete,
            // inference
            commands::inference_chat,
            // benchmark
            commands::bench_run_llm,
            commands::bench_history,
            // utility
            commands::open_external,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
