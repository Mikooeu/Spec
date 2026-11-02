//! Connexion au client LoL (LCU).
//!
//! Sécurité :
//! - le client n'écoute que sur 127.0.0.1 ; on n'appelle jamais d'autre hôte ;
//! - seuls quelques chemins en lecture sont autorisés (liste blanche exacte) ;
//! - deux écritures seulement : la présélection (hover) d'un champion, sans jamais envoyer
//!   `completed` (Spec ne verrouille pas un pick), et l'import de runes dans la page sélectionnée
//!   dans la draft (ou une page « Spec » si celle-ci n'est pas modifiable) ; aucune autre page n'est touchée.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};

#[derive(Clone, Debug, PartialEq)]
pub struct Creds {
    pub port: u16,
    pub token: String,
}

/// Chemins lisibles depuis l'interface. Comparaison exacte : pas de paramètres, pas de `..`.
pub const READ_PATHS: &[&str] = &[
    "/lol-gameflow/v1/gameflow-phase",
    "/lol-summoner/v1/current-summoner",
    "/riotclient/region-locale",
    "/lol-champ-select/v1/session",
    "/lol-ranked/v1/current-ranked-stats",   // rang et LP (profil, suivi des LP)
    "/lol-game-queues/v1/queues",            // noms des files (Solo/Duo, Flex, 5c5)
];

/// Historique de parties du joueur connecté, au plus 50 parties (chemin construit ici, jamais par l'appli).
pub fn match_history_path(count: u32) -> String {
    let end = count.clamp(1, 50);
    format!("/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex={end}")
}

pub fn is_allowed(path: &str) -> bool {
    READ_PATHS.contains(&path)
}

/// Format du lockfile : `nom:pid:port:motdepasse:protocole`.
/// On lit depuis la droite au cas où le nom contiendrait « : ».
pub fn parse_lockfile(content: &str) -> Option<Creds> {
    let mut parts = content.trim().rsplitn(5, ':');
    let _protocol = parts.next()?;
    let token = parts.next()?.to_string();
    let port: u16 = parts.next()?.parse().ok()?;
    let _pid = parts.next()?;
    parts.next()?; // nom
    if token.is_empty() || port == 0 {
        return None;
    }
    Some(Creds { port, token })
}

/// Chemin d'installation lu dans le fichier de réglages du jeu tenu par le client Riot
/// (`product_install_full_path: "C:/Riot Games/League of Legends"`).
pub fn parse_product_settings(text: &str) -> Option<String> {
    text.lines().find_map(|l| {
        let v = l.trim().strip_prefix("product_install_full_path:")?.trim().trim_matches(|c| c == '"' || c == '\'');
        (!v.is_empty()).then(|| v.to_string())
    })
}

/// Dossiers de jeu listés par le client Riot dans RiotClientInstalls.json (clés de `associated_client`).
pub fn parse_client_installs(json_text: &str) -> Vec<String> {
    serde_json::from_str::<Value>(json_text).ok()
        .and_then(|v| v["associated_client"].as_object().map(|o| o.keys().cloned().collect::<Vec<String>>()))
        .unwrap_or_default()
        .into_iter()
        .filter(|k: &String| k.contains("League of Legends"))
        .collect()
}

/// Emplacement du lockfile pour un dossier d'installation.
pub fn lockfile_in(dir: &str) -> PathBuf {
    let dir = dir.trim_end_matches(['/', '\\']);
    if dir.ends_with(".app") {
        Path::new(dir).join("Contents").join("LoL").join("lockfile")
    } else {
        Path::new(dir).join("lockfile")
    }
}

