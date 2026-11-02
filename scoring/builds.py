"""Page champion : sorts d'invocateur, ordre des sorts, objets de départ, bottes, objets 1 à 5 (6 en ADC)
et builds complets, par champion et rôle.

Sources : table `builds` du collecteur. Sorts et bottes viennent de toutes les parties détaillées ;
l'ordre des sorts, les objets de départ et l'ordre des objets viennent des parties avec déroulé (1 sur 3).
Chaque ligne d'entrée est pondérée (patch précédent à 50 % quand le patch actuel a peu de parties).
"""

from collections import Counter, defaultdict

from .items import Items

START_MAX_SECONDS = 90     # achats de la première visite en boutique
SKILL_LEVELS = 15          # on compare les ordres sur les 15 premiers niveaux
SKILL_FALLBACK = 11
MIN_SEQ_GAMES = 10         # build complet : parties minimum pour un enchaînement exact
K_SMOOTH = 20


def _add(counter: dict, key, win: int, w: float) -> None:
    gw = counter.setdefault(key, [0.0, 0.0])
    gw[0] += w
    gw[1] += w * win


def _top(counter: dict, n: int) -> list:
    return sorted(counter.items(), key=lambda kv: -kv[1][0])[:n]


def _r(x: float) -> float:
    return round(x, 1)


def legendary_order(purchases: str, items: Items) -> list[int]:
    out: list[int] = []
    for part in purchases.split(","):
        if not part:
            continue
        item = int(part.split("@")[0])
        if item in items.legendary and item not in out:
            out.append(item)
    return out


def starting_items(purchases: str) -> str | None:
    first = sorted(int(p.split("@")[0]) for p in purchases.split(",")
                   if p and int(p.split("@")[1]) <= START_MAX_SECONDS)
    return ",".join(map(str, first)) or None


def skill_priority(order: str) -> str:
    """« R > Q > W > E » : R d'abord, puis les sorts selon les points mis (à égalité, le premier monté)."""
    basics = sorted("QWE", key=lambda s: (-order.count(s), order.find(s) if s in order else 99))
    return " > ".join(["R", *basics])


def compute_builds(rows: list[tuple], items: Items) -> list:
    """rows : (champ, role, win, w, spell1, spell2, items, skills, purchases).
    Renvoie [[champ, role, {...}], ...] prêt pour l'export JSON."""
    per: dict = defaultdict(lambda: {"g": 0.0, "tg": 0.0, "spells": {}, "boots": {}, "start": {},
                                     "skills": {}, "ranks": defaultdict(dict), "rank_g": Counter(), "seq": {}})
    for champ, role, win, w, s1, s2, final, skills, purchases in rows:
        d = per[(champ, role)]
        d["g"] += w
        _add(d["spells"], (s1, s2), win, w)
        boots = [int(x) for x in (final or "").split(",") if x and int(x) in items.boots]
        if boots:
            _add(d["boots"], boots[0], win, w)
        if purchases is None:
            continue
        d["tg"] += w
        start = starting_items(purchases)
        if start:
            _add(d["start"], start, win, w)
        if skills and len(skills) >= SKILL_FALLBACK:
            _add(d["skills"], skills[:SKILL_LEVELS] if len(skills) >= SKILL_LEVELS else skills[:SKILL_FALLBACK], win, w)
        order = legendary_order(purchases, items)
        for k, item in enumerate(order[:6]):
            _add(d["ranks"][k], item, win, w)
            d["rank_g"][k] += w
        size = 6 if role == "BOTTOM" else 5
        if len(order) >= size:
            _add(d["seq"], tuple(order[:size]), win, w)

    out = []
    for (champ, role), d in per.items():
        if d["g"] <= 0:
            continue
        ref = sum(gw[1] for gw in d["spells"].values()) / d["g"]
        full = [s for s in d["skills"].items() if len(s[0]) == SKILL_LEVELS]
        skill = max(full or d["skills"].items(), key=lambda kv: kv[1][0], default=None)
        seqs = [(k, gw) for k, gw in d["seq"].items() if gw[0] >= MIN_SEQ_GAMES]
        seqs.sort(key=lambda kv: -((kv[1][1] + K_SMOOTH * ref) / (kv[1][0] + K_SMOOTH)))
        entry = {
            "g": _r(d["g"]), "tg": _r(d["tg"]),
            "spells": [[a, b, _r(g), _r(w)] for (a, b), (g, w) in _top(d["spells"], 2)],
            "boots": [[i, _r(g), _r(w)] for i, (g, w) in _top(d["boots"], 3)],
            "start": [[s, _r(g), _r(w)] for s, (g, w) in _top(d["start"], 3)],
            "skills": [skill[0], skill_priority(skill[0]), _r(skill[1][0]), _r(skill[1][1])] if skill else None,
            "items": [[_r(d["rank_g"][k]), [[i, _r(g), _r(w)] for i, (g, w) in _top(d["ranks"][k], 6)]]
                      for k in sorted(d["ranks"])],
            "builds": [[list(k), _r(g), _r(w)] for k, (g, w) in seqs[:3]],
        }
        out.append([champ, role, entry])
    return out
