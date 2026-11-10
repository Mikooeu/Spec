"""Agrégation : transforme les parties brutes en tables de stats prêtes pour le score.

Lit data/draft.duckdb en lecture seule (le collecteur peut continuer à tourner)
et écrit data/stats.duckdb d'un bloc (fichier temporaire puis remplacement).
"""

import logging
import os
import re
import time
from pathlib import Path

import json

import duckdb

from collector.db import connect_with_retry

from .builds import compute_builds
from .items import Items
from .runes import compute_runes
from .situational import compute_situational
from .traits import load_traits

log = logging.getLogger(__name__)

MIN_MATCHES_ALONE = 20_000   # en dessous, on complète avec le patch précédent
PREVIOUS_PATCH_WEIGHT = 0.5


def _patch_key(patch: str) -> tuple:
    return tuple(int(x) if x.isdigit() else 0 for x in patch.split("."))


def choose_patches(src_con) -> tuple[str, str | None, dict]:
    rows = src_con.execute(
        "SELECT patch, count(*) FROM src.matches WHERE NOT is_remake GROUP BY patch").fetchall()
    counts = {p: n for p, n in rows if p}
    if not counts:
        raise SystemExit("Aucune partie dans la base : laisse tourner le collecteur un moment.")
    ordered = sorted(counts, key=_patch_key, reverse=True)
    current = ordered[0]
    previous = ordered[1] if len(ordered) > 1 and counts[current] < MIN_MATCHES_ALONE else None
    return current, previous, counts


HOLDOUT_SQL = "hash(m.match_id) % 10 = 0"   # 10 % des parties, toujours les mêmes


SOURCE_TABLES = ("matches", "participants", "runes", "match_ext", "bans", "builds", "damage")


def _attach(con, path: Path, alias: str) -> None:
    """Attache une base du collecteur en lecture seule, en attendant son tour si besoin."""
    deadline = time.monotonic() + 60
    while True:
        try:
            con.execute(f"ATTACH '{Path(path).as_posix()}' AS {alias} (READ_ONLY)")
            return
        except duckdb.Error as exc:
            if "lock" not in str(exc).lower() or time.monotonic() > deadline:
                raise
            time.sleep(0.3)


def _has(con, table: str) -> bool:
    return con.execute(
        """SELECT (SELECT count(*) FROM duckdb_tables() WHERE database_name = 'src' AND table_name = ?)
                + (SELECT count(*) FROM duckdb_views() WHERE database_name = 'src' AND view_name = ?)""",
        [table, table]).fetchone()[0] > 0


def _stream(cursor, size: int = 20_000):
    """Lignes lues par paquets : la petite VM n'a pas à tout garder en mémoire."""
    while True:
        chunk = cursor.fetchmany(size)
        if not chunk:
            return
        yield from chunk


