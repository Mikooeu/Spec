mod lcu;

use lcu::Lcu;
use serde_json::Value;

/// Lecture d'un chemin autorisé du client LoL (voir lcu::READ_PATHS).
#[tauri::command]
async fn lcu_get(state: tauri::State<'_, Lcu>, path: String) -> Result<Value, String> {
    state.get(&path).await
}

/// Présélection (hover) d'un champion. Ne verrouille jamais le pick.
#[tauri::command]
async fn lcu_preselect(state: tauri::State<'_, Lcu>, action_id: u64, champion_id: u32) -> Result<(), String> {
    state.preselect(action_id, champion_id).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // mises à jour signées, publiées sur GitHub (voir tauri.conf.json → plugins.updater)
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .manage(Lcu::new())
        .invoke_handler(tauri::generate_handler![lcu_get, lcu_preselect])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
