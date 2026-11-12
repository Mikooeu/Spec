"""Calcul du score d'un champion dans un draft (formule de la spec).

Score(c) = WR(c,R) + Σe pe(R)·Δlane(c,e) + α·Σe (1 − pe(R))·Δvs(c,e) + β·Σa Δavec(c,a) + composition

composition : ce que le champion corrige (ou aggrave) dans les manques de son équipe (dégâts d'un seul type,
frontline, engage, contrôle), avec des poids réglés par le calibrage ; 0 tant qu'ils n'ont pas prouvé leur utilité.
Ordre de pick : quand ton vis-à-vis n'a pas encore choisi, le classement retire en plus une part de ce que tu
perdrais s'il te contrait (exposition « à l'aveugle »).

Chaque winrate est lissé : (victoires + k·référence) / (parties + k).
Pour un Δ, la référence est WR(c,R) : un matchup joué 5 fois pèse presque zéro.
"""

import json
import math
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path

from collector.db import connect_with_retry

from .traits import comp_features, load_traits, profile


def load_champion_traits(champions_json: Path, damage: dict | None = None) -> dict:
    """Traits de composition (table de l'appli), si la liste des champions est en cache à côté des stats."""
    if not champions_json.exists():
        return {}
    data = json.loads(champions_json.read_text("utf-8"))
    return load_traits({c["id"]: (c["key"], c["name"]) for c in data.get("champions", [])}, damage)

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
# Ordre de pick. Riot ne dit pas qui a choisi avant qui : ce poids ne peut pas être calibré sur les parties.
# 0,5 = on compte la moitié de la perte d'un vrai counter (l'adversaire ne contre pas à chaque fois).
BLIND_WEIGHT = 0.5
BLIND_WORST = 3            # exposition = moyenne des 3 pires vis-à-vis
BLIND_MIN_SHARE = 0.01     # parmi les champions joués dans au moins 1 % des parties du rôle
BLIND_MIN_GAMES = 20       # et vus au moins 20 fois face à ce champion


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
    traits: dict = field(default_factory=dict)  # champ -> Trait (composition), chargé à part (load_traits)
    _exposure: dict = field(default_factory=dict, repr=False)

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
            damage = {}
            if con.execute("SELECT count(*) FROM duckdb_tables() WHERE table_name = 'damage'").fetchone()[0]:
                for c, g, ad, ap in con.execute("""SELECT champ, sum(games), sum(games * ad) / sum(games),
                                                   sum(games * ap) / sum(games) FROM damage GROUP BY 1""").fetchall():
                    damage[c] = (ad, ap, g)
        finally:
            con.close()
        s.traits = load_champion_traits(Path(path).parent / "champions.json", damage)
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
    # poids des manques de composition (dégâts d'un seul type, frontline, engage, contrôle), en logit d'équipe
    comp_dmg: float = 0.0
    comp_front: float = 0.0
    comp_engage: float = 0.0
    comp_cc: float = 0.0
    blind: float = BLIND_WEIGHT

    def comp_weights(self) -> tuple[float, float, float, float]:
        return (self.comp_dmg, self.comp_front, self.comp_engage, self.comp_cc)

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
    composition: float = 0.0
    exposure: float = 0.0  # perte moyenne face à ses 3 pires vis-à-vis (≤ 0), utilisée quand on pick à l'aveugle


def comp_penalty(stats: Stats, champs, weights, min_known: int = 3) -> float:
    """Manques de composition d'une équipe, pondérés (en logit de victoire d'équipe)."""
    if not any(weights) or not stats.traits:
        return 0.0
    prof = profile(stats.traits, champs)
    if prof.known < min_known:
        return 0.0
    return sum(w * f for w, f in zip(weights, comp_features(prof, min_known)))


def composition_term(stats: Stats, champ: int, allies: list[int], params: "Params") -> float:
    """Effet du champion sur les manques de son équipe, en points de winrate (≈ logit / 4 près de 50 %)."""
    if len(allies) < 2:
        return 0.0
    w = params.comp_weights()
    return (comp_penalty(stats, allies, w, 2) - comp_penalty(stats, [*allies, champ], w, 2)) / 4


