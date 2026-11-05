"""Stockage DuckDB. On ne garde que ce dont le score a besoin :
champion, rôle, équipe et résultat de chaque participant (aucun pseudo).

DuckDB n'autorise qu'un seul programme à la fois sur un fichier. On ouvre donc
la connexion uniquement le temps de chaque opération : le collecteur peut tourner
pendant que `stats` ou l'agrégation lisent la base, chacun attendant son tour.
"""

import time
from contextlib import contextmanager
from pathlib import Path

import duckdb

SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
    puuid VARCHAR PRIMARY KEY,
    tier VARCHAR,
    league_points INTEGER,
    last_seen BIGINT,          -- dernière présence dans le ladder (epoch s)
    last_checked BIGINT        -- dernière recherche de parties (epoch s)
);
CREATE TABLE IF NOT EXISTS match_queue (
    match_id VARCHAR PRIMARY KEY,
    discovered_at BIGINT
);
CREATE TABLE IF NOT EXISTS matches (
    match_id VARCHAR PRIMARY KEY,
    platform VARCHAR,
    game_version VARCHAR,
    patch VARCHAR,             -- ex. "15.21" (deux premiers nombres de gameVersion)
    game_creation BIGINT,      -- epoch ms
    game_duration INTEGER,     -- secondes
    is_remake BOOLEAN
);
CREATE TABLE IF NOT EXISTS participants (
    match_id VARCHAR,
    team_id INTEGER,
    champion_id INTEGER,
    team_position VARCHAR,     -- TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY
    win BOOLEAN
);
CREATE TABLE IF NOT EXISTS meta (key VARCHAR PRIMARY KEY, value VARCHAR);
-- page de runes de chaque participant (collectée depuis la 0.1.1)
CREATE TABLE IF NOT EXISTS runes (
    match_id VARCHAR,
    team_id INTEGER,
    champion_id INTEGER,
    team_position VARCHAR,
    keystone INTEGER,
    primary_style INTEGER,
    p1 INTEGER, p2 INTEGER, p3 INTEGER,          -- runes mineures de l'arbre principal
    sub_style INTEGER,
    s1 INTEGER, s2 INTEGER,                      -- runes de l'arbre secondaire
    sh1 INTEGER, sh2 INTEGER, sh3 INTEGER        -- fragments : attaque, flexible, défense
);
-- depuis la 0.2 : une ligne par partie collectée avec les infos ci-dessous
CREATE TABLE IF NOT EXISTS match_ext (
    match_id VARCHAR PRIMARY KEY,
    has_timeline BOOLEAN       -- déroulé téléchargé (1 partie sur 3)
);
-- champions bannis (sans l'équipe qui les a bannis : inutile pour le banrate)
CREATE TABLE IF NOT EXISTS bans (
    match_id VARCHAR,
    champion_id INTEGER
);
-- sorts d'invocateur, objets de fin de partie et, si déroulé, ordre des sorts et des achats
CREATE TABLE IF NOT EXISTS builds (
    match_id VARCHAR,
    team_id INTEGER,
    champion_id INTEGER,
    team_position VARCHAR,
    win BOOLEAN,
    spell1 INTEGER, spell2 INTEGER,  -- triés : Flash/Ignite = Ignite/Flash
    items VARCHAR,                   -- inventaire final « 3089,3020,… » (avec la case de quête de rôle, sans le bijou)
    skills VARCHAR,                  -- ordre des sorts « QEWQQR… » (déroulé uniquement)
    purchases VARCHAR                -- achats « 1056@14,2003@14,… » en secondes (déroulé uniquement)
);
"""

LOCK_RETRY_SECONDS = 60


def is_lock_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return "lock" in text or "conflicting" in text


def connect_with_retry(path: str, read_only: bool = False, wait: float = LOCK_RETRY_SECONDS):
    """Ouvre la base ; si un autre programme la tient, réessaie pendant `wait` secondes."""
    deadline = time.monotonic() + wait
    while True:
        try:
            return duckdb.connect(path, read_only=read_only)
        except duckdb.Error as exc:
            if not is_lock_error(exc) or time.monotonic() > deadline:
                raise
            time.sleep(0.3)


class Store:
    def __init__(self, path: Path | str, read_only: bool = False):
        self.path = str(path)
        self.read_only = read_only
        self._memory = duckdb.connect(":memory:") if self.path == ":memory:" else None
        if self._memory is None and not read_only:
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        if not read_only:
            with self._connect() as con:
                con.execute(SCHEMA)

    @contextmanager
    def _connect(self):
        if self._memory is not None:
            yield self._memory
            return
        con = connect_with_retry(self.path, read_only=self.read_only)
        try:
            yield con
        finally:
            con.close()

    def close(self) -> None:
        if self._memory is not None:
            self._memory.close()

    # --- meta ---
    def get_meta(self, key: str) -> str | None:
        with self._connect() as con:
            row = con.execute("SELECT value FROM meta WHERE key = ?", [key]).fetchone()
        return row[0] if row else None

    def set_meta(self, key: str, value: str) -> None:
        with self._connect() as con:
            con.execute("INSERT INTO meta VALUES (?, ?) "
                        "ON CONFLICT (key) DO UPDATE SET value = excluded.value", [key, value])

    # --- joueurs ---
    def upsert_players(self, rows: list[tuple[str, str, int]]) -> None:
        if not rows:
            return
        now = int(time.time())
        with self._connect() as con:
            con.executemany(
                """INSERT INTO players (puuid, tier, league_points, last_seen, last_checked)
                   VALUES (?, ?, ?, ?, NULL)
                   ON CONFLICT (puuid) DO UPDATE SET tier = excluded.tier,
                       league_points = excluded.league_points, last_seen = excluded.last_seen""",
                [(p, t, lp, now) for p, t, lp in rows])

    def players_to_check(self, limit: int) -> list[tuple[str, int | None]]:
        with self._connect() as con:
            return con.execute(
                """SELECT puuid, last_checked FROM players
                   ORDER BY last_checked ASC NULLS FIRST, league_points DESC LIMIT ?""",
                [limit]).fetchall()

    def mark_checked(self, puuid: str, when: int) -> None:
        with self._connect() as con:
            con.execute("UPDATE players SET last_checked = ? WHERE puuid = ?", [when, puuid])

    # --- file de parties ---
    def enqueue(self, match_ids: list[str]) -> int:
        if not match_ids:
            return 0
        now = int(time.time())
        with self._connect() as con:
            before = con.execute("SELECT count(*) FROM match_queue").fetchone()[0]
            con.executemany(
                """INSERT INTO match_queue
                   SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM matches WHERE match_id = ?)
                   ON CONFLICT DO NOTHING""",
                [(m, now, m) for m in match_ids])
            after = con.execute("SELECT count(*) FROM match_queue").fetchone()[0]
        return after - before

    def queue_size(self) -> int:
        with self._connect() as con:
            return con.execute("SELECT count(*) FROM match_queue").fetchone()[0]

    def next_in_queue(self, limit: int) -> list[str]:
        with self._connect() as con:
            # Les identifiants Riot augmentent avec le temps (EUW1_7612345678) :
            # on télécharge les parties les plus récentes d'abord, donc le dernier patch en priorité.
            rows = con.execute(
                """SELECT match_id FROM match_queue
                   ORDER BY TRY_CAST(split_part(match_id, '_', 2) AS BIGINT) DESC NULLS LAST,
                            discovered_at
                   LIMIT ?""", [limit]).fetchall()
        return [r[0] for r in rows]

    def drop_from_queue(self, match_id: str) -> None:
        with self._connect() as con:
            con.execute("DELETE FROM match_queue WHERE match_id = ?", [match_id])

    # --- parties ---
    def save_match(self, match: dict, participants: list[tuple]) -> None:
        with self._connect() as con:
            con.execute("BEGIN")
            try:
                con.execute(
                    "INSERT INTO matches VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
                    [match["match_id"], match["platform"], match["game_version"], match["patch"],
                     match["game_creation"], match["game_duration"], match["is_remake"]])
                con.execute("DELETE FROM participants WHERE match_id = ?", [match["match_id"]])
                con.executemany("INSERT INTO participants VALUES (?, ?, ?, ?, ?)", participants)
                con.execute("DELETE FROM runes WHERE match_id = ?", [match["match_id"]])
                if match.get("runes"):
                    con.executemany("INSERT INTO runes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                    match["runes"])
                if "bans" in match:
                    mid = match["match_id"]
                    for table in ("match_ext", "bans", "builds"):
                        con.execute(f"DELETE FROM {table} WHERE match_id = ?", [mid])
                    con.execute("INSERT INTO match_ext VALUES (?, ?)", [mid, bool(match.get("has_timeline"))])
                    if match["bans"]:
                        con.executemany("INSERT INTO bans VALUES (?, ?)", [(mid, c) for c in match["bans"]])
                    if match.get("builds"):
                        con.executemany("INSERT INTO builds VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                        match["builds"])
                con.execute("DELETE FROM match_queue WHERE match_id = ?", [match["match_id"]])
                con.execute("COMMIT")
            except Exception:
                con.execute("ROLLBACK")
                raise

    # --- stats ---
    def summary(self) -> dict:
        with self._connect() as con:
            q = lambda sql: con.execute(sql).fetchall()
            return {
                "players": q("SELECT count(*) FROM players")[0][0],
                "players_checked": q("SELECT count(*) FROM players WHERE last_checked IS NOT NULL")[0][0],
                "queue": q("SELECT count(*) FROM match_queue")[0][0],
                "matches": q("SELECT count(*) FROM matches")[0][0],
                "remakes": q("SELECT count(*) FROM matches WHERE is_remake")[0][0],
                "detailed": q("SELECT count(*) FROM match_ext")[0][0],
                "timelines": q("SELECT count(*) FROM match_ext WHERE has_timeline")[0][0],
                "by_patch": q("""SELECT patch, count(*) FROM matches WHERE NOT is_remake
                                 GROUP BY patch ORDER BY patch DESC LIMIT 5"""),
            }
