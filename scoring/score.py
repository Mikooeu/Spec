"""Calcul du score d'un champion dans un draft (formule de la spec).

Score(c) = WR(c,R) + Σe pe(R)·Δlane(c,e) + α·Σe (1 − pe(R))·Δvs(c,e) + β·Σa Δavec(c,a)

Chaque winrate est lissé : (victoires + k·référence) / (parties + k).
Pour un Δ, la référence est WR(c,R) : un matchup joué 5 fois pèse presque zéro.
"""

import json
import math
from dataclasses import asdict, dataclass, field
from pathlib import Path

from collector.db import connect_with_retry

ROLES = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY")
ROLE_ALIASES = {
    "top": "TOP", "jungle": "JUNGLE", "jgl": "JUNGLE", "jg": "JUNGLE",
    "mid": "MIDDLE", "middle": "MIDDLE", "adc": "BOTTOM", "bot": "BOTTOM", "bottom": "BOTTOM",
    "support": "UTILITY", "supp": "UTILITY", "sup": "UTILITY", "utility": "UTILITY",
}

K_BASE = 50          # lissage du winrate de base vers 50 %
K_DELTA = 50         # lissage des écarts vers 0
ALPHA = 0.5          # poids des counters (ennemis hors vis-à-vis)
BETA = 0.5           # poids des synergies
DISCOVERY_MIN_GAMES = 200
LOW_DATA_GAMES = 200


def parse_role(text: str) -> str:
    role = ROLE_ALIASES.get(text.strip().lower())
    if not role:
        raise ValueError(f"Rôle inconnu : « {text} » (top, jungle, mid, adc ou support)")
    return role


@dataclass
class Stats:
    base: dict = field(default_factory=dict)    # (champ, role) -> (games, wins)
    lane: dict = field(default_factory=dict)    # (champ, role, opp) -> (games, wins)
    vs: dict = field(default_factory=dict)      # (champ, role, opp) -> (games, wins)
    ally: dict = field(default_factory=dict)    # (champ, role, ally) -> (games, wins)
    roles: dict = field(default_factory=dict)   # champ -> {role: games}
    meta: dict = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "Stats":
        if not Path(path).exists():
            raise SystemExit("Pas encore de stats : lance d'abord `python -m scoring build`.")
        con = connect_with_retry(str(path), read_only=True)
        try:
            s = cls()
            for c, r, g, w in con.execute("SELECT champ, role, games, wins FROM base").fetchall():
                s.base[(c, r)] = (g, w)
                s.roles.setdefault(c, {})[r] = g
            for table, target in (("lane", s.lane), ("vs", s.vs)):
                for c, r, o, g, w in con.execute(f"SELECT champ, role, opp, games, wins FROM {table}").fetchall():
                    target[(c, r, o)] = (g, w)
            for c, r, a, g, w in con.execute("SELECT champ, role, ally, games, wins FROM ally").fetchall():
                s.ally[(c, r, a)] = (g, w)
            s.meta = dict(con.execute("SELECT key, value FROM meta").fetchall())
        finally:
            con.close()
        return s

    def games(self, champ: int, role: str) -> float:
        return self.base.get((champ, role), (0, 0))[0]

    def role_probability(self, champ: int, role: str) -> float:
        dist = self.roles.get(champ, {})
        total = sum(dist.values())
        return dist.get(role, 0) / total if total else 0.0


@dataclass
class Params:
    """Réglages du score. `python -m scoring calibrate` les ajuste et les écrit dans data/params.json."""
    alpha: float = ALPHA
    beta: float = BETA
    k_base: float = K_BASE
    k_delta: float = K_DELTA
    team: float = 0.0    # échelle de la probabilité de victoire d'équipe ; 0 tant que le calibrage ne l'a pas validée

    @classmethod
    def load(cls, path: Path) -> "Params":
        path = Path(path)
        if not path.exists():
            return cls()
        data = json.loads(path.read_text("utf-8"))
        return cls(**{k: float(v) for k, v in data.items() if k in cls.__dataclass_fields__})

    def save(self, path: Path, extra: dict | None = None) -> None:
        Path(path).write_text(json.dumps({**asdict(self), **(extra or {})}, indent=1), "utf-8")


