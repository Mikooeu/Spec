//! Connexion au client LoL (LCU).
//!
//! Sécurité :
//! - le client n'écoute que sur 127.0.0.1 ; on n'appelle jamais d'autre hôte ;
//! - seuls quelques chemins en lecture sont autorisés (liste blanche exacte) ;
//! - quelques lectures construites ici à partir d'identifiants validés (détail d'une partie, profil,
//!   rang et historique d'un joueur cherché par son Riot ID), comme le fait le client dans son profil ;
//! - trois écritures seulement : la présélection (hover) d'un champion, sans jamais envoyer
//!   `completed` (Spec ne verrouille pas un pick), l'import de runes dans la page sélectionnée
//!   dans la draft (ou une page « Spec » si celle-ci n'est pas modifiable ; aucune autre page n'est touchée),
//!   et le choix des deux sorts d'invocateur pendant la draft.

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
    "/lol-gameflow/v1/session",              // les 10 joueurs de la partie, à l'écran de chargement
    "/lol-perks/v1/currentpage",             // tes runes, à l'écran de chargement
    "/lol-matchmaking/v1/ready-check",       // partie trouvée : déjà acceptée ou non
];

/// Profil, rang et historique (au plus 100 parties) d'un joueur (chemin construit ici, jamais par l'appli).
pub fn match_history_path(count: u32) -> String {
    let end = count.clamp(1, 50);
    format!("/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex={end}")
}

