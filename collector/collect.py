"""Boucle du collecteur : ladder Master+ -> identifiants de parties -> détail des parties."""

import logging
import time

from .db import Store
from .riot import LADDER_TIERS, RANKED_SOLO_QUEUE_ID, RiotClient

log = logging.getLogger(__name__)

REMAKE_MAX_SECONDS = 300      # une partie de moins de 5 min est un remake
QUEUE_TARGET = 300            # on cherche de nouvelles parties sous ce seuil
PLAYERS_PER_DISCOVERY = 10
MATCHES_PER_BATCH = 25
OVERLAP_SECONDS = 3600        # recouvrement pour ne rater aucune partie entre deux passages
TIMELINE_EVERY = 3            # un déroulé (ordre des sorts et des achats) pour 1 partie sur 3
SKILL_KEYS = {1: "Q", 2: "W", 3: "E", 4: "R"}


def parse_match(data: dict, platform: str) -> tuple[dict, list[tuple]] | None:
    """Extrait le strict nécessaire d'une réponse match-v5. None si hors ranked solo."""
    info = data.get("info") or {}
    if info.get("queueId") != RANKED_SOLO_QUEUE_ID:
        return None
    match_id = data["metadata"]["matchId"]
    version = info.get("gameVersion", "")
    patch = ".".join(version.split(".")[:2])
    duration = int(info.get("gameDuration", 0))
    players = info.get("participants", [])
    is_remake = duration < REMAKE_MAX_SECONDS or any(
        p.get("gameEndedInEarlySurrender") for p in players)
    match = {
        "match_id": match_id,
        "platform": platform,
        "game_version": version,
        "patch": patch,
        "game_creation": int(info.get("gameCreation", 0)),
        "game_duration": duration,
        "is_remake": is_remake,
    }
    rows = [(match_id, int(p["teamId"]), int(p["championId"]),
             p.get("teamPosition") or "", bool(p["win"])) for p in players]
    match["runes"] = [r for r in (rune_row(match_id, p) for p in players) if r]
    match["bans"] = sorted({int(b["championId"]) for t in info.get("teams", [])
                            for b in t.get("bans", []) if int(b.get("championId", -1)) > 0})
    match["builds"] = [build_row(match_id, p) for p in players]
    match["damage"] = [(match_id, int(p["teamId"]), int(p["championId"]),
                        int(p.get("physicalDamageDealtToChampions") or 0), int(p.get("magicDamageDealtToChampions") or 0),
                        int(p.get("trueDamageDealtToChampions") or 0)) for p in players]
    return match, rows


def build_row(match_id: str, p: dict, skills: str | None = None, purchases: str | None = None) -> tuple:
    """Sorts d'invocateur et objets d'un participant (aucune donnée d'identité)."""
    spells = sorted(int(p.get(k) or 0) for k in ("summoner1Id", "summoner2Id"))
    # 6 emplacements + celui de la quête de rôle (depuis 2026 : les bottes des ADC) ; le bijou (item6) reste exclu
    slots = [p.get(f"item{i}") for i in range(6)] + [p.get("roleBoundItem")]
    items = ",".join(str(int(x)) for x in slots if int(x or 0) > 0)
    return (match_id, int(p["teamId"]), int(p["championId"]), p.get("teamPosition") or "",
            bool(p["win"]), spells[0], spells[1], items, skills, purchases)


def wants_timeline(match_id: str) -> bool:
    """Choix stable d'1 partie sur 3, d'après son numéro."""
    try:
        return int(match_id.rsplit("_", 1)[-1]) % TIMELINE_EVERY == 0
    except ValueError:
        return False