def smoothed(games: float, wins: float, reference: float, k: float) -> float:
    return (wins + k * reference) / (games + k)


@dataclass
class Result:
    champ: int
    score: float
    base: float
    lane: float
    counters: float
    synergies: float
    games: float
    lane_detail: list      # [(enemy, pe(R), Δlane, games)]


def score_champion(stats: Stats, champ: int, role: str, allies: list[int], enemies: list[int],
                   params: Params | None = None) -> Result:
    p = params or Params()
    g, w = stats.base.get((champ, role), (0, 0))
    base = smoothed(g, w, 0.5, p.k_base)

    # probabilité que chaque ennemi soit le vis-à-vis, renormalisée pour ne pas dépasser 1
    probs = {e: stats.role_probability(e, role) for e in enemies}
    total = sum(probs.values())
    if total > 1:
        probs = {e: p / total for e, p in probs.items()}

    lane = counters = synergies = 0.0
    detail = []
    for e in enemies:
        lg, lw = stats.lane.get((champ, role, e), (0, 0))
        d_lane = smoothed(lg, lw, base, p.k_delta) - base
        vg, vw = stats.vs.get((champ, role, e), (0, 0))
        d_vs = smoothed(vg, vw, base, p.k_delta) - base
        lane += probs[e] * d_lane
        counters += p.alpha * (1 - probs[e]) * d_vs
        detail.append((e, probs[e], d_lane, lg))
    for a in allies:
        ag, aw = stats.ally.get((champ, role, a), (0, 0))
        synergies += p.beta * (smoothed(ag, aw, base, p.k_delta) - base)

    return Result(champ, base + lane + counters + synergies, base, lane, counters, synergies, g,
                  sorted(detail, key=lambda d: -d[1]))


def recommend(stats: Stats, role: str, pool: list[int], allies: list[int], enemies: list[int],
              bans: list[int] = (), top: int = 3,
              params: Params | None = None) -> tuple[list[Result], Result | None]:
    taken = set(allies) | set(enemies) | set(bans)
    pool_results = [score_champion(stats, c, role, allies, enemies, params)
                    for c in pool if c not in taken]
    pool_results.sort(key=lambda r: -r.score)

    pool_set = set(pool)
    candidates = [c for (c, r), (g, _) in stats.base.items()
                  if r == role and g >= DISCOVERY_MIN_GAMES and c not in pool_set and c not in taken]
    discovery = max((score_champion(stats, c, role, allies, enemies, params) for c in candidates),
                    key=lambda r: r.score, default=None)
    return pool_results[:top], discovery


def _logit(p: float) -> float:
    p = min(max(p, 0.02), 0.98)
    return math.log(p / (1 - p))


def team_strength(stats: Stats, team: list[tuple[int, str]], enemies: list[int], params: Params | None = None) -> float:
    """Somme des logits du score de chaque champion choisi, avec ses alliés et les ennemis connus."""
    champs = [c for c, _ in team]
    return sum(_logit(score_champion(stats, c, r, [a for a in champs if a != c], enemies, params).score)
               for c, r in team)


def team_win_probability(stats: Stats, ally: list[tuple[int, str]], enemy: list[tuple[int, str]],
                         params: Params | None = None) -> float:
    """Probabilité que `ally` gagne : écart des forces des deux équipes, ramené à une probabilité
    par l'échelle calibrée (`params.team`). Sans calibrage, 50 %."""
    p = params or Params()
    if not p.team:
        return 0.5
    diff = (team_strength(stats, ally, [c for c, _ in enemy], p)
            - team_strength(stats, enemy, [c for c, _ in ally], p))
    return 1 / (1 + math.exp(-p.team * diff))
