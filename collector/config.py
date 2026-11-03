"""Configuration lue depuis le fichier .env (jamais depuis le code)."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    api_key: str
    platform: str           # routage plateforme, ex. euw1 (league-v4)
    region: str             # routage régional, ex. europe (match-v5)
    db_path: Path
    days_back: int          # profondeur max d'historique lors du premier passage
    ladder_refresh_hours: float
    region_limit_2min: int  # part du budget match-v5 (100 / 2 min) laissée au collecteur
    name: str = "euw"       # région Spec : euw, kr ou na


# Régions collectées. Riot compte le débit séparément pour chaque routage : seul l'EUW partage
# son budget (europe) avec le serveur Spec, KR et NA peuvent presque tout prendre.
REGIONS = {
    "euw": ("euw1", "europe", None, 65),
    "kr": ("kr", "asia", "data/draft-kr.duckdb", 90),
    "na": ("na1", "americas", "data/draft-na.duckdb", 90),
}


def db_path_for(name: str) -> Path:
    """Base de parties d'une région (l'EUW garde data/draft.duckdb ou DB_PATH)."""
    if name not in REGIONS:
        raise SystemExit(f"Région inconnue : {name} (choix : {', '.join(REGIONS)})")
    default = REGIONS[name][2]
    if default is None:
        return Path(os.getenv("DB_PATH", "data/draft.duckdb"))
    return Path(os.getenv("DB_PATH", "data/draft.duckdb")).parent / Path(default).name


def load_config(name: str = "euw") -> Config:
    load_dotenv()
    key = os.getenv("RIOT_API_KEY", "").strip()
    if not key or not key.startswith("RGAPI-") or "xxxx" in key:
        raise SystemExit(
            "RIOT_API_KEY manquante ou invalide : copie .env.example en .env "
            "et colle ta Personal API Key dedans."
        )
    platform, routing, _, limit = REGIONS[name] if name in REGIONS else REGIONS["euw"]
    db_path = db_path_for(name)
    if name == "euw":
        platform = os.getenv("RIOT_PLATFORM", platform)
        routing = os.getenv("RIOT_REGION", routing)
        limit = int(os.getenv("RIOT_REGION_LIMIT_2MIN", str(limit)))
    return Config(
        api_key=key,
        platform=platform,
        region=routing,
        db_path=db_path,
        days_back=int(os.getenv("DAYS_BACK", "14")),
        ladder_refresh_hours=float(os.getenv("LADDER_REFRESH_HOURS", "6")),
        region_limit_2min=max(10, min(95, limit)),
        name=name,
    )
