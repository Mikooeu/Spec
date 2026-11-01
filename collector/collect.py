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
    return match, rows


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
