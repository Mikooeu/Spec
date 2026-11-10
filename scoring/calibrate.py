"""Calibrage (étape 4) : le score prédit-il mieux la victoire que le winrate de base seul ?

1. On met de côté 10 % des parties (toujours les mêmes) et on calcule les stats sur les 90 % restantes.
2. Pour chaque joueur des parties mises de côté, on prédit sa victoire avec :
   - 50 % (aucune information),
   - le winrate de base de son champion dans son rôle,
   - le score complet, pour plusieurs réglages de α, β et k.
3. On garde le réglage qui prédit le mieux (log loss la plus basse) et on l'écrit dans data/params.json.
"""

import logging
import math
from dataclasses import dataclass
from pathlib import Path

from collector.db import connect_with_retry

from .build import HOLDOUT_SQL, build_stats
from dataclasses import replace

from .score import ROLES, Params, Stats, comp_penalty, score_champion, team_strength
from .traits import comp_features, profile

log = logging.getLogger(__name__)

MIN_TEST_MATCHES = 2000            # en dessous, le résultat est trop bruité pour régler quoi que ce soit
WEIGHTS = (0.0, 0.25, 0.5, 0.75, 1.0)
TEAM_SCALES = (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.25, 1.5)
SMOOTHINGS = (25, 50, 100, 200)


@dataclass
class Evaluation:
    label: str
    log_loss: float
    brier: float
    accuracy: float
    params: Params | None = None


def load_holdout(db_path: Path, patch: str, previous: str | None) -> list[list[tuple]]:
    con = connect_with_retry(str(db_path), read_only=True)
    try:
        rows = con.execute(f"""
            SELECT pa.match_id, pa.team_id, pa.champion_id, pa.team_position, pa.win
            FROM participants pa JOIN matches m USING (match_id)
            WHERE NOT m.is_remake AND pa.team_position <> '' AND m.patch IN (?, ?)
              AND {HOLDOUT_SQL}
            ORDER BY pa.match_id""", [patch, previous or patch]).fetchall()
    finally:
        con.close()
    matches: dict[str, list[tuple]] = {}
    for match_id, team, champ, role, win in rows:
        matches.setdefault(match_id, []).append((team, champ, role, bool(win)))
    # on ne garde que les parties complètes : 5 joueurs par équipe, rôles connus
    return [m for m in matches.values()
            if len(m) == 10 and sum(1 for p in m if p[0] == 100) == 5
            and all(p[2] in ROLES for p in m)]


def evaluate(predictions: list[float], outcomes: list[bool], label: str,
             params: Params | None = None) -> Evaluation:
    n = len(outcomes)
    ll = brier = correct = 0.0
    for p, y in zip(predictions, outcomes):
        p = min(max(p, 0.01), 0.99)
        ll -= math.log(p if y else 1 - p)
        brier += (p - y) ** 2
        correct += (p > 0.5) == y
    return Evaluation(label, ll / n, brier / n, correct / n, params)


def calibrate(db_path: Path, train_stats_path: Path) -> tuple[list[Evaluation], dict]:
    meta = build_stats(db_path, train_stats_path, holdout=True)
    stats = Stats.load(train_stats_path)
    test = load_holdout(db_path, meta["patch"], meta["previous_patch"] or None)
    info = {"test_matches": len(test), "train_matches": int(meta["matches"]), "patch": meta["patch"],
            "stats": stats, "test": test}
    if not test:
        return [], info

    outcomes = [p[3] for m in test for p in m]
    results = [evaluate([0.5] * len(outcomes), outcomes, "Sans information (50 %)")]

    for k in SMOOTHINGS:
        # composantes brutes (α = β = 1) calculées une fois par lissage, puis recombinées
        raw = Params(alpha=1.0, beta=1.0, k_base=k, k_delta=k)
        comps = []
        for match in test:
            for team, champ, role, _ in match:
                allies = [c for t, c, _, _ in match if t == team and c != champ]
                enemies = [c for t, c, _, _ in match if t != team]
                r = score_champion(stats, champ, role, allies, enemies, raw)
                comps.append((r.base, r.lane, r.counters, r.synergies))
        results.append(evaluate([c[0] for c in comps], outcomes, f"Winrate de base seul (k={k})",
                                Params(alpha=0, beta=0, k_base=k, k_delta=k)))
        for a in WEIGHTS:
            for b in WEIGHTS:
                preds = [base + lane + a * cnt + b * syn for base, lane, cnt, syn in comps]
                results.append(evaluate(preds, outcomes, f"Score complet (α={a}, β={b}, k={k})",
                                        Params(alpha=a, beta=b, k_base=k, k_delta=k)))
    return results, info


