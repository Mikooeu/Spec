"""Catalogue des objets (Data Dragon) : quels objets sont des bottes, lesquels sont des objets « finis »."""

import json
from pathlib import Path

import httpx

from .champions import DDRAGON

LEGENDARY_MIN_GOLD = 2000   # les composants coûtent moins de 1 400 PO, les objets finis 2 200 et plus


def fetch_items(cache: Path, version: str) -> dict:
    cached = json.loads(cache.read_text("utf-8")) if cache.exists() else {}
    if cached.get("version") == version and cached.get("schema") == 2:
        return cached
    with httpx.Client(timeout=15) as http:
        data = http.get(f"{DDRAGON}/cdn/{version}/data/en_US/item.json").json()["data"]
    payload = {"version": version, "schema": 2, "items": {k: {
        "name": v.get("name", ""),
        "gold": v.get("gold", {}).get("total", 0),
        "purchasable": v.get("gold", {}).get("purchasable", False),
        "tags": v.get("tags", []),
        "into": v.get("into", []),
        "rift": v.get("maps", {}).get("11", False),
    } for k, v in data.items()}}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(payload), "utf-8")
    return payload


# Évolutions finales de l'objet de support (quête de support : Atlas mondial → … → Prime des mondes → 1 choix).
# Valeurs de secours si Data Dragon ne donne pas la chaîne (cache ancien, hors ligne).
SUPPORT_ROOT = "World Atlas"
SUPPORT_FINAL_FALLBACK = {3869, 3870, 3871, 3876, 3877}


class Items:
    def __init__(self, payload: dict | None):
        self.boots: set[int] = set()
        self.legendary: set[int] = set()
        self.support_final: set[int] = set()
        catalog = (payload or {}).get("items") or {}
        roots = [k for k, it in catalog.items() if it.get("name") == SUPPORT_ROOT]
        seen, todo = set(), list(roots)
        while todo:                       # descendants de l'Atlas mondial par « into »
            k = todo.pop()
            if k in seen or k not in catalog:
                continue
            seen.add(k)
            nxt = catalog[k].get("into", [])
            if not nxt and k not in roots and k.isdigit():
                self.support_final.add(int(k))
            todo.extend(nxt)
        if not self.support_final:
            self.support_final = set(SUPPORT_FINAL_FALLBACK)
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
