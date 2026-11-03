"""Meilleure page de runes par champion et rôle, ajustée face au vis-à-vis.

Méthode, choix après choix (une page complète exacte est trop rare dans les données) :
1. la rune clé : meilleur winrate lissé parmi celles assez jouées (jusqu'à 3 gardées) ;
2. pour chaque rune clé gardée : chaque rune mineure, l'arbre secondaire et sa paire,
   chaque fragment, toujours parmi les options assez jouées avec cette rune clé ;
3. face à un vis-à-vis précis, une autre rune clé gardée n'est proposée que si elle a
   assez de parties dans ce matchup et fait nettement mieux (lissé).
"""

from collections import defaultdict

MIN_GAMES = 30          # parties minimum pour proposer une page pour un champion et un rôle
MIN_SHARE = 0.05        # part minimale d'une option (sinon c'est du bruit)
MIN_OPTION_GAMES = 10
K_SMOOTH = 50           # lissage vers le winrate de référence
MAX_KEYSTONES = 3
VS_MIN_GAMES = 30      # parties minimum dans le matchup pour changer de rune clé
VS_MIN_LIFT = 0.02      # +2 points lissés face à ce vis-à-vis pour changer de rune clé


def smoothed(g: float, w: float, ref: float, k: float = K_SMOOTH) -> float:
    return (w + k * ref) / (g + k)


def pick(options: dict, ref: float, total: float):
    """options : valeur -> [parties, victoires]. Meilleure option assez jouée, sinon la plus jouée."""
    floor = max(MIN_OPTION_GAMES, MIN_SHARE * total)
    eligible = {v: gw for v, gw in options.items() if gw[0] >= floor}
    pool = eligible or options
    if not eligible:
        return max(pool, key=lambda v: pool[v][0])
    return max(pool, key=lambda v: (smoothed(*pool[v], ref), pool[v][0]))


def compute_runes(rows: list[tuple], laner_rows: list[tuple]) -> dict:
    """rows : (champ, role, keystone, pstyle, p1, p2, p3, sstyle, s1, s2, sh1, sh2, sh3, win, w)
    laner_rows : (champ, role, opp, keystone, win, w)
    Renvoie {"pages": [[champ, role, [[k, g, w, pstyle, [p1,p2,p3], sstyle, [s1,s2], [sh1,sh2,sh3]], ...]], ...],
             "vs": [[champ, role, opp, keystone, g, w], ...]}"""
    groups: dict[tuple, list] = defaultdict(list)
    for r in rows:
        groups[(r[0], r[1])].append(r)

    pages, kept = [], {}
    for (champ, role), rs in groups.items():
        total = sum(r[14] for r in rs)
        if total < MIN_GAMES:
            continue
        ref = sum(r[14] * r[13] for r in rs) / total
        by_key: dict[int, list] = defaultdict(lambda: [0.0, 0.0])
        for r in rs:
            by_key[r[2]][0] += r[14]
            by_key[r[2]][1] += r[14] * r[13]
        floor = max(MIN_OPTION_GAMES, MIN_SHARE * total)
        ranked = sorted((k for k, gw in by_key.items() if gw[0] >= floor),
                        key=lambda k: smoothed(*by_key[k], ref), reverse=True)[:MAX_KEYSTONES]
        if not ranked:
            ranked = [max(by_key, key=lambda k: by_key[k][0])]

        entry = []
        for key in ranked:
            sub = [r for r in rs if r[2] == key]
            g_k, w_k = by_key[key]
            ref_k = w_k / g_k if g_k else ref

            def tally(index_fn, subset=sub):
                opts: dict = defaultdict(lambda: [0.0, 0.0])
                for r in subset:
                    o = opts[index_fn(r)]
                    o[0] += r[14]
                    o[1] += r[14] * r[13]
                return opts

            pstyle = pick(tally(lambda r: r[3]), ref_k, g_k)
            minors = [pick(tally(lambda r, i=i: r[i]), ref_k, g_k) for i in (4, 5, 6)]
            sstyle = pick(tally(lambda r: r[7]), ref_k, g_k)
            in_style = [r for r in sub if r[7] == sstyle]
            pair = pick(tally(lambda r: (r[8], r[9]), in_style), ref_k, sum(r[14] for r in in_style))
            shards = [pick(tally(lambda r, i=i: r[i]), ref_k, g_k) for i in (10, 11, 12)]
            entry.append([key, round(g_k, 1), round(w_k, 1), pstyle, minors, sstyle, list(pair), shards])
        pages.append([champ, role, entry])
        kept[(champ, role)] = {e[0]: (e[1], e[2]) for e in entry}

    # face à un vis-à-vis : autre rune clé gardée, seulement si elle fait nettement mieux
    vs_tally: dict[tuple, dict] = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))
    for champ, role, opp, key, win, w in laner_rows:
        if key in kept.get((champ, role), {}):
            t = vs_tally[(champ, role, opp)][key]
            t[0] += w
            t[1] += w * win
    vs = []
    for (champ, role, opp), keys in vs_tally.items():
        page_keys = kept[(champ, role)]
        default = next(iter(page_keys))
        g_d, w_d = keys.get(default, [0.0, 0.0])
        ref_d = page_keys[default][1] / page_keys[default][0]
        base_d = smoothed(g_d, w_d, ref_d, 30)
        best, best_score = None, base_d + VS_MIN_LIFT
        for key, (g, w) in keys.items():
            if key == default or g < VS_MIN_GAMES:
                continue
            ref_k = page_keys[key][1] / page_keys[key][0]
            score = smoothed(g, w, ref_k, 30)
            if score >= best_score:
                best, best_score = key, score
        if best is not None:
            g, w = keys[best]
            vs.append([champ, role, opp, best, round(g, 1), round(w, 1)])
    return {"pages": pages, "vs": vs}
