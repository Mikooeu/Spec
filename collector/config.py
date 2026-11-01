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


def load_config() -> Config:
    load_dotenv()
    key = os.getenv("RIOT_API_KEY", "").strip()
    if not key or not key.startswith("RGAPI-") or "xxxx" in key:
        raise SystemExit(
            "RIOT_API_KEY manquante ou invalide : copie .env.example en .env "
            "et colle ta Personal API Key dedans."
        )
    return Config(
        api_key=key,
        platform=os.getenv("RIOT_PLATFORM", "euw1"),
        region=os.getenv("RIOT_REGION", "europe"),
        db_path=Path(os.getenv("DB_PATH", "data/draft.duckdb")),
        days_back=int(os.getenv("DAYS_BACK", "14")),
        ladder_refresh_hours=float(os.getenv("LADDER_REFRESH_HOURS", "6")),
        region_limit_2min=max(10, min(95, int(os.getenv("RIOT_REGION_LIMIT_2MIN", "65")))),
    )
