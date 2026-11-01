"""Correspondance noms <-> identifiants des champions, via Data Dragon (CDN officiel de Riot, sans clé)."""

import difflib
import json
import re
from pathlib import Path

import httpx

DDRAGON = "https://ddragon.leagueoflegends.com"


def normalize(name: str) -> str:
    """'Kai'Sa', 'kaisa', 'Lee Sin', 'leesin' -> même clé."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def fetch_champions(cache: Path) -> dict:
    """Télécharge la liste des champions du dernier patch et la met en cache."""
    with httpx.Client(timeout=15) as http:
        version = http.get(f"{DDRAGON}/api/versions.json").json()[0]
        cached = json.loads(cache.read_text("utf-8")) if cache.exists() else {}
        if cached.get("version") == version:
            return cached
        data = http.get(f"{DDRAGON}/cdn/{version}/data/en_US/champion.json").json()["data"]
    champions = {
        "version": version,
        "champions": [{"id": int(c["key"]), "key": c["id"], "name": c["name"]} for c in data.values()],
    }
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(champions, ensure_ascii=False, indent=1), "utf-8")
    return champions


class Champions:
    def __init__(self, payload: dict):
        self.version = payload.get("version", "?")
        self.by_id = {c["id"]: c["name"] for c in payload["champions"]}
        self.keys = {c["id"]: (c["key"], c["name"]) for c in payload["champions"]}  # key = nom de fichier d'icône
        self._lookup = {}
        for c in payload["champions"]:
            # nom affiché ('Wukong') et identifiant technique ('MonkeyKing') acceptés
            self._lookup[normalize(c["name"])] = c["id"]
            self._lookup[normalize(c["key"])] = c["id"]

    @classmethod
    def load(cls, cache: Path, refresh: bool = False) -> "Champions":
        if refresh or not cache.exists():
            return cls(fetch_champions(cache))
        return cls(json.loads(cache.read_text("utf-8")))

    def name(self, champ_id: int) -> str:
        return self.by_id.get(champ_id, f"#{champ_id}")

    def resolve(self, name: str) -> int:
        key = normalize(name)
        if key in self._lookup:
            return self._lookup[key]
        guesses = difflib.get_close_matches(key, self._lookup.keys(), n=3, cutoff=0.6)
        hint = ", ".join(self.name(self._lookup[g]) for g in guesses)
        raise ValueError(f"Champion inconnu : « {name.strip()} »" + (f" (tu voulais dire : {hint} ?)" if hint else ""))
