//! Connexion au client LoL (LCU).
//!
//! Sécurité :
//! - le client n'écoute que sur 127.0.0.1 ; on n'appelle jamais d'autre hôte ;
//! - seuls quelques chemins en lecture sont autorisés (liste blanche exacte) ;
//! - la seule écriture possible est la présélection (hover) d'un champion :
//!   on n'envoie jamais `completed`, donc Spec ne peut pas verrouiller un pick.

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

    #[tokio::test]
    async fn rejects_forbidden_path_before_any_call() {
        let lcu = Lcu::new();
        assert_eq!(lcu.get("/lol-login/v1/session").await, Err("forbidden_path".into()));
        assert_eq!(lcu.preselect(1, 0).await, Err("bad_champion".into()));
    }
}