def build_stats(db_path: Path | list[Path], out_path: Path, patch: str | None = None,
                holdout: bool = False, items: Items | None = None,
                champion_keys: dict | None = None) -> dict:
    """holdout=True : exclut les 10 % de parties réservées au calibrage.
    db_path : une base, ou plusieurs (« World ») dont les parties sont additionnées."""
    sources = [Path(x) for x in db_path] if isinstance(db_path, (list, tuple)) else [Path(db_path)]
    db_path, out_path = sources[0], Path(out_path)
    tmp = out_path.with_suffix(".building.duckdb")
    tmp.unlink(missing_ok=True)

    con = duckdb.connect(":memory:")
    # petite VM (1 Go) : mémoire plafonnée, le surplus passe sur le disque
    limit = os.getenv("DUCKDB_MEMORY_LIMIT", "").strip()
    if re.fullmatch(r"\d+(MB|GB)", limit):
        (db_path.parent / "tmp").mkdir(parents=True, exist_ok=True)
        con.execute(f"SET memory_limit = '{limit}'")
        con.execute(f"SET temp_directory = '{(db_path.parent / 'tmp').as_posix()}'")
        con.execute("SET preserve_insertion_order = false")
        con.execute("SET threads = 1")
    # bases du collecteur en lecture seule (plusieurs pour « World » : elles sont réunies dans des vues)
    if len(sources) == 1:
        _attach(con, sources[0], "src")
    else:
        for i, path in enumerate(sources):
            _attach(con, path, f"s{i}")
        con.execute("ATTACH ':memory:' AS src")
        for table in SOURCE_TABLES:
            parts = [f"SELECT * FROM s{i}.{table}" for i in range(len(sources))
                     if con.execute("SELECT count(*) FROM duckdb_tables() WHERE database_name = ? AND table_name = ?",
                                    [f"s{i}", table]).fetchone()[0]]
            if parts:
                con.execute(f"CREATE VIEW src.{table} AS " + " UNION ALL ".join(parts))

    try:
        current, previous, counts = choose_patches(con)
        if patch:
            current, previous = patch, None
        weight_prev = PREVIOUS_PATCH_WEIGHT if previous else 0.0
        log.info("Patch %s (%d parties)%s", current, counts.get(current, 0),
                 f" + patch {previous} à {int(weight_prev * 100)} %" if previous else "")

        # participants pondérés, copiés en mémoire puis la base source est libérée
        con.execute("""
            CREATE TEMP TABLE p AS
            SELECT pa.match_id, pa.team_id, pa.champion_id AS champ, pa.team_position AS role,
                   pa.win::INTEGER AS win,
                   CASE WHEN m.patch = ? THEN 1.0 ELSE ? END AS w
            FROM src.participants pa JOIN src.matches m USING (match_id)
            WHERE NOT m.is_remake AND pa.team_position <> '' AND m.patch IN (?, ?)
        """ + (f" AND NOT ({HOLDOUT_SQL})" if holdout else ""),
            [current, weight_prev, current, previous or current])
        # pages de runes (collectées depuis la 0.1.1 ; la table peut ne pas encore exister)
        has_runes = _has(con, "runes")
        rune_rows, laner_rows = [], []
        if has_runes:
            con.execute("""
                CREATE TEMP TABLE rr AS
                SELECT a.match_id, a.team_id, a.champ, a.role, a.win, a.w, ru.keystone, ru.primary_style,
                       ru.p1, ru.p2, ru.p3, ru.sub_style, ru.s1, ru.s2, ru.sh1, ru.sh2, ru.sh3
                FROM p a JOIN src.runes ru
                  ON ru.match_id = a.match_id AND ru.team_id = a.team_id AND ru.champion_id = a.champ""")
            # regroupées en SQL (winrate moyen, poids total) : compute_runes ne fait que des sommes
            rune_rows = con.execute("""SELECT champ, role, keystone, primary_style, p1, p2, p3,
                                              sub_style, s1, s2, sh1, sh2, sh3,
                                              sum(w * win) / sum(w), sum(w) FROM rr GROUP BY ALL""").fetchall()
            laner_rows = con.execute("""
                SELECT a.champ, a.role, b.champ, a.keystone, sum(a.w * a.win) / sum(a.w), sum(a.w)
                FROM rr a JOIN p b ON a.match_id = b.match_id AND a.team_id <> b.team_id AND a.role = b.role
                GROUP BY 1, 2, 3, 4""").fetchall()
        # bans (collectés depuis la 0.2) : banrate = bans / parties avec le détail
        has_bans = _has(con, "bans")
        ban_rows, ban_matches = [], 0.0
        if has_bans:
            weighted = """SELECT e.match_id, CASE WHEN m.patch = ? THEN 1.0 ELSE ? END AS w
                          FROM src.match_ext e JOIN src.matches m USING (match_id)
                          WHERE NOT m.is_remake AND m.patch IN (?, ?)""" + (
                f" AND NOT ({HOLDOUT_SQL})" if holdout else "")
            con.execute("CREATE TEMP TABLE bm AS " + weighted, [current, weight_prev, current, previous or current])
            ban_matches = float(con.execute("SELECT coalesce(sum(w), 0) FROM bm").fetchone()[0])
            ban_rows = con.execute("""SELECT b.champion_id, sum(bm.w) FROM src.bans b JOIN bm USING (match_id)
                                      GROUP BY 1""").fetchall()
        # page champion : sorts, objets, ordre des sorts (collectés depuis la 0.2)
        champ_pages = []
        if _has(con, "builds"):
            # avec le champion d'en face sur la même lane (sorts conseillés par matchup)
            cur = con.execute("""
                SELECT a.champ, a.role, a.win, a.w, b.spell1, b.spell2, b.items, b.skills, b.purchases, o.champ
                FROM p a JOIN src.builds b
                  ON b.match_id = a.match_id AND b.team_id = a.team_id AND b.champion_id = a.champ
                LEFT JOIN p o ON o.match_id = a.match_id AND o.team_id <> a.team_id AND o.role = a.role""")
            champ_pages = compute_builds(_stream(cur), items or Items(None))
        # dégâts par type (collectés depuis la 0.6) : part physique, magique et brute de chaque champion dans son rôle
        damage_rows = []
        if _has(con, "damage"):
            damage_rows = con.execute("""
                SELECT a.champ, a.role, sum(a.w), sum(a.w * d.physical), sum(a.w * d.magic), sum(a.w * d.true_dmg)
                FROM p a JOIN src.damage d
                  ON d.match_id = a.match_id AND d.team_id = a.team_id AND d.champion_id = a.champ
                GROUP BY 1, 2""").fetchall()
        # objets et runes adaptés à la draft adverse (traits de composition + dégâts mesurés)
        situ = []
        if champion_keys and _has(con, "builds"):
            dmg: dict[int, list[float]] = {}
            for champ, _, games, phys, mag, tru in damage_rows:
                total = (phys or 0) + (mag or 0) + (tru or 0)
                if total > 0:
                    d = dmg.setdefault(champ, [0.0, 0.0, 0.0])
                    d[0] += phys; d[1] += mag; d[2] += games
            measured = {c: (p_ / (p_ + m_) if p_ + m_ else 0.5, m_ / (p_ + m_) if p_ + m_ else 0.5, g)
                        for c, (p_, m_, g) in dmg.items()}
            traits = load_traits(champion_keys, measured)
            rune_cols = ("[ru.keystone, ru.p1, ru.p2, ru.p3, ru.s1, ru.s2, ru.sh1, ru.sh2, ru.sh3]" if has_runes else "NULL")
            rune_join = ("LEFT JOIN rr ru ON ru.match_id = a.match_id AND ru.team_id = a.team_id AND ru.champ = a.champ"
                         if has_runes else "")
            cur = con.execute(f"""
                SELECT a.champ, a.role, a.w, any_value(b.items), any_value({rune_cols}),
                       string_agg(e.champ::VARCHAR, ',')
                FROM p a JOIN src.builds b
                  ON b.match_id = a.match_id AND b.team_id = a.team_id AND b.champion_id = a.champ
                {rune_join}
                JOIN p e ON e.match_id = a.match_id AND e.team_id <> a.team_id
                GROUP BY a.match_id, a.team_id, a.champ, a.role, a.w""")
            situ = compute_situational(_stream(cur), traits, items or Items(None))
        con.execute("DETACH src")
        for i in range(len(sources) if len(sources) > 1 else 0):
            con.execute(f"DETACH s{i}")
        runes = compute_runes(rune_rows, laner_rows)

        con.execute(f"ATTACH '{tmp.as_posix()}' AS out")
        con.execute("""CREATE TABLE out.base AS
            SELECT champ, role, sum(w) AS games, sum(w * win) AS wins FROM p GROUP BY ALL""")
        con.execute("""CREATE TABLE out.lane AS
            SELECT a.champ, a.role, b.champ AS opp, sum(a.w) AS games, sum(a.w * a.win) AS wins
            FROM p a JOIN p b ON a.match_id = b.match_id AND a.team_id <> b.team_id AND a.role = b.role
            GROUP BY ALL""")
        con.execute("""CREATE TABLE out.vs AS
            SELECT a.champ, a.role, b.champ AS opp, sum(a.w) AS games, sum(a.w * a.win) AS wins
            FROM p a JOIN p b ON a.match_id = b.match_id AND a.team_id <> b.team_id
            GROUP BY ALL""")
        con.execute("""CREATE TABLE out.ally AS
            SELECT a.champ, a.role, b.champ AS ally, sum(a.w) AS games, sum(a.w * a.win) AS wins
            FROM p a JOIN p b ON a.match_id = b.match_id AND a.team_id = b.team_id
                             AND a.champ <> b.champ
            GROUP BY ALL""")
        matches = con.execute("SELECT count(DISTINCT match_id) FROM p").fetchone()[0]
        meta = {"patch": current, "previous_patch": previous or "",
                "previous_weight": str(weight_prev), "matches": str(matches),
                "built_at": str(int(time.time()))}
        meta["rune_pages"] = str(len(runes["pages"]))
        meta["ban_matches"] = str(round(ban_matches, 1))
        con.execute("CREATE TABLE out.champ (value VARCHAR)")
        con.execute("INSERT INTO out.champ VALUES (?)", [json.dumps(champ_pages)])
        con.execute("CREATE TABLE out.bans (champ INTEGER, games DOUBLE)")
        if ban_rows:
            con.executemany("INSERT INTO out.bans VALUES (?, ?)", ban_rows)
        con.execute("CREATE TABLE out.damage (champ INTEGER, role VARCHAR, games DOUBLE, ad DOUBLE, ap DOUBLE, tru DOUBLE)")
        for champ, role, games, phys, mag, tru in damage_rows:
            total = (phys or 0) + (mag or 0) + (tru or 0)
            if total > 0:
                con.execute("INSERT INTO out.damage VALUES (?, ?, ?, ?, ?, ?)",
                            [champ, role, games, phys / total, mag / total, tru / total])
        con.execute("CREATE TABLE out.situ (value VARCHAR)")
        con.execute("INSERT INTO out.situ VALUES (?)", [json.dumps(situ)])
        con.execute("CREATE TABLE out.runes (value VARCHAR)")
        con.execute("INSERT INTO out.runes VALUES (?)", [json.dumps(runes)])
        con.execute("CREATE TABLE out.meta (key VARCHAR, value VARCHAR)")
        con.executemany("INSERT INTO out.meta VALUES (?, ?)", list(meta.items()))
        con.execute("DETACH out")
    finally:
        con.close()

    os.replace(tmp, out_path)
    return meta