def parse_timeline(data: dict) -> dict[int, tuple[str, str]]:
    """Ordre des sorts et achats (annulations retirées) par participantId."""
    skills: dict[int, list[str]] = {}
    buys: dict[int, list[tuple[int, int]]] = {}
    for frame in (data.get("info") or {}).get("frames", []):
        for e in frame.get("events", []):
            pid = e.get("participantId")
            kind = e.get("type")
            if kind == "SKILL_LEVEL_UP" and e.get("levelUpType", "NORMAL") == "NORMAL":
                key = SKILL_KEYS.get(e.get("skillSlot"))
                if key and pid:
                    skills.setdefault(pid, []).append(key)
            elif kind == "ITEM_PURCHASED" and pid:
                buys.setdefault(pid, []).append((int(e.get("itemId", 0)), int(e.get("timestamp", 0)) // 1000))
            elif kind == "ITEM_UNDO" and pid:
                undone = int(e.get("beforeId") or 0)
                lst = buys.get(pid, [])
                for i in range(len(lst) - 1, -1, -1):
                    if lst[i][0] == undone:
                        del lst[i]
                        break
    out = {}
    for pid in set(skills) | set(buys):
        out[pid] = ("".join(skills.get(pid, [])),
                    ",".join(f"{item}@{sec}" for item, sec in buys.get(pid, []) if item > 0))
    return out


def attach_timeline(match: dict, players: list[dict], timeline: dict | None) -> None:
    """Complète les lignes `builds` avec le déroulé, si on l'a."""
    if not timeline:
        return
    per = parse_timeline(timeline)
    match["has_timeline"] = True
    match["builds"] = [build_row(match["match_id"], p, *per.get(int(p.get("participantId", i + 1)), (None, None)))
                       for i, p in enumerate(players)]


def rune_row(match_id: str, p: dict) -> tuple | None:
    """Page de runes d'un participant, ou None si elle est incomplète."""
    try:
        perks = p["perks"]
        primary, sub = perks["styles"][0], perks["styles"][1]
        prim = [int(s["perk"]) for s in primary["selections"]]
        second = sorted(int(s["perk"]) for s in sub["selections"])
        stat = perks["statPerks"]
        if len(prim) != 4 or len(second) != 2:
            return None
        return (match_id, int(p["teamId"]), int(p["championId"]), p.get("teamPosition") or "",
                prim[0], int(primary["style"]), prim[1], prim[2], prim[3],
                int(sub["style"]), second[0], second[1],
                int(stat["offense"]), int(stat["flex"]), int(stat["defense"]))
    except (KeyError, IndexError, TypeError, ValueError):
        return None


class Collector:
    def __init__(self, client: RiotClient, store: Store, platform: str, days_back: int,
                 ladder_refresh_hours: float, clock=time.time):
        self.client = client
        self.store = store
        self.platform = platform
        self.days_back = days_back
        self.ladder_refresh_seconds = ladder_refresh_hours * 3600
        self.clock = clock

    def refresh_ladder_if_stale(self) -> None:
        last = float(self.store.get_meta("ladder_refreshed_at") or 0)
        if self.clock() - last < self.ladder_refresh_seconds:
            return
        rows, missing = [], 0
        for tier in LADDER_TIERS:
            league = self.client.ladder(tier) or {}
            for entry in league.get("entries", []):
                puuid = entry.get("puuid")
                if not puuid:
                    missing += 1
                    continue
                rows.append((puuid, tier.upper(), int(entry.get("leaguePoints", 0))))
        self.store.upsert_players(rows)
        self.store.set_meta("ladder_refreshed_at", str(int(self.clock())))
        log.info("Ladder mis à jour : %d joueurs Master+%s", len(rows),
                 f" ({missing} sans identifiant ignorés)" if missing else "")

    def discover(self) -> int:
        added = 0
        now = int(self.clock())
        floor = now - self.days_back * 86400
        for puuid, last_checked in self.store.players_to_check(PLAYERS_PER_DISCOVERY):
            start = max(floor, (last_checked or 0) - OVERLAP_SECONDS)
            ids = self.client.match_ids(puuid, start_time=start)
            added += self.store.enqueue(ids)
            self.store.mark_checked(puuid, now)
        return added

    def download(self) -> tuple[int, int]:
        saved = skipped = 0
        for match_id in self.store.next_in_queue(MATCHES_PER_BATCH):
            data = self.client.match(match_id)
            parsed = parse_match(data, self.platform) if data else None
            if parsed is None:
                self.store.drop_from_queue(match_id)
                skipped += 1
                continue
            if not parsed[0]["is_remake"] and wants_timeline(match_id):
                attach_timeline(parsed[0], data["info"]["participants"], self.client.timeline(match_id))
            self.store.save_match(*parsed)
            saved += 1
        return saved, skipped

    def step(self) -> None:
        self.refresh_ladder_if_stale()
        if self.store.queue_size() < QUEUE_TARGET:
            added = self.discover()
            log.info("Nouvelles parties découvertes : %d", added)
        saved, skipped = self.download()
        s = self.store.summary()
        log.info("+%d parties (%d ignorées) | total %d | file d'attente %d | joueurs vus %d/%d",
                 saved, skipped, s["matches"], s["queue"], s["players_checked"], s["players"])

    def run_forever(self) -> None:
        while True:
            self.step()