def blind_exposure(stats: Stats, champ: int, role: str, params: "Params | None" = None) -> float:
    """Ce que le champion perd en moyenne face à ses 3 pires vis-à-vis courants (≤ 0). Proche de 0 : sûr à l'aveugle."""
    p = params or Params()
    key = (champ, role, p.k_base, p.k_delta)
    if key in stats._exposure:
        return stats._exposure[key]
    g, w = stats.base.get((champ, role), (0, 0))
    base = smoothed(g, w, 0.5, p.k_base)
    total = sum(gg for (c, r), (gg, _) in stats.base.items() if r == role) or 1
    deltas = []
    for (c, r), (gg, _) in stats.base.items():
        if r != role or c == champ or gg / total < BLIND_MIN_SHARE:
            continue
        lg, lw = stats.lane.get((champ, role, c), (0, 0))
        if lg >= BLIND_MIN_GAMES:
            deltas.append(smoothed(lg, lw, base, p.k_delta) - base)
    worst = sorted(deltas)[:BLIND_WORST]
    value = sum(min(0.0, d) for d in worst) / BLIND_WORST if worst else 0.0   # un bon vis-à-vis compte 0
    stats._exposure[key] = value
    return value


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

    comp = composition_term(stats, champ, allies, p)
    return Result(champ, base + lane + counters + synergies + comp, base, lane, counters, synergies, g,
                  sorted(detail, key=lambda d: -d[1]), comp, blind_exposure(stats, champ, role, p))


def lane_opponent_known(stats: Stats, role: str, enemies: list[int]) -> bool:
    """Ton vis-à-vis a-t-il déjà choisi ? (un adversaire joue ton rôle dans au moins la moitié de ses parties)"""
    return any(stats.role_probability(e, role) >= 0.5 for e in enemies)


CONTEXT_WEIGHT = 0.5       # classement : l’effet de la draft compte une fois et demie (le score affiché reste calibré)
DISCOVERY_MIN_BASE = 0.5   # découverte : champion fort ce patch obligatoire


def draft_gain(r: Result) -> float:
    """Ce que la draft ajoute au winrate de base : vis-à-vis, counters, synergies, composition."""
    return r.lane + r.counters + r.synergies + r.composition


def rank_value(r: Result, blind: bool, params: Params | None) -> float:
    return r.score + CONTEXT_WEIGHT * draft_gain(r) + ((params or Params()).blind * r.exposure if blind else 0.0)


def recommend(stats: Stats, role: str, pool: list[int], allies: list[int], enemies: list[int],
              bans: list[int] = (), top: int = 3,
              params: Params | None = None, blind: bool | None = None) -> tuple[list[Result], Result | None]:
    """blind : ton vis-à-vis choisit après toi ; None = déduit des ennemis déjà choisis."""
    if blind is None:
        blind = len(enemies) < 5 and not lane_opponent_known(stats, role, enemies)
    taken = set(allies) | set(enemies) | set(bans)
    pool_results = [score_champion(stats, c, role, allies, enemies, params)
                    for c in pool if c not in taken]
    pool_results.sort(key=lambda r: -rank_value(r, blind, params))

    pool_set = set(pool)
    candidates = [c for (c, r), (g, _) in stats.base.items()
                  if r == role and g >= DISCOVERY_MIN_GAMES and c not in pool_set and c not in taken]
    scored = (score_champion(stats, c, role, allies, enemies, params) for c in candidates)
    discovery = max((r for r in scored if r.base >= DISCOVERY_MIN_BASE),
                    key=lambda r: rank_value(r, blind, params), default=None)
    return pool_results[:top], discovery


def _logit(p: float) -> float:
    p = min(max(p, 0.02), 0.98)
    return math.log(p / (1 - p))


def team_strength(stats: Stats, team: list[tuple[int, str]], enemies: list[int], params: Params | None = None) -> float:
    """Somme des logits du score de chaque champion choisi (sans composition : elle est comptée pour l'équipe
    entière dans team_win_probability), avec ses alliés et les ennemis connus."""
    p = replace(params or Params(), comp_dmg=0, comp_front=0, comp_engage=0, comp_cc=0)
    champs = [c for c, _ in team]
    return sum(_logit(score_champion(stats, c, r, [a for a in champs if a != c], enemies, p).score)
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
    w = p.comp_weights()
    comp = comp_penalty(stats, [c for c, _ in enemy], w) - comp_penalty(stats, [c for c, _ in ally], w)
    return 1 / (1 + math.exp(-(p.team * diff + comp)))