/// Fichiers où le client Riot note l'emplacement du jeu. Spec lit seulement ces fichiers :
/// aucun programme n'est lancé et aucun autre processus n'est inspecté.
fn riot_metadata_files() -> (PathBuf, PathBuf) {
    let base = if cfg!(target_os = "windows") {
        PathBuf::from(std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".into())).join("Riot Games")
    } else {
        PathBuf::from("/Users/Shared/Riot Games")
    };
    (
        base.join("Metadata").join("league_of_legends.live").join("league_of_legends.live.product_settings.yaml"),
        base.join("RiotClientInstalls.json"),
    )
}

fn install_dirs() -> Vec<String> {
    let mut dirs: Vec<String> = if cfg!(target_os = "windows") {
        vec![r"C:\Riot Games\League of Legends".into()]
    } else if cfg!(target_os = "macos") {
        vec!["/Applications/League of Legends.app".into()]
    } else {
        vec![]
    };
    let (settings, installs) = riot_metadata_files();
    if let Some(d) = std::fs::read_to_string(settings).ok().as_deref().and_then(parse_product_settings) {
        dirs.insert(0, d);
    }
    if let Ok(text) = std::fs::read_to_string(installs) {
        dirs.extend(parse_client_installs(&text));
    }
    dirs
}

fn from_lockfile() -> Option<Creds> {
    install_dirs()
        .iter()
        .find_map(|d| std::fs::read_to_string(lockfile_in(d)).ok().and_then(|s| parse_lockfile(&s)))
}

pub struct Lcu {
    client: reqwest::Client,
    creds: Mutex<Option<Creds>>,
}

impl Default for Lcu {
    fn default() -> Self {
        Self::new()
    }
}

impl Lcu {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            // le client LoL utilise un certificat auto-signé ; on ne contacte que 127.0.0.1
            .danger_accept_invalid_certs(true)
            .no_proxy()
            .timeout(Duration::from_secs(3))
            .build()
            .expect("client HTTP");
        Self { client, creds: Mutex::new(None) }
    }

    fn creds(&self) -> Option<Creds> {
        if let Some(c) = self.creds.lock().unwrap().clone() {
            return Some(c);
        }
        let found = from_lockfile();
        *self.creds.lock().unwrap() = found.clone();
        found
    }

    fn forget(&self) {
        *self.creds.lock().unwrap() = None;
    }

    async fn send(&self, req: impl Fn(&Creds) -> reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
        let creds = self.creds().ok_or("not_running")?;
        match req(&creds).basic_auth("riot", Some(&creds.token)).send().await {
            Ok(resp) if resp.status() == reqwest::StatusCode::UNAUTHORIZED => {
                // jeton périmé (client relancé) : on relira le lockfile au prochain appel
                self.forget();
                Err("not_running".into())
            }
            Ok(resp) => Ok(resp),
            Err(_) => {
                self.forget();
                Err("not_running".into())
            }
        }
    }

    pub async fn get(&self, path: &str) -> Result<Value, String> {
        if !is_allowed(path) {
            return Err("forbidden_path".into());
        }
        let resp = self
            .send(|c| self.client.get(format!("https://127.0.0.1:{}{}", c.port, path)))
            .await?;
        match resp.status().as_u16() {
            200..=299 => resp.json().await.map_err(|_| "bad_json".into()),
            404 => Err("not_found".into()),
            code => Err(format!("http_{code}")),
        }
    }

    /// Dernières parties du joueur connecté.
    pub async fn match_history(&self, count: u32) -> Result<Value, String> {
        let path = match_history_path(count);
        let resp = self
            .send(|c| self.client.get(format!("https://127.0.0.1:{}{}", c.port, path)))
            .await?;
        match resp.status().as_u16() {
            200..=299 => resp.json().await.map_err(|_| "bad_json".into()),
            code => Err(format!("http_{code}")),
        }
    }

    async fn raw(&self, method: reqwest::Method, path: &str, body: Option<&Value>) -> Result<reqwest::Response, String> {
        let resp = self
            .send(|c| {
                let req = self.client.request(method.clone(), format!("https://127.0.0.1:{}{}", c.port, path));
                match body { Some(b) => req.json(b), None => req }
            })
            .await?;
        if resp.status().is_success() { Ok(resp) } else { Err(format!("http_{}", resp.status().as_u16())) }
    }

    /// Écrase la page de runes sélectionnée dans la draft et la renomme « Spec : Ahri runes ».
    /// Si elle n'est pas modifiable (page de Riot), crée cette page s'il reste une place.
    /// Si le client refuse le nom (trop long), on réessaie avec « Spec : Ahri ».
    pub async fn set_rune_page(&self, champion: &str, primary_style: u32, sub_style: u32, perks: &[u32]) -> Result<(), String> {
        rune_page_body(RUNE_PAGE_NAME, primary_style, sub_style, perks)?; // validation avant tout appel
        let names = page_names(champion);
        let current: Value = match self.raw(reqwest::Method::GET, "/lol-perks/v1/currentpage", None).await {
            Ok(r) => r.json().await.map_err(|_| "bad_json".to_string())?,
            Err(e) if e == "http_404" => Value::Null,
            Err(e) => return Err(e),
        };
        if let Some((id, _old_name)) = editable_current(&current) {
            let path = format!("/lol-perks/v1/pages/{id}");
            for name in &names {
                let mut body = rune_page_body(name, primary_style, sub_style, perks)?;
                body["id"] = json!(id);
                if self.raw(reqwest::Method::PUT, &path, Some(&body)).await.is_ok() {
                    return Ok(());
                }
            }
            // repli : certaines versions du client refusent PUT, on recrée la page au même endroit
            self.raw(reqwest::Method::DELETE, &path, None).await?;
            return self.post_page(&names, primary_style, sub_style, perks).await;
        }
        let pages: Value = self.raw(reqwest::Method::GET, "/lol-perks/v1/pages", None).await?
            .json().await.map_err(|_| "bad_json".to_string())?;
        let inventory: Value = self.raw(reqwest::Method::GET, "/lol-perks/v1/inventory", None).await?
            .json().await.map_err(|_| "bad_json".to_string())?;
        if !has_free_slot(&pages, &inventory) {
            return Err("no_editable_page".into());
        }
        self.post_page(&names, primary_style, sub_style, perks).await
    }

    /// Crée la page active, avec le premier nom accepté par le client.
    async fn post_page(&self, names: &[String], primary_style: u32, sub_style: u32, perks: &[u32]) -> Result<(), String> {
        let mut last = "no_name".to_string();
        for name in names {
            let body = rune_page_body(name, primary_style, sub_style, perks)?;
            match self.raw(reqwest::Method::POST, "/lol-perks/v1/pages", Some(&body)).await {
                Ok(_) => return Ok(()),
                Err(e) => last = e,
            }
        }
        Err(last)
    }

    /// Survole un champion pour l'action de pick donnée. Ne verrouille jamais.
    pub async fn preselect(&self, action_id: u64, champion_id: u32) -> Result<(), String> {
        if champion_id == 0 || champion_id > 9999 {
            return Err("bad_champion".into());
        }
        let body = preselect_body(champion_id);
        let resp = self
            .send(|c| {
                self.client
                    .patch(format!(
                        "https://127.0.0.1:{}/lol-champ-select/v1/session/actions/{}",
                        c.port, action_id
                    ))
                    .json(&body)
            })
            .await?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(format!("http_{}", resp.status().as_u16()))
        }
    }
}