/// Encodage d'un morceau d'URL : tout sauf les caractères non réservés.
fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Identifiant de joueur du client (UUID) : lettres, chiffres, « - » et « _ » seulement.
pub fn valid_puuid(p: &str) -> bool {
    (20..=100).contains(&p.len()) && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Riot ID : nom de 3 à 16 caractères (sans « # », « / », « ? » ni caractère de contrôle), tag de 2 à 5 lettres ou chiffres.
pub fn valid_riot_id(name: &str, tag: &str) -> bool {
    let n = name.chars().count();
    (3..=16).contains(&n)
        && name.chars().all(|c| !c.is_control() && !matches!(c, '#' | '/' | '?' | '\\'))
        && (2..=5).contains(&tag.len())
        && tag.chars().all(|c| c.is_ascii_alphanumeric())
}

pub fn game_path(game_id: u64) -> Result<String, String> {
    if game_id == 0 { return Err("bad_game".into()); }
    Ok(format!("/lol-match-history/v1/games/{game_id}"))
}

/// Timeline d'une partie (or et CS de chaque joueur minute par minute), pour l'écart en lane de la page Stats.
pub fn timeline_path(game_id: u64) -> Result<String, String> {
    if game_id == 0 { return Err("bad_game".into()); }
    Ok(format!("/lol-match-history/v1/game-timelines/{game_id}"))
}

pub fn lookup_paths(name: &str, tag: &str) -> Result<[String; 2], String> {
    if !valid_riot_id(name, tag) { return Err("bad_riot_id".into()); }
    Ok([
        format!("/lol-summoner/v1/alias/lookup?gameName={}&tagLine={}", encode(name), encode(tag)),
        format!("/lol-summoner/v1/summoners?name={}", encode(&format!("{name}#{tag}"))),
    ])
}

pub fn player_paths(puuid: &str, count: u32) -> Result<[String; 3], String> {
    if !valid_puuid(puuid) { return Err("bad_puuid".into()); }
    let end = count.clamp(1, 100);
    Ok([
        format!("/lol-summoner/v2/summoners/puuid/{puuid}"),
        format!("/lol-ranked/v1/ranked-stats/{puuid}"),
        format!("/lol-match-history/v1/products/lol/{puuid}/matches?begIndex=0&endIndex={end}"),
    ])
}

/// Corps du choix des sorts : deux sorts différents, identifiants plausibles, rien d'autre.
pub fn spells_body(spell1: u32, spell2: u32) -> Result<Value, String> {
    let ok = |s: u32| (1..=99).contains(&s);
    if !ok(spell1) || !ok(spell2) || spell1 == spell2 { return Err("bad_spells".into()); }
    Ok(json!({ "spell1Id": spell1, "spell2Id": spell2 }))
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

/// API locale du jeu, ouverte seulement pendant une partie (aucune authentification, 127.0.0.1 uniquement).
pub const LIVE_URL: &str = "https://127.0.0.1:2999/liveclientdata/allgamedata";

/// Partie en cours, réduite à ce que Spec affiche : ton champion, ton niveau, ton or, tes objets et les
/// champions adverses (avec leur poste). Aucun nom de joueur ne sort d'ici.
pub fn trim_live(v: &Value) -> Option<Value> {
    let active = v.get("activePlayer")?;
    let ids = |p: &Value| [p.get("riotId"), p.get("summonerName")].into_iter().flatten().filter_map(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned).collect::<Vec<_>>();
    let mine = ids(active);
    if mine.is_empty() {
        return None;
    }
    let players = v.get("allPlayers")?.as_array()?;
    let me = players.iter().find(|p| ids(p).iter().any(|i| mine.contains(i)))?;
    let team = me.get("team")?.as_str()?;
    let key = |p: &Value| p.get("rawChampionName").and_then(Value::as_str).map(|s| s.trim_start_matches("game_character_displayname_").to_owned());
    let items: Vec<u64> = me.get("items").and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|i| i.get("itemID").and_then(Value::as_u64)).collect())
        .unwrap_or_default();
    let enemies: Vec<Value> = players.iter()
        .filter(|p| p.get("team").and_then(Value::as_str) != Some(team))
        .map(|p| json!({ "champion": key(p), "position": p.get("position").and_then(Value::as_str).unwrap_or("") }))
        .collect();
    // points de sorts déjà dépensés (Q + W + E + R) : le prochain dans l'ordre est celui à monter
    let spent: Option<u64> = ["Q", "W", "E", "R"].iter()
        .map(|k| active.pointer(&format!("/abilities/{k}/abilityLevel")).and_then(Value::as_u64))
        .sum();
    // stats en direct de l'overlay : score du joueur, kills de son équipe, objets de son vis-à-vis
    let num = |p: &Value, k: &str| p.pointer(&format!("/scores/{k}")).and_then(Value::as_f64).unwrap_or(0.0);
    let team_kills: f64 = players.iter().filter(|p| p.get("team").and_then(Value::as_str) == Some(team)).map(|p| num(p, "kills")).sum();
    let my_pos = me.get("position").and_then(Value::as_str).unwrap_or("");
    let opp_items: Vec<u64> = players.iter()
        .find(|p| p.get("team").and_then(Value::as_str) != Some(team) && !my_pos.is_empty() && p.get("position").and_then(Value::as_str) == Some(my_pos))
        .and_then(|p| p.get("items").and_then(Value::as_array))
        .map(|a| a.iter().filter_map(|i| i.get("itemID").and_then(Value::as_u64)).collect())
        .unwrap_or_default();
    Some(json!({
        "scores": { "kills": num(me, "kills"), "deaths": num(me, "deaths"), "assists": num(me, "assists"),
                    "cs": num(me, "creepScore"), "ward": num(me, "wardScore") },
        "teamKills": team_kills,
        "oppItems": opp_items,
        "champion": key(me),
        "position": me.get("position").and_then(Value::as_str).unwrap_or(""),
        "level": active.get("level").and_then(Value::as_u64).unwrap_or(1),
        "spent": spent,
        "gold": active.get("currentGold").and_then(Value::as_f64).unwrap_or(0.0),
        "time": v.pointer("/gameData/gameTime").and_then(Value::as_f64).unwrap_or(0.0),
        "items": items,
        "enemies": enemies,
    }))
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

    /// Lecture d'un chemin construit ici (jamais un chemin venu de l'interface).
    async fn read(&self, path: &str) -> Result<Value, String> {
        let resp = self.raw(reqwest::Method::GET, path, None).await?;
        resp.json().await.map_err(|_| "bad_json".into())
    }

    /// Détail d'une partie (les 10 joueurs), comme quand on l'ouvre dans le client.
    pub async fn game(&self, game_id: u64) -> Result<Value, String> {
        self.read(&game_path(game_id)?).await
    }

    pub async fn timeline(&self, game_id: u64) -> Result<Value, String> {
        self.read(&timeline_path(game_id)?).await
    }

    /// Partie en cours (voir trim_live). « loading » tant que le jeu n'a pas encore chargé la partie.
    pub async fn live_game(&self) -> Result<Value, String> {
        let resp = self.client.get(LIVE_URL).send().await.map_err(|_| "not_running".to_string())?;
        if !resp.status().is_success() {
            return Err("loading".into());
        }
        let v: Value = resp.json().await.map_err(|_| "loading".to_string())?;
        trim_live(&v).ok_or_else(|| "loading".into())
    }

    /// Joueur cherché par son Riot ID.
    pub async fn find_player(&self, name: &str, tag: &str) -> Result<Value, String> {
        let [alias, legacy] = lookup_paths(name, tag)?;
        match self.read(&alias).await {
            Ok(v) if v.get("puuid").and_then(Value::as_str).is_some_and(|p| !p.is_empty()) => Ok(v),
            Err(e) if e == "not_running" => Err(e),
            _ => self.read(&legacy).await.map_err(|e| if e == "http_404" { "not_found".into() } else { e }),
        }
    }

    /// Profil, rang et dernières parties d'un joueur (identifiant du client).
    pub async fn player(&self, puuid: &str, count: u32) -> Result<Value, String> {
        let [summoner, ranked, history] = player_paths(puuid, count)?;
        let summoner = self.read(&summoner).await?;
        let ranked = self.read(&ranked).await.unwrap_or(Value::Null);
        let history = self.read(&history).await.unwrap_or(Value::Null);
        Ok(json!({ "summoner": summoner, "ranked": ranked, "history": history }))
    }

    /// Accepte la partie trouvée (ready check). Seulement sur un clic du joueur, jamais automatiquement.
    pub async fn accept_ready_check(&self) -> Result<(), String> {
        self.raw(reqwest::Method::POST, "/lol-matchmaking/v1/ready-check/accept", None).await.map(|_| ())
    }

    /// Choisit les deux sorts d'invocateur (D puis F) pendant la draft.
    pub async fn set_spells(&self, spell1: u32, spell2: u32) -> Result<(), String> {
        let body = spells_body(spell1, spell2)?;
        self.raw(reqwest::Method::PATCH, "/lol-champ-select/v1/session/my-selection", Some(&body)).await.map(|_| ())
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

    /// Set d'objets « Spec · Ahri Mid » du shop : remplace le set de Spec (reconnu à son uid), garde tous les autres.
    pub async fn set_item_set(&self, champion: u32, title: &str, blocks: &[ItemBlock]) -> Result<(), String> {
        let ours = item_set_body(champion, title, blocks)?; // validation avant tout appel
        let me: Value = self.raw(reqwest::Method::GET, "/lol-summoner/v1/current-summoner", None).await?
            .json().await.map_err(|_| "bad_json".to_string())?;
        let id = me["summonerId"].as_u64().ok_or("no_summoner")?;
        let path = format!("/lol-item-sets/v1/item-sets/{id}/sets");
        let current: Value = self.raw(reqwest::Method::GET, &path, None).await?.json().await.map_err(|_| "bad_json".to_string())?;
        let body = merge_item_sets(&current, ours);
        self.raw(reqwest::Method::PUT, &path, Some(&body)).await.map(|_| ())
    }
}

pub const RUNE_PAGE_NAME: &str = "Spec";

/// Bloc d'un set d'objets : titre (« Départ », « Build »…) et objets dans l'ordre.
#[derive(serde::Deserialize, Clone, Debug)]
pub struct ItemBlock { pub title: String, pub items: Vec<u32> }

/// Début de l'uid des sets créés par Spec : seuls ces sets-là sont remplacés, jamais ceux du joueur.
pub const ITEM_SET_UID: &str = "5bec0000-5bec-4000-8000-";

/// Corps du set d'objets : un champion, la Faille, 6 blocs au plus, 12 objets par bloc, identifiants vérifiés.
pub fn item_set_body(champion: u32, title: &str, blocks: &[ItemBlock]) -> Result<Value, String> {
    let item_ok = |i: u32| (1000..=999_999).contains(&i);
    if !(1..=9999).contains(&champion) || blocks.is_empty() || blocks.len() > 6
        || blocks.iter().any(|b| b.items.is_empty() || b.items.len() > 12 || !b.items.iter().all(|&i| item_ok(i))) {
        return Err("bad_item_set".into());
    }
    let clean = |s: &str, n: usize| -> String { s.chars().filter(|c| !c.is_control()).take(n).collect::<String>().trim().to_string() };
    let title = clean(title, 60);
    Ok(json!({
        "uid": format!("{ITEM_SET_UID}{champion:012}"),
        "title": if title.is_empty() { RUNE_PAGE_NAME.to_string() } else { title },
        "type": "custom", "map": "any", "mode": "any", "sortrank": 0, "startedFrom": "blank",
        "associatedChampions": [champion], "associatedMaps": [11], "preferredItemSlots": [],
        "blocks": blocks.iter().map(|b| json!({
            "type": clean(&b.title, 40),
            "items": b.items.iter().map(|i| json!({ "id": i.to_string(), "count": 1 })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
    }))
}

/// Liste envoyée au client : les sets du joueur tels quels, sans les anciens sets de Spec, plus le nouveau.
pub fn merge_item_sets(current: &Value, ours: Value) -> Value {
    let mut sets: Vec<Value> = current["itemSets"].as_array().cloned().unwrap_or_default().into_iter()
        .filter(|s| !s["uid"].as_str().is_some_and(|u| u.starts_with(ITEM_SET_UID)))
        .collect();
    sets.push(ours);
    let mut out = current.clone();
    if !out.is_object() { out = json!({}); }
    out["itemSets"] = Value::Array(sets);
    out
}


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
    fn item_set_keeps_the_players_own_sets() {
        let blocks = vec![ItemBlock { title: "Départ".into(), items: vec![1056, 2003] }, ItemBlock { title: "Build".into(), items: vec![6655, 3020, 3089] }];
        let ours = item_set_body(103, "Spec · Ahri Mid", &blocks).unwrap();
        assert_eq!(ours["associatedChampions"], json!([103]));
        assert_eq!(ours["blocks"][1]["items"][1], json!({ "id": "3020", "count": 1 }));
        let current = json!({ "accountId": 42, "timestamp": 1, "itemSets": [
            { "uid": "mine-1", "title": "Mon set" },
            { "uid": format!("{ITEM_SET_UID}{:012}", 157), "title": "Spec · Yasuo Mid" },
        ] });
        let out = merge_item_sets(&current, ours);
        let sets = out["itemSets"].as_array().unwrap();
        assert_eq!(sets.len(), 2);
        assert_eq!(sets[0]["uid"], "mine-1");
        assert_eq!(sets[1]["title"], "Spec · Ahri Mid");
        assert_eq!(out["accountId"], 42);
    }

    #[test]
    fn item_set_rejects_bad_input() {
        let ok = vec![ItemBlock { title: "Build".into(), items: vec![6655] }];
        assert!(item_set_body(0, "x", &ok).is_err());
        assert!(item_set_body(103, "x", &[]).is_err());
        assert!(item_set_body(103, "x", &[ItemBlock { title: "B".into(), items: vec![12] }]).is_err());
        assert!(item_set_body(103, "x", &vec![ok[0].clone(); 7]).is_err());
    }

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
        assert!(is_allowed("/lol-matchmaking/v1/ready-check"));
        assert!(!is_allowed("/lol-matchmaking/v1/ready-check/accept"));
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

    #[test]
    fn built_paths_only_take_validated_ids() {
        assert_eq!(game_path(7412345678).unwrap(), "/lol-match-history/v1/games/7412345678");
        assert!(game_path(0).is_err());
        assert_eq!(timeline_path(7412345678).unwrap(), "/lol-match-history/v1/game-timelines/7412345678");
        assert!(timeline_path(0).is_err());
        let [alias, legacy] = lookup_paths("Héo Lune", "EUW").unwrap();
        assert_eq!(alias, "/lol-summoner/v1/alias/lookup?gameName=H%C3%A9o%20Lune&tagLine=EUW");
        assert_eq!(legacy, "/lol-summoner/v1/summoners?name=H%C3%A9o%20Lune%23EUW");
        assert!(lookup_paths("ab", "EUW").is_err());
        assert!(lookup_paths("../../lol-login", "EUW").is_err());
        assert!(lookup_paths("Miko", "K/CO").is_err());
        assert!(lookup_paths("Mi?ko", "EUW").is_err());
        let uuid = "0a1b2c3d-1111-5222-9333-444455556666";
        let [s, r, h] = player_paths(uuid, 500).unwrap();
        assert_eq!(s, format!("/lol-summoner/v2/summoners/puuid/{uuid}"));
        assert_eq!(r, format!("/lol-ranked/v1/ranked-stats/{uuid}"));
        assert!(h.ends_with("begIndex=0&endIndex=100"));
        assert!(player_paths("../x", 20).is_err());
        assert!(player_paths("a/b/c/d/e/f/g/h/i/j/k/l", 20).is_err());
    }

    #[test]
    fn spells_body_is_minimal() {
        assert_eq!(spells_body(14, 4).unwrap(), json!({ "spell1Id": 14, "spell2Id": 4 }));
        assert!(spells_body(4, 4).is_err());
        assert!(spells_body(0, 4).is_err());
        assert!(spells_body(4, 1000).is_err());
    }

    #[tokio::test]
    async fn rejects_forbidden_path_before_any_call() {
        let lcu = Lcu::new();
        assert_eq!(lcu.get("/lol-login/v1/session").await, Err("forbidden_path".into()));
        assert_eq!(lcu.preselect(1, 0).await, Err("bad_champion".into()));
        assert_eq!(lcu.set_rune_page("Ahri", 8100, 8100, &[]).await, Err("bad_page".into()));
        assert_eq!(lcu.set_spells(4, 4).await, Err("bad_spells".into()));
        assert_eq!(lcu.player("../../x", 20).await, Err("bad_puuid".into()));
        assert_eq!(lcu.find_player("a", "b").await, Err("bad_riot_id".into()));
        assert_eq!(lcu.game(0).await, Err("bad_game".into()));
    }

    #[test]
    fn live_game_keeps_only_what_spec_shows() {
        let v = json!({
            "activePlayer": { "riotId": "Moi#EUW", "level": 11, "currentGold": 450.5,
                "abilities": { "Q": { "abilityLevel": 5 }, "W": { "abilityLevel": 3 }, "E": { "abilityLevel": 1 }, "R": { "abilityLevel": 1 } } },
            "allPlayers": [
                { "riotId": "Moi#EUW", "team": "ORDER", "position": "MIDDLE", "rawChampionName": "game_character_displayname_Ahri",
                  "items": [{ "itemID": 6655 }, { "itemID": 3340 }], "scores": { "kills": 5, "deaths": 2, "assists": 3, "creepScore": 120, "wardScore": 9.5 } },
                { "riotId": "Autre#EUW", "team": "ORDER", "position": "TOP", "rawChampionName": "game_character_displayname_Darius", "items": [] },
                { "riotId": "Face#KR", "team": "CHAOS", "position": "MIDDLE", "rawChampionName": "game_character_displayname_Zed", "items": [{ "itemID": 3142 }] }
            ],
            "gameData": { "gameTime": 754.2 }
        });
        let out = trim_live(&v).unwrap();
        assert_eq!(out["champion"], "Ahri");
        assert_eq!(out["level"], 11);
        assert_eq!(out["position"], "MIDDLE");
        assert_eq!(out["spent"], 10);
        assert_eq!(out["scores"]["cs"], 120.0);
        assert_eq!(out["teamKills"], 5.0);
        assert_eq!(out["oppItems"], json!([3142]));
        assert_eq!(out["items"], json!([6655, 3340]));
        assert_eq!(out["enemies"], json!([{ "champion": "Zed", "position": "MIDDLE" }]));
        assert!(!out.to_string().contains('#'), "aucun Riot ID ne doit sortir");
        assert!(trim_live(&json!({ "activePlayer": {}, "allPlayers": [] })).is_none());
    }
}
