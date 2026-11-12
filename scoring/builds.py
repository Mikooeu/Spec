"""Page champion : sorts d'invocateur, ordre des sorts, objets de départ, bottes, objets 1 à 5 (6 en ADC)
et builds complets, par champion et rôle.

Sources : table `builds` du collecteur. Sorts et bottes viennent de toutes les parties détaillées ;
l'ordre des sorts, les objets de départ et l'ordre des objets viennent des parties avec déroulé (1 sur 3).
Chaque ligne d'entrée est pondérée (patch précédent à 50 % quand le patch actuel a peu de parties).
"""

from collections import Counter, defaultdict

from .items import Items

START_MAX_SECONDS = 90     # achats de la première visite en boutique
# Balises de départ (totem, lentille, longue-vue) : gratuites et changées selon le rôle ou la game, elles
# ne font pas partie du combo. Sans ce filtre, « Lame de Doran » sortait deux fois (avec et sans balise).
TRINKETS = {3340, 3363, 3364}
SKILL_LEVELS = 15          # on compare les ordres sur les 15 premiers niveaux
SKILL_FALLBACK = 11
MIN_SEQ_GAMES = 10         # build complet : parties minimum pour un enchaînement exact
K_SMOOTH = 20
FLASH = 4
VS_MIN_GAMES = 30          # sorts par matchup : parties minimum face à ce champion
VS_MIN_OPTION = 10
VS_MIN_LIFT = 0.02         # +2 points lissés pour changer de sorts face à ce champion


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


def boots_position(purchases: str, items: Items) -> int | None:
    """Nombre d'objets légendaires finis avant les bottes (0 : bottes avant le premier objet). None : pas de bottes."""
    seen: list[int] = []
    for part in purchases.split(","):
        if not part:
            continue
        item = int(part.split("@")[0])
        if item in items.boots:
            return len(seen)
        if item in items.legendary and item not in seen:
            seen.append(item)
    return None


def starting_items(purchases: str) -> str | None:
    first = sorted(item for item, at in (map(int, p.split("@")) for p in purchases.split(",") if p)
                   if at <= START_MAX_SECONDS and item not in TRINKETS)
    return ",".join(map(str, first)) or None


def skill_priority(order: str) -> str:
    """« R > Q > W > E » : R d'abord, puis les sorts selon les points mis (à égalité, le premier monté)."""
    basics = sorted("QWE", key=lambda s: (-order.count(s), order.find(s) if s in order else 99))
    return " > ".join(["R", *basics])


def spells_vs(default: tuple, by_opp: dict) -> list:
    """Sorts face à un vis-à-vis précis, seulement s'ils font nettement mieux que les sorts habituels
    dans ce matchup. Flash est toujours gardé si les sorts habituels l'ont."""
    out = []
    for opp, pairs in by_opp.items():
        total = sum(g for g, _ in pairs.values())
        if total < VS_MIN_GAMES:
            continue
        ref = sum(w for _, w in pairs.values()) / total
        score = lambda gw: (gw[1] + K_SMOOTH * ref) / (gw[0] + K_SMOOTH)
        base = score(pairs.get(default, [0.0, 0.0]))
        floor = max(VS_MIN_OPTION, 0.05 * total)
        best, best_score = None, base + VS_MIN_LIFT
        for pair, gw in pairs.items():
            if pair == default or gw[0] < floor or (FLASH in default and FLASH not in pair):
                continue
            if score(gw) >= best_score:
                best, best_score = pair, score(gw)
        if best is not None:
            g, w = pairs[best]
            out.append([opp, best[0], best[1], _r(g), _r(w)])
    return sorted(out)


def compute_builds(rows, items: Items) -> list:
    """rows : (champ, role, win, w, spell1, spell2, items, skills, purchases[, adversaire de lane]).
    Lues une seule fois (un générateur suffit). Renvoie [[champ, role, {...}], ...] pour l'export JSON."""
    per: dict = defaultdict(lambda: {"g": 0.0, "tg": 0.0, "spells": {}, "boots": {}, "boots_at": {}, "start": {},
                                     "skills": {}, "ranks": defaultdict(dict), "rank_g": Counter(), "seq": {},
                                     "vs": defaultdict(dict), "support": {}})
    for row in rows:
        champ, role, win, w, s1, s2, final, skills, purchases = row[:9]
        opp = row[9] if len(row) > 9 else None
        d = per[(champ, role)]
        d["g"] += w
        _add(d["spells"], (s1, s2), win, w)
        if opp is not None:
            _add(d["vs"][opp], (s1, s2), win, w)
        inventory = [int(x) for x in (final or "").split(",") if x]
        boots = [x for x in inventory if x in items.boots]
        if boots:
            _add(d["boots"], boots[0], win, w)
        if role == "UTILITY":   # évolution choisie à la fin de la quête de support
            evo = [x for x in inventory if x in items.support_final]
            if evo:
                _add(d["support"], evo[0], win, w)
        if purchases is None:
            continue
        d["tg"] += w
        start = starting_items(purchases)
        if start:
            _add(d["start"], start, win, w)
        if skills and len(skills) >= SKILL_FALLBACK:
            _add(d["skills"], skills[:SKILL_LEVELS] if len(skills) >= SKILL_LEVELS else skills[:SKILL_FALLBACK], win, w)
        at = boots_position(purchases, items)
        if at is not None:
            _add(d["boots_at"], at, win, w)
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
        if d["boots_at"]:   # place des bottes dans le build : la plus fréquente
            (at, (g, _)), = _top(d["boots_at"], 1)
            entry["bootsAt"] = [at, _r(g)]
        if d["support"]:
            entry["support"] = [[i, _r(g), _r(w)] for i, (g, w) in _top(d["support"], 5)]
        top_spells = _top(d["spells"], 1)
        vs = spells_vs(top_spells[0][0], d["vs"]) if top_spells else []
        if vs:
            entry["spellsVs"] = vs
        out.append([champ, role, entry])
    return out