pub const RUNE_PAGE_NAME: &str = "Spec";

/// Noms à essayer, du plus complet au plus court : « Spec : Ahri runes », « Spec : Ahri », « Spec ».
/// Le nom du champion est nettoyé (lettres, espaces, apostrophes, « & » et « . » seulement).
pub fn page_names(champion: &str) -> Vec<String> {
    let clean: String = champion
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '\'' | '’' | '&' | '.'))
        .take(20)
        .collect();
    let clean = clean.trim();
    if clean.is_empty() {
        return vec![RUNE_PAGE_NAME.to_string()];
    }
    vec![format!("{RUNE_PAGE_NAME} : {clean} runes"), format!("{RUNE_PAGE_NAME} : {clean}"), RUNE_PAGE_NAME.to_string()]
}

/// Corps d'une page de runes : 4 runes de l'arbre principal (rune clé d'abord), 2 du secondaire,
/// 3 fragments. Les identifiants sont vérifiés pour qu'aucune autre donnée ne parte au client.
pub fn rune_page_body(name: &str, primary_style: u32, sub_style: u32, perks: &[u32]) -> Result<Value, String> {
    let style_ok = |s: u32| (8000..=8499).contains(&s);
    let perk_ok = |p: u32| (5000..=9999).contains(&p);
    if !style_ok(primary_style) || !style_ok(sub_style) || primary_style == sub_style
        || perks.len() != 9 || !perks.iter().all(|&p| perk_ok(p)) {
        return Err("bad_page".into());
    }
    let name: String = name.chars().filter(|c| !c.is_control()).take(40).collect();
    Ok(json!({
        "name": if name.trim().is_empty() { RUNE_PAGE_NAME.to_string() } else { name },
        "primaryStyleId": primary_style,
        "subStyleId": sub_style,
        "selectedPerkIds": perks,
        "current": true,
    }))
}

