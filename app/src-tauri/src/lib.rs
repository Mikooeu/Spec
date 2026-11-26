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

/// Accepte la partie trouvée (sur clic du joueur).
#[tauri::command]
async fn lcu_accept_queue(state: tauri::State<'_, Lcu>) -> Result<(), String> {
    state.accept_ready_check().await
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

/// Timeline d'une partie terminée (or et CS minute par minute).
#[tauri::command]
async fn lcu_timeline(state: tauri::State<'_, Lcu>, game_id: u64) -> Result<Value, String> {
    state.timeline(game_id).await
}

/// Partie en cours : ton niveau, ton or, tes objets et les champions adverses (API locale du jeu).
#[tauri::command]
async fn live_game(state: tauri::State<'_, Lcu>) -> Result<Value, String> {
    state.live_game().await
}

/// Fenêtres par-dessus le jeu : « overlay » (stats en partie) et « loading » (écran de chargement).
/// Plein écran sur l'écran principal, transparentes, toujours au premier plan, et les clics passent au travers :
/// l'interface se place elle-même selon la taille de l'écran. Le jeu doit être en Sans bordure ou Fenêtré.
fn overlay_label(kind: &str) -> Result<&'static str, String> {
    match kind {
        "overlay" => Ok("overlay"), "loading" => Ok("loading"),
        "compact" => Ok("compact"), "bubble" => Ok("bubble"), "build" => Ok("build"),
        _ => Err("bad_kind".into()),
    }
}

/// Fenêtres d'appoint qui s'ouvrent en plus de la fenêtre principale, sans la déplacer :
/// « compact » (collée au client pendant la draft), « bubble » (bulle posée sur le client),
/// « build » (menu de build seul, affiché par-dessus le jeu avec le raccourci).
/// Elles s'ouvrent cachées : l'interface se place puis s'affiche elle-même.
fn side_window(app: &tauri::AppHandle, label: &'static str) -> Result<(), String> {
    let url = tauri::WebviewUrl::App(format!("index.html?view={label}").into());
    let builder = tauri::WebviewWindowBuilder::new(app, label, url)
        .title("Spec")
        .decorations(false)
        .always_on_top(true)
        .visible(false);
    let builder = match label {
        "compact" => builder.inner_size(400.0, 720.0).min_inner_size(360.0, 560.0).resizable(true).focused(false),
        "bubble" => builder.inner_size(380.0, 76.0).resizable(false).skip_taskbar(true).shadow(false).focused(false),
        _ => {
            let (w, h) = build_size(app);
            // comme Porofessor : un écran posé devant le jeu, qui ne prend ni le clavier ni la souris
            builder.inner_size(w, h).resizable(false).skip_taskbar(true).shadow(false).focused(false).focusable(false).center()
        }
    };
    #[cfg(not(target_os = "macos"))]
    let builder = if label == "compact" { builder } else { builder.transparent(true) };
    builder.build().map(|_| ()).map_err(|e| e.to_string())
}

/// Taille du menu de build : une grande part de l'écran (en points logiques), pour qu'il s'adapte du 1080p au 4K.
fn build_size(app: &tauri::AppHandle) -> (f64, f64) {
    match app.primary_monitor() {
        Ok(Some(m)) => {
            let scale = m.scale_factor();
            let (sw, sh) = (m.size().width as f64 / scale, m.size().height as f64 / scale);
            ((sw * 0.72).clamp(1000.0, 1800.0), (sh * 0.8).clamp(600.0, 1200.0))
        }
        _ => (1060.0, 640.0),
    }
}

/// Raccourci en partie : affiche le menu de build, ou le cache s'il est déjà affiché.
/// La fenêtre est gardée cachée plutôt que fermée : un nouvel appui ne tombe jamais sur une fenêtre en train de se fermer.
/// Raccourci en partie (Windows). Le jeu ignore les raccourcis globaux des autres applis quand il est au premier plan
/// (RegisterHotKey ne reçoit rien) : pendant la partie, Spec regarde donc l'état des seules touches du raccourci,
/// toutes les 25 ms, et prévient la fenêtre principale à l'appui. Rien n'est enregistré ni envoyé ailleurs.
#[derive(Default)]
struct InGameShortcut(std::sync::Mutex<Option<std::sync::Arc<std::sync::atomic::AtomicBool>>>);

