"""Agrégation : transforme les parties brutes en tables de stats prêtes pour le score.

Lit data/draft.duckdb en lecture seule (le collecteur peut continuer à tourner)
et écrit data/stats.duckdb d'un bloc (fichier temporaire puis remplacement).
"""

import logging
import os
import time
from pathlib import Path

import duckdb

from collector.db import connect_with_retry

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


def build_stats(db_path: Path, out_path: Path, patch: str | None = None,
                holdout: bool = False) -> dict:
    """holdout=True : exclut les 10 % de parties réservées au calibrage."""
    db_path, out_path = Path(db_path), Path(out_path)
    tmp = out_path.with_suffix(".building.duckdb")
    tmp.unlink(missing_ok=True)

    con = duckdb.connect(":memory:")
    # attache la base du collecteur en lecture seule, en attendant son tour si besoin
    deadline = time.monotonic() + 60
    while True:
        try:
            con.execute(f"ATTACH '{db_path.as_posix()}' AS src (READ_ONLY)")
            break
        except duckdb.Error as exc:
            if "lock" not in str(exc).lower() or time.monotonic() > deadline:
                raise
            time.sleep(0.3)

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
        con.execute("DETACH src")

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
        con.execute("CREATE TABLE out.meta (key VARCHAR, value VARCHAR)")
        con.executemany("INSERT INTO out.meta VALUES (?, ?)", list(meta.items()))
        con.execute("DETACH out")
    finally:
        con.close()

    os.replace(tmp, out_path)
    return meta