/// Page sélectionnée dans la draft, si c'est une page du joueur qu'on peut écraser : (id, nom).
pub fn editable_current(current: &Value) -> Option<(u64, String)> {
    let editable = current["isEditable"] == true && current["isDeletable"] == true;
    let id = current["id"].as_u64()?;
    editable.then(|| (id, current["name"].as_str().unwrap_or(RUNE_PAGE_NAME).to_string()))
}

/// Reste-t-il une place pour une page personnalisée ?
pub fn has_free_slot(pages: &Value, inventory: &Value) -> bool {
    let owned = inventory["ownedPageCount"].as_u64().unwrap_or(0);
    let custom = pages.as_array().map_or(0, |a| a.iter().filter(|p| p["isDeletable"] == true).count() as u64);
    custom < owned
}

/// Corps de la requête de présélection : uniquement `championId`, jamais `completed`.
pub fn preselect_body(champion_id: u32) -> Value {
    json!({ "championId": champion_id })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lockfile_ok() {
        let c = parse_lockfile("LeagueClient:12345:54321:AbC-dEf_123:https\n").unwrap();
        assert_eq!(c, Creds { port: 54321, token: "AbC-dEf_123".into() });
    }

    #[test]
    fn lockfile_bad() {
        assert!(parse_lockfile("").is_none());
        assert!(parse_lockfile("LeagueClient:1:notaport:tok:https").is_none());
        assert!(parse_lockfile("LeagueClient:1:54321::https").is_none());
        assert!(parse_lockfile("1:54321:tok:https").is_none());
    }

    #[test]
    fn install_path_from_riot_metadata() {
        let yaml = "auto_patching_enabled_by_player: true\nproduct_install_full_path: \"D:/Jeux/Riot Games/League of Legends\"\nproduct_install_root: \"D:/Jeux\"\n";
        assert_eq!(parse_product_settings(yaml).as_deref(), Some("D:/Jeux/Riot Games/League of Legends"));
        assert_eq!(parse_product_settings("rien: ici"), None);
        let installs = r#"{"associated_client": {"D:/Jeux/Riot Games/League of Legends/": "D:/Jeux/Riot Client/RiotClientServices.exe",
                             "D:/Jeux/Riot Games/VALORANT/live/": "x"}, "rc_default": "x"}"#;
        assert_eq!(parse_client_installs(installs), vec!["D:/Jeux/Riot Games/League of Legends/".to_string()]);
        assert!(parse_client_installs("pas du json").is_empty());
        assert_eq!(lockfile_in("D:/Jeux/Riot Games/League of Legends/"), Path::new("D:/Jeux/Riot Games/League of Legends").join("lockfile"));
        assert_eq!(lockfile_in("/Applications/League of Legends.app"),
                   Path::new("/Applications/League of Legends.app/Contents/LoL/lockfile"));
    }

    #[test]
    fn whitelist_is_exact() {
        assert!(is_allowed("/lol-champ-select/v1/session"));
        assert!(!is_allowed("/lol-champ-select/v1/session/actions/1"));
        assert!(!is_allowed("/lol-champ-select/v1/session?x=1"));
        assert!(!is_allowed("/lol-login/v1/session"));
        assert!(!is_allowed("/lol-champ-select/v1/session/../../lol-login/v1/session"));
        assert!(!is_allowed("http://evil.example/"));
    }

    #[test]
    fn preselect_never_locks() {
        let body = preselect_body(103);
        assert_eq!(body, json!({ "championId": 103 }));
        assert!(body.get("completed").is_none());
    }

    #[test]
    fn rune_page_is_validated_and_named_spec() {
        let perks = [8112, 8139, 8138, 8135, 8210, 8233, 5008, 5008, 5011];
        let body = rune_page_body("Ma page mid", 8100, 8200, &perks).unwrap();
        assert_eq!(body["name"], "Ma page mid");
        assert_eq!(rune_page_body("  ", 8100, 8200, &perks).unwrap()["name"], "Spec");
        assert_eq!(body["selectedPerkIds"], json!(perks));
        assert_eq!(body["current"], true);
        assert!(rune_page_body("x", 8100, 8100, &perks).is_err());          // même arbre deux fois
        assert!(rune_page_body("x", 8100, 8200, &perks[..8]).is_err());     // page incomplète
        assert!(rune_page_body("x", 1, 8200, &perks).is_err());
        assert!(rune_page_body("x", 8100, 8200, &[0, 8139, 8138, 8135, 8210, 8233, 5008, 5008, 5011]).is_err());
    }

    #[test]
    fn match_history_path_is_bounded() {
        assert!(match_history_path(20).ends_with("begIndex=0&endIndex=20"));
        assert!(match_history_path(5000).ends_with("endIndex=50"));
        assert!(match_history_path(0).ends_with("endIndex=1"));
        assert!(!is_allowed(&match_history_path(20)));   // pas lisible via lcu_get
        assert!(is_allowed("/lol-ranked/v1/current-ranked-stats"));
    }

    #[test]
    fn rune_page_names_follow_spec_format() {
        assert_eq!(page_names("Ahri"), vec!["Spec : Ahri runes", "Spec : Ahri", "Spec"]);
        assert_eq!(page_names("Nunu & Willump")[0], "Spec : Nunu & Willump runes");
        assert_eq!(page_names("Kai'Sa")[1], "Spec : Kai'Sa");
        assert_eq!(page_names("<script>\n"), vec!["Spec : script runes", "Spec : script", "Spec"]);
        assert_eq!(page_names("  "), vec!["Spec"]);
    }

    #[test]
    fn only_the_selected_player_page_is_overwritten() {
        let mine = json!({"id": 7, "name": "Mid Ahri", "isEditable": true, "isDeletable": true});
        assert_eq!(editable_current(&mine), Some((7, "Mid Ahri".to_string())));
        // page recommandée par Riot ou page de base : jamais écrasée
        assert_eq!(editable_current(&json!({"id": 50, "name": "Domination", "isEditable": false, "isDeletable": false})), None);
        assert_eq!(editable_current(&Value::Null), None);
        let pages = json!([{"isDeletable": true}, {"isDeletable": true}, {"isDeletable": false}]);
        assert!(has_free_slot(&json!([{"isDeletable": true}]), &json!({"ownedPageCount": 2})));
        assert!(!has_free_slot(&pages, &json!({"ownedPageCount": 2})));
        assert!(!has_free_slot(&json!([]), &json!({})));
    }

    #[tokio::test]
    async fn rejects_forbidden_path_before_any_call() {
        let lcu = Lcu::new();
        assert_eq!(lcu.get("/lol-login/v1/session").await, Err("forbidden_path".into()));
        assert_eq!(lcu.preselect(1, 0).await, Err("bad_champion".into()));
        assert_eq!(lcu.set_rune_page("Ahri", 8100, 8100, &[]).await, Err("bad_page".into()));
    }
}
