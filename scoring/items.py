"""Catalogue des objets (Data Dragon) : quels objets sont des bottes, lesquels sont des objets « finis »."""

import json
from pathlib import Path

import httpx

from .champions import DDRAGON

LEGENDARY_MIN_GOLD = 2000   # les composants coûtent moins de 1 400 PO, les objets finis 2 200 et plus


def fetch_items(cache: Path, version: str) -> dict:
    cached = json.loads(cache.read_text("utf-8")) if cache.exists() else {}
    if cached.get("version") == version:
        return cached
    with httpx.Client(timeout=15) as http:
        data = http.get(f"{DDRAGON}/cdn/{version}/data/en_US/item.json").json()["data"]
    payload = {"version": version, "items": {k: {
        "gold": v.get("gold", {}).get("total", 0),
        "purchasable": v.get("gold", {}).get("purchasable", False),
        "tags": v.get("tags", []),
        "into": v.get("into", []),
        "rift": v.get("maps", {}).get("11", False),
    } for k, v in data.items()}}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(payload), "utf-8")
    return payload


class Items:
    def __init__(self, payload: dict | None):
        self.boots: set[int] = set()
        self.legendary: set[int] = set()
        for key, it in ((payload or {}).get("items") or {}).items():
            if not key.isdigit() or not it.get("rift"):
                continue
            item = int(key)
            tags = set(it.get("tags", []))
            if "Boots" in tags:
                if item != 1001:                       # bottes de base exclues
                    self.boots.add(item)
            elif (it.get("purchasable") and not it.get("into") and it.get("gold", 0) >= LEGENDARY_MIN_GOLD
                  and "Consumable" not in tags and "Trinket" not in tags):
                self.legendary.add(item)

    @classmethod
    def load(cls, cache: Path, version: str | None = None) -> "Items":
        if version:
            try:
                return cls(fetch_items(cache, version))
            except httpx.HTTPError:
                pass
        return cls(json.loads(cache.read_text("utf-8")) if cache.exists() else None)