def calibrate_team(stats: Stats, test: list[list[tuple]], params: Params) -> tuple[Evaluation, Evaluation]:
    """Probabilité de victoire d'équipe (barre du haut de la draft) : une prédiction par partie, équipe bleue.
    Renvoie (50 %, meilleure échelle) ; l'échelle retenue est dans `params` du second résultat."""
    diffs, outcomes = [], []
    for match in test:
        blue = [(c, r) for t, c, r, _ in match if t == 100]
        red = [(c, r) for t, c, r, _ in match if t != 100]
        diffs.append(team_strength(stats, blue, [c for c, _ in red], params)
                     - team_strength(stats, red, [c for c, _ in blue], params))
        outcomes.append(next(w for t, _, _, w in match if t == 100))
    neutral = evaluate([0.5] * len(outcomes), outcomes, "Équipe : sans information (50 %)")
    best = min((evaluate([1 / (1 + math.exp(-s * d)) for d in diffs], outcomes, f"Équipe : échelle {s}",
                         replace(params, team=s)) for s in TEAM_SCALES), key=lambda e: e.log_loss)
    return neutral, best


COMP_LABELS = ("dégâts d'un seul type", "frontline", "engage", "contrôle")


def _team_inputs(stats: Stats, test: list[list[tuple]], params: Params):
    """Pour chaque partie : écart de force (équipe bleue − rouge), écart des manques (rouge − bleue), victoire bleue."""
    rows = []
    for match in test:
        blue = [(c, r) for t, c, r, _ in match if t == 100]
        red = [(c, r) for t, c, r, _ in match if t != 100]
        d = (team_strength(stats, blue, [c for c, _ in red], params)
             - team_strength(stats, red, [c for c, _ in blue], params))
        fb = comp_features(profile(stats.traits, [c for c, _ in blue]))
        fr = comp_features(profile(stats.traits, [c for c, _ in red]))
        rows.append((params.team * d, [r - b for r, b in zip(fr, fb)], next(w for t, _, _, w in match if t == 100)))
    return rows


def _fit(rows, steps: int = 400, lr: float = 0.5) -> list[float]:
    """Régression logistique des 4 poids de composition (le reste du modèle sert de point de départ),
    poids gardés positifs : un manque ne peut pas faire gagner."""
    w = [0.0] * 4
    n = len(rows) or 1
    for _ in range(steps):
        grad = [0.0] * 4
        for offset, x, y in rows:
            p = 1 / (1 + math.exp(-(offset + sum(wi * xi for wi, xi in zip(w, x)))))
            for i in range(4):
                grad[i] += (p - y) * x[i]
        w = [max(0.0, wi - lr * g / n) for wi, g in zip(w, grad)]
    return w


def _loss(rows, w) -> float:
    total = 0.0
    for offset, x, y in rows:
        p = min(max(1 / (1 + math.exp(-(offset + sum(wi * xi for wi, xi in zip(w, x))))), 0.01), 0.99)
        total -= math.log(p if y else 1 - p)
    return total / (len(rows) or 1)


def calibrate_composition(stats: Stats, test: list[list[tuple]], params: Params) -> tuple[float, float, Params]:
    """Les manques de composition prédisent-ils la défaite, en plus des champions eux-mêmes ?
    Validation croisée en 2 moitiés : les poids appris sur une moitié sont testés sur l'autre.
    Renvoie (log loss sans, log loss avec, réglages) ; les poids ne sont gardés que s'ils font mieux."""
    if not stats.traits or not params.team:
        return 0.0, 0.0, params
    rows = _team_inputs(stats, test, params)
    a, b = rows[0::2], rows[1::2]
    without = (_loss(a, [0] * 4) + _loss(b, [0] * 4)) / 2
    with_comp = (_loss(b, _fit(a)) + _loss(a, _fit(b))) / 2
    if with_comp >= without:
        return without, with_comp, replace(params, comp_dmg=0, comp_front=0, comp_engage=0, comp_cc=0)
    w = [round(x, 3) for x in _fit(rows)]
    return without, with_comp, replace(params, comp_dmg=w[0], comp_front=w[1], comp_engage=w[2], comp_cc=w[3])