#[cfg(windows)]
fn parse_accel(accel: &str) -> Option<(Vec<i32>, i32)> {
    let mut mods = Vec::new();
    let mut key = None;
    for part in accel.split('+').map(str::trim) {
        match part.to_ascii_lowercase().as_str() {
            "control" | "ctrl" => mods.push(0x11),
            "alt" => mods.push(0x12),
            "shift" => mods.push(0x10),
            p if p.len() == 1 && p.chars().all(|c| c.is_ascii_alphanumeric()) => key = Some(p.to_ascii_uppercase().as_bytes()[0] as i32),
            p if p.starts_with('f') => key = p[1..].parse::<i32>().ok().filter(|n| (1..=24).contains(n)).map(|n| 0x6F + n),
            _ => return None,
        }
    }
    key.map(|k| (mods, k))
}

#[tauri::command]
fn ingame_shortcut(app: tauri::AppHandle, state: tauri::State<'_, InGameShortcut>, accel: Option<String>) -> bool {
    use std::sync::atomic::Ordering;
    let mut cur = state.0.lock().unwrap();
    if let Some(stop) = cur.take() { stop.store(true, Ordering::Relaxed); }
    #[cfg(windows)]
    {
        use tauri::Emitter;
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
        let Some((mods, key)) = accel.as_deref().and_then(parse_accel) else { return false };
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        *cur = Some(stop.clone());
        std::thread::spawn(move || {
            let down = |vk: i32| unsafe { (GetAsyncKeyState(vk) as u16 & 0x8000) != 0 };
            let mut was = false;
            while !stop.load(Ordering::Relaxed) {
                // exactement ces modificateurs : Ctrl + Alt + S ne déclenche pas Alt + S
                let extra = [0x10, 0x11, 0x12].iter().any(|m| !mods.contains(m) && down(*m));
                let now = !extra && mods.iter().all(|m| down(*m)) && down(key);
                if now && !was { let _ = app.emit("spec-ingame-shortcut", ()); }
                was = now;
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
        });
        return true;
    }
    #[cfg(not(windows))]
    { let _ = (app, accel); false }
}

#[tauri::command]
async fn overlay_toggle(app: tauri::AppHandle, kind: String) -> Result<bool, String> {
    let label = overlay_label(&kind)?;
    if label != "build" { return Err("unsupported".into()); }
    if let Some(w) = app.get_webview_window(label) {
        if w.is_visible().unwrap_or(false) {
            w.hide().map_err(|e| e.to_string())?;
            return Ok(false);
        }
        let (bw, bh) = build_size(&app);
        let _ = w.set_size(tauri::LogicalSize::new(bw, bh));
        let _ = w.center();
        show_passive(&w)?;
        return Ok(true);
    }
    side_window(&app, label)?;
    match app.get_webview_window(label) {
        Some(w) => show_passive(&w)?,
        None => return Err("build_window".into()),
    }
    Ok(true)
}

/// Affiche le menu de build sans activer sa fenêtre : League of Legends garde le clavier et la souris
/// (la caméra bouge toujours au bord de l'écran, les clics passent au jeu). Le raccourci le referme.
fn show_passive(w: &tauri::WebviewWindow) -> Result<(), String> {
    let _ = w.set_ignore_cursor_events(true);
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
        let hwnd = w.hwnd().map_err(|e| e.to_string())?;
        unsafe { ShowWindow(hwnd.0 as _, SW_SHOWNOACTIVATE) };
        return Ok(());
    }
    #[cfg(not(windows))]
    w.show().map_err(|e| e.to_string())
}

#[tauri::command]
async fn overlay_open(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    let label = overlay_label(&kind)?;
    if let Some(w) = app.get_webview_window(label) {
        return w.show().map_err(|e| e.to_string());
    }
    if matches!(label, "compact" | "bubble" | "build") {
        return side_window(&app, label);
    }
    let monitor = app.primary_monitor().map_err(|e| e.to_string())?.ok_or("no_monitor")?;
    let (size, pos, scale) = (monitor.size(), monitor.position(), monitor.scale_factor());
    let url = tauri::WebviewUrl::App(format!("index.html?view={label}").into());
    let builder = tauri::WebviewWindowBuilder::new(&app, label, url)
        .title("Spec")
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .position(pos.x as f64 / scale, pos.y as f64 / scale)
        .inner_size(size.width as f64 / scale, size.height as f64 / scale);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);
    let w = builder.build().map_err(|e| e.to_string())?;
    w.set_ignore_cursor_events(true).map_err(|e| e.to_string())
}

