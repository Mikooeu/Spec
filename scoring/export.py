"""Export des stats en JSON compact pour l'appli Spec (et plus tard le Worker Cloudflare)."""

import json
from pathlib import Path

from collector.db import connect_with_retry

from .champions import Champions
from .score import ROLES, Params


def export_json(stats_path: Path, champions: Champions, params: Params, out_path: Path) -> dict:
    con = connect_with_retry(str(stats_path), read_only=True)
    try:
        role_index = {r: i for i, r in enumerate(ROLES)}
        r1 = lambda x: round(float(x), 1)

        def rows(sql: str, with_other: bool) -> list:
            out = []
            for row in con.execute(sql).fetchall():
                if with_other:
                    c, r, o, g, w = row
                    out.append([c, role_index[r], o, r1(g), r1(w)])
                else:
                    c, r, g, w = row
                    out.append([c, role_index[r], r1(g), r1(w)])
            return out

        payload = {
            "meta": dict(con.execute("SELECT key, value FROM meta").fetchall()),
            "params": {"alpha": params.alpha, "beta": params.beta,
                       "k_base": params.k_base, "k_delta": params.k_delta},
            "ddragon": champions.version,
            "roles": list(ROLES),
            "champions": [[cid, key, name] for cid, (key, name) in sorted(champions.keys.items())],
            "base": rows("SELECT champ, role, games, wins FROM base", False),
            "lane": rows("SELECT champ, role, opp, games, wins FROM lane", True),
            "vs": rows("SELECT champ, role, opp, games, wins FROM vs", True),
            "ally": rows("SELECT champ, role, ally, games, wins FROM ally", True),
        }
    finally:
        con.close()
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), "utf-8")
    tmp.replace(out_path)
    return payload["meta"]
