mod lcu;

use tauri::Manager;

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

/// Dernières parties du joueur connecté (historique du profil).
#[tauri::command]
async fn lcu_match_history(state: tauri::State<'_, Lcu>, count: u32) -> Result<Value, String> {
    state.match_history(count).await
}

/// Importe une page de runes dans la page sélectionnée de la draft (ou une page « Spec »).
#[tauri::command]
async fn lcu_set_rune_page(state: tauri::State<'_, Lcu>, champion: String, primary_style: u32, sub_style: u32, perks: Vec<u32>) -> Result<(), String> {
    state.set_rune_page(&champion, primary_style, sub_style, &perks).await
}

/// Détail d'une partie : les 10 joueurs, leurs scores et leurs objets.
#[tauri::command]
async fn lcu_game(state: tauri::State<'_, Lcu>, game_id: u64) -> Result<Value, String> {
    state.game(game_id).await
}

/// Cherche un joueur par son Riot ID (via le client LoL).
#[tauri::command]
async fn lcu_find_player(state: tauri::State<'_, Lcu>, game_name: String, tag_line: String) -> Result<Value, String> {
    state.find_player(&game_name, &tag_line).await
}

/// Profil, rang et dernières parties d'un joueur.
#[tauri::command]
async fn lcu_player(state: tauri::State<'_, Lcu>, puuid: String, count: u32) -> Result<Value, String> {
    state.player(&puuid, count).await
}

/// Choisit les sorts d'invocateur pendant la draft (D puis F).
#[tauri::command]
async fn lcu_set_spells(state: tauri::State<'_, Lcu>, spell1: u32, spell2: u32) -> Result<(), String> {
    state.set_spells(spell1, spell2).await
}

/// Chemin de Spec.exe sur ce PC (affiché dans les réglages, « Ouvrir le dossier »).
#[tauri::command]
fn install_path() -> Result<String, String> {
    std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).map_err(|e| e.to_string())
}

/// Argument ajouté par le lancement au démarrage de Windows : Spec s'ouvre réduit dans la barre des tâches.
const MINIMIZED_ARG: &str = "--minimized";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![MINIMIZED_ARG])))
        .setup(|app| {
            if std::env::args().any(|a| a == MINIMIZED_ARG) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.minimize();
                }
            }
            // mises à jour signées, publiées sur GitHub (voir tauri.conf.json → plugins.updater)
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .manage(Lcu::new())
        .invoke_handler(tauri::generate_handler![
            lcu_get, lcu_preselect, lcu_set_rune_page, lcu_match_history,
            lcu_game, lcu_find_player, lcu_player, lcu_set_spells, install_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