/// Mode déplacement : la fenêtre reçoit les clics le temps de glisser l'overlay, puis les laisse repasser au jeu.
#[tauri::command]
fn overlay_interactive(app: tauri::AppHandle, kind: String, on: bool) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(overlay_label(&kind)?) {
        w.set_ignore_cursor_events(!on).map_err(|e| e.to_string())?;
        if on { let _ = w.set_focus(); }
    }
    Ok(())
}

#[tauri::command]
fn overlay_close(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(overlay_label(&kind)?) {
        // masquée tout de suite, même si la fermeture tarde
        let _ = w.hide();
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Cherche un joueur par son Riot ID (via le client LoL).
#[tauri::command]
async fn lcu_find_player(state: tauri::State<'_, Lcu>, game_name: String, tag_line: String) -> Result<Value, String> {
    state.find_player(&game_name, &tag_line).await
}

/// Le jeu est-il réglé en Plein écran ? (None si le client ne donne pas le réglage)
#[tauri::command]
async fn lcu_window_mode(state: tauri::State<'_, Lcu>) -> Result<Option<bool>, String> {
    Ok(state.window_mode().await?.map(|m| m == lcu::WINDOW_FULLSCREEN))
}

/// Passe le jeu en Sans bordure (clic du joueur pendant la draft).
#[tauri::command]
async fn lcu_set_borderless(state: tauri::State<'_, Lcu>) -> Result<(), String> {
    state.set_borderless().await
}

/// Amis du client (Riot ID, icône, statut), pour la recherche de joueur.
#[tauri::command]
async fn lcu_friends(state: tauri::State<'_, Lcu>) -> Result<Value, String> {
    state.friends().await
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

/// Set d'objets de Spec dans le shop (remplace seulement le set de Spec, jamais ceux du joueur).
#[tauri::command]
async fn lcu_set_item_set(state: tauri::State<'_, Lcu>, champion: u32, title: String, blocks: Vec<lcu::ItemBlock>) -> Result<(), String> {
    state.set_item_set(champion, &title, &blocks).await
}

/// Chemin de Spec.exe sur ce PC (affiché dans les réglages, « Ouvrir le dossier »).
/// Position et taille de la fenêtre du client LoL (pixels de l'écran), pour coller le mode compact à côté.
/// Ne lit que le rectangle de la fenêtre : rien n'est envoyé au client ni lu dans le jeu.
#[tauri::command]
fn client_window() -> Option<[i32; 4]> {
    client_rect()
}

#[cfg(windows)]
fn client_rect() -> Option<[i32; 4]> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowRect, IsIconic, IsWindowVisible};
    let class: Vec<u16> = "RCLIENT\0".encode_utf16().collect();
    unsafe {
        let hwnd = FindWindowW(class.as_ptr(), std::ptr::null());
        if hwnd.is_null() || IsIconic(hwnd) != 0 || IsWindowVisible(hwnd) == 0 {
            return None;
        }
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        if GetWindowRect(hwnd, &mut r) == 0 || r.right <= r.left || r.bottom <= r.top {
            return None;
        }
        Some([r.left, r.top, r.right - r.left, r.bottom - r.top])
    }
}

#[cfg(not(windows))]
fn client_rect() -> Option<[i32; 4]> {
    None
}

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
            // la version s'affiche à côté du nom, dans la barre de titre de la fenêtre
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&format!("Spec V{}", app.package_info().version));
            }
            if std::env::args().any(|a| a == MINIMIZED_ARG) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.minimize();
                }
            }
            // mises à jour signées, publiées sur GitHub (voir tauri.conf.json → plugins.updater)
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            // raccourci global (réglable) pour afficher ou cacher Spec, par exemple le menu de build en partie
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
            Ok(())
        })
        .manage(Lcu::new())
        .manage(InGameShortcut::default())
        .invoke_handler(tauri::generate_handler![
            lcu_get, lcu_preselect, lcu_accept_queue, lcu_set_rune_page, lcu_match_history,
            lcu_game, lcu_timeline, lcu_find_player, lcu_player, lcu_window_mode, lcu_set_borderless, lcu_friends, lcu_set_spells, lcu_set_item_set, live_game, overlay_open,
            overlay_toggle, ingame_shortcut, overlay_close, overlay_interactive, install_path, client_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
