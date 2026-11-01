//! Connexion au client LoL (LCU).
//!
//! Sécurité :
//! - le client n'écoute que sur 127.0.0.1 ; on n'appelle jamais d'autre hôte ;
//! - seuls quelques chemins en lecture sont autorisés (liste blanche exacte) ;
//! - deux écritures seulement : la présélection (hover) d'un champion, sans jamais envoyer
//!   `completed` (Spec ne verrouille pas un pick), et l'import de runes dans la page sélectionnée
//!   dans la draft (ou une page « Spec » si celle-ci n'est pas modifiable) ; aucune autre page n'est touchée.

use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

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
];

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

fn arg_value<'a>(cmdline: &'a str, key: &str) -> Option<&'a str> {
    let start = cmdline.find(key)? + key.len();
    let rest = &cmdline[start..];
    let end = rest
        .find(|c: char| c == '"' || c.is_whitespace())
        .unwrap_or(rest.len());
    let value = &rest[..end];
    (!value.is_empty()).then_some(value)
}

/// Lit le port et le jeton dans la ligne de commande de LeagueClientUx.
pub fn parse_cmdline(cmdline: &str) -> Option<Creds> {
    let port: u16 = arg_value(cmdline, "--app-port=")?.parse().ok()?;
    let token = arg_value(cmdline, "--remoting-auth-token=")?.to_string();
    (port != 0).then_some(Creds { port, token })
}

fn lockfile_paths() -> &'static [&'static str] {
    if cfg!(target_os = "windows") {
        &[r"C:\Riot Games\League of Legends\lockfile"]
    } else if cfg!(target_os = "macos") {
        &["/Applications/League of Legends.app/Contents/LoL/lockfile"]
    } else {
        &[]
    }
}

fn from_lockfile() -> Option<Creds> {
    lockfile_paths()
        .iter()
        .find_map(|p| std::fs::read_to_string(p).ok().and_then(|s| parse_lockfile(&s)))
}

/// Repli quand le jeu est installé ailleurs : on lit les arguments du processus.
fn from_process() -> Option<Creds> {
    let output = process_list_command().output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .filter(|l| l.contains("LeagueClientUx"))
        .find_map(parse_cmdline)
}

#[cfg(target_os = "windows")]
fn process_list_command() -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine",
    ])
    .creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(target_os = "windows"))]
fn process_list_command() -> Command {
    let mut cmd = Command::new("ps");
    cmd.args(["-A", "-o", "args="]);
    cmd
}

/// Délai minimal entre deux recherches dans la liste des processus (coûteuses sur Windows).
const PROCESS_SCAN_EVERY: Duration = Duration::from_secs(5);

pub struct Lcu {
    client: reqwest::Client,
    creds: Mutex<Option<Creds>>,
    last_scan: Mutex<Option<Instant>>,
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
        Self { client, creds: Mutex::new(None), last_scan: Mutex::new(None) }
    }

    fn creds(&self) -> Option<Creds> {
        if let Some(c) = self.creds.lock().unwrap().clone() {
            return Some(c);
        }
        let found = from_lockfile().or_else(|| {
            let mut last = self.last_scan.lock().unwrap();
            if last.is_some_and(|t| t.elapsed() < PROCESS_SCAN_EVERY) {
                return None;
            }
            *last = Some(Instant::now());
            from_process()
        });
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

    async fn raw(&self, method: reqwest::Method, path: &str, body: Option<&Value>) -> Result<reqwest::Response, String> {
        let resp = self
            .send(|c| {
                let req = self.client.request(method.clone(), format!("https://127.0.0.1:{}{}", c.port, path));
                match body { Some(b) => req.json(b), None => req }
            })
            .await?;
        if resp.status().is_success() { Ok(resp) } else { Err(format!("http_{}", resp.status().as_u16())) }
    }

    /// Écrase la page de runes sélectionnée dans la draft (son nom est gardé). Si elle n'est pas
    /// modifiable (page de Riot), crée une page « Spec » active s'il reste une place.
    pub async fn set_rune_page(&self, primary_style: u32, sub_style: u32, perks: &[u32]) -> Result<(), String> {
        rune_page_body(RUNE_PAGE_NAME, primary_style, sub_style, perks)?; // validation avant tout appel
        let current: Value = match self.raw(reqwest::Method::GET, "/lol-perks/v1/currentpage", None).await {
            Ok(r) => r.json().await.map_err(|_| "bad_json".to_string())?,
            Err(e) if e == "http_404" => Value::Null,
            Err(e) => return Err(e),
        };
        if let Some((id, name)) = editable_current(&current) {
            let mut body = rune_page_body(&name, primary_style, sub_style, perks)?;
            body["id"] = json!(id);
            let path = format!("/lol-perks/v1/pages/{id}");
            if self.raw(reqwest::Method::PUT, &path, Some(&body)).await.is_ok() {
                return Ok(());
            }
            // repli : certaines versions du client refusent PUT, on recrée la même page
            self.raw(reqwest::Method::DELETE, &path, None).await?;
            body.as_object_mut().map(|o| o.remove("id"));
            self.raw(reqwest::Method::POST, "/lol-perks/v1/pages", Some(&body)).await?;
            return Ok(());
        }
        let pages: Value = self.raw(reqwest::Method::GET, "/lol-perks/v1/pages", None).await?
            .json().await.map_err(|_| "bad_json".to_string())?;
        let inventory: Value = self.raw(reqwest::Method::GET, "/lol-perks/v1/inventory", None).await?
            .json().await.map_err(|_| "bad_json".to_string())?;
        if !has_free_slot(&pages, &inventory) {
            return Err("no_editable_page".into());
        }
        let body = rune_page_body(RUNE_PAGE_NAME, primary_style, sub_style, perks)?;
        self.raw(reqwest::Method::POST, "/lol-perks/v1/pages", Some(&body)).await?;
        Ok(())
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
    fn cmdline_mac_and_windows() {
        let mac = "/Applications/League of Legends.app/Contents/LoL/LeagueClient.app/Contents/LoL/LeagueClientUx --remoting-auth-token=XyZ123 --app-port=60123 --install-directory=/Applications";
        assert_eq!(parse_cmdline(mac), Some(Creds { port: 60123, token: "XyZ123".into() }));
        let win = r#""C:/Riot Games/League of Legends/LeagueClientUx.exe" "--remoting-auth-token=AbC" "--app-port=50001""#;
        assert_eq!(parse_cmdline(win), Some(Creds { port: 50001, token: "AbC".into() }));
        assert_eq!(parse_cmdline("LeagueClientUx --app-port=1"), None);
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
        assert_eq!(lcu.set_rune_page(8100, 8100, &[]).await, Err("bad_page".into()));
    }
}
