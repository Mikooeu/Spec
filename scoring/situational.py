"""Objets et runes adaptés à la draft adverse.

Pour chaque champion dans son rôle, on compare ce que les joueurs Master+ achètent (inventaire final) et les runes
qu'ils prennent selon l'équipe d'en face : beaucoup d'AP, beaucoup d'AD, plusieurs tanks, plusieurs soigneurs.
Un choix est retenu quand il est nettement plus fréquent dans cette situation qu'ailleurs : c'est une adaptation
que les bons joueurs font vraiment (Bottes de mercure face à l'AP, anti-soin face aux soigneurs…).

On mesure ce que les joueurs adaptent, pas le winrate de l'objet : à ce volume de parties, l'écart de winrate
d'un objet dans une situation précise est trop bruité pour être fiable, la fréquence ne l'est pas.
"""

from collections import Counter

from .items import Items
from .traits import Trait, profile, situations

MIN_GAMES = 40          # parties minimum dans la situation, et hors situation
MIN_RATE = 0.12         # pris dans au moins 12 % des parties de la situation
MIN_GAP = 0.06          # au moins 6 points de plus qu'ailleurs
MIN_LIFT = 1.4          # et 1,4 fois plus souvent
TOP = 3


def _keep(c_in: Counter, n_in: float, c_out: Counter, n_out: float) -> list:
    out = []
    for key, g in c_in.items():
        rin, rout = g / n_in, c_out.get(key, 0) / n_out
        if rin >= MIN_RATE and rin - rout >= MIN_GAP and rin >= MIN_LIFT * rout:
            out.append((rin - rout, [key, round(rin, 3), round(rout, 3)]))
    return [x for _, x in sorted(out, key=lambda t: -t[0])[:TOP]]


def compute_situational(rows, traits: dict[int, Trait], items: Items) -> list:
    """rows : (champion, rôle, poids, objets « 3089,3020 », runes [ids] ou None, ennemis « 1,2,3,4,5 »).
    Renvoie [champion, rôle, situation, parties, [[objet, part dans la situation, part ailleurs]], [[rune, …]]]."""
    # objets finis et bottes ; sans catalogue (tests), tous les objets
    wanted = (items.legendary | items.boots | items.support_final) if items.legendary else set()
    totals: dict[tuple, list] = {}
    for champ, role, w, item_str, runes, enemies in rows:
        enemy_ids = [int(e) for e in (enemies or "").split(",") if e]
        sits = situations(profile(traits, enemy_ids))
        bought = {int(i) for i in (item_str or "").split(",") if i and (not wanted or int(i) in wanted)}
        picked = {int(r) for r in (runes or []) if r}
        t = totals.setdefault((champ, role), [0.0, Counter(), Counter(), {}])
        t[0] += w
        for i in bought:
            t[1][i] += w
        for r in picked:
            t[2][r] += w
        for s in sits:
            st = t[3].setdefault(s, [0.0, Counter(), Counter()])
            st[0] += w
            for i in bought:
                st[1][i] += w
            for r in picked:
                st[2][r] += w

    out = []
    for (champ, role), (n, all_items, all_runes, by_sit) in totals.items():
        for s, (n_in, it_in, ru_in) in by_sit.items():
            n_out = n - n_in
            if n_in < MIN_GAMES or n_out < MIN_GAMES:
                continue
            it = _keep(it_in, n_in, all_items - it_in, n_out)
            ru = _keep(ru_in, n_in, all_runes - ru_in, n_out)
            if it or ru:
                out.append([champ, role, s, round(n_in, 1), it, ru])
    return out
