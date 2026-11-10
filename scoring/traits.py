"""Traits de composition des champions (type de dégâts, frontline, engage, contrôle, soins).

La table est faite à la main dans l'appli (app/src/lib/composition.ts) : on la relit ici pour que la VM et
l'appli classent les équipes de la même façon. Les dégâts mesurés en Master+ (table `damage`) remplacent
la lettre de la table dès qu'un champion a assez de parties.
"""

import re
from dataclasses import dataclass
from pathlib import Path

TABLE_PATH = Path(__file__).resolve().parents[1] / "app" / "src" / "lib" / "composition.ts"
DAMAGE_MIN_GAMES = 30

# seuils partagés avec analyzeTeam (composition.ts)
HEAVY_AD = 0.75
HEAVY_AP = 0.75
MIN_KNOWN = 3


@dataclass(frozen=True)
class Trait:
    ad: float
    ap: float
    weight: float
    front: int
    engage: int
    cc: int
    healer: bool


def parse_table(text: str) -> tuple[dict[str, str], set[str]]:
    body = text[text.index("const TABLE"):]
    body = body[:body.index("};")]
    table = dict(re.findall(r"(\w+):\s*\"([APMapm][0-2][0-2][0-2])\"", body))
    heal_block = text[text.index("HEALERS"):]
    heal_block = heal_block[:heal_block.index("]")]
    return table, set(re.findall(r"\"(\w+)\"", heal_block))


def load_traits(keys: dict[int, tuple[str, str]], damage: dict[int, tuple[float, float, float]] | None = None,
                path: Path = TABLE_PATH) -> dict[int, Trait]:
    """keys : champion -> (clé Data Dragon, nom) ; damage : champion -> (part AD, part AP, parties)."""
    if not path.exists():
        return {}
    table, healers = parse_table(path.read_text("utf-8"))
    out = {}
    for champ, (key, _) in keys.items():
        code = table.get(key)
        if not code:
            continue
        d = code[0]
        measured = (damage or {}).get(champ)
        if measured and measured[2] >= DAMAGE_MIN_GAMES:
            ad, ap = measured[0], measured[1]
        else:
            ad, ap = {"A": (0.9, 0.1), "P": (0.1, 0.9)}.get(d.upper(), (0.5, 0.5))
        out[champ] = Trait(ad, ap, 1.0 if d.isupper() else 0.4, int(code[1]), int(code[2]), int(code[3]),
                           key in healers)
    return out


@dataclass
class Profile:
    known: int
    ad: float
    ap: float
    front: int
    engage: int
    cc: int
    healers: int


def profile(traits: dict[int, Trait], champs) -> Profile:
    ts = [traits[c] for c in champs if c in traits]
    w = sum(t.weight for t in ts)
    return Profile(len(ts), sum(t.ad * t.weight for t in ts) / w if w else 0.5,
                   sum(t.ap * t.weight for t in ts) / w if w else 0.5,
                   sum(t.front for t in ts), sum(t.engage for t in ts), sum(t.cc for t in ts),
                   sum(t.healer for t in ts))


def comp_features(p: Profile, min_known: int = MIN_KNOWN) -> tuple[float, float, float, float]:
    """Manques d'une équipe, de 0 (aucun) à 1 (le pire) : dégâts trop d'un seul type, frontline, engage, contrôle.
    Rien tant que moins de 3 champions sont connus (comme les alertes de l'appli)."""
    if p.known < min_known:
        return (0.0, 0.0, 0.0, 0.0)
    dmg = max(0.0, p.ad - HEAVY_AD) / (1 - HEAVY_AD) + max(0.0, p.ap - HEAVY_AP) / (1 - HEAVY_AP)
    return (min(dmg, 1.0), max(0, 2 - p.front) / 2, max(0, 2 - p.engage) / 2, max(0, 3 - p.cc) / 3)


# situations de la draft adverse pour lesquelles on cherche les objets et runes que les joueurs adaptent
SITUATIONS = ("ap", "ad", "tank", "heal")


def situations(p: Profile) -> list[str]:
    """Situations reconnues dans une équipe adverse complète ou presque (au moins 3 champions connus)."""
    if p.known < MIN_KNOWN:
        return []
    out = []
    if p.ap >= 0.6:
        out.append("ap")
    if p.ad >= HEAVY_AD:
        out.append("ad")
    if p.front >= 4:
        out.append("tank")
    if p.healers >= 2:
        out.append("heal")
    return out
