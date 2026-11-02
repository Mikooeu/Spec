"""Client minimal de l'API Riot : uniquement les appels dont le collecteur a besoin."""

import logging
import time

import httpx

from .ratelimit import RateLimiter

log = logging.getLogger(__name__)

RANKED_SOLO_QUEUE_ID = 420
LADDER_TIERS = ("challenger", "grandmaster", "master")


class RiotAuthError(SystemExit):
    pass


class RiotClient:
    def __init__(self, api_key: str, platform: str, region: str, timeout: float = 10.0,
                 transport: httpx.BaseTransport | None = None, sleep=time.sleep,
                 region_limit_2min: int = 95):
        self.platform_url = f"https://{platform}.api.riotgames.com"
        self.region_url = f"https://{region}.api.riotgames.com"
        # La clé part uniquement dans l'en-tête, jamais dans l'URL ni dans les logs.
        self._http = httpx.Client(headers={"X-Riot-Token": api_key}, timeout=timeout,
                                  transport=transport)
        self._sleep = sleep
        self._limiters = {
            self.platform_url: RateLimiter(sleep=sleep),
            # match-v5 : budget réduit pour laisser de la place au serveur Cloudflare (stats perso)
            self.region_url: RateLimiter(limits=((19, 1.0), (region_limit_2min, 120.0)), sleep=sleep),
        }

    def close(self) -> None:
        self._http.close()

    def _get(self, base: str, path: str, params: dict | None = None):
        limiter = self._limiters[base]
        for attempt in range(6):
            limiter.acquire()
            try:
                resp = self._http.get(base + path, params=params)
            except httpx.TransportError as exc:
                log.warning("Erreur réseau (%s), nouvel essai...", type(exc).__name__)
                self._sleep(min(2 ** attempt, 30))
                continue
            status = resp.status_code
            if status == 200:
                return resp.json()
            if status == 404:
                return None
            if status == 429:
                wait = float(resp.headers.get("Retry-After", "10"))
                log.warning("Limite Riot atteinte (429), pause de %.0f s", wait)
                limiter.pause(wait)
                continue
            if status in (401, 403):
                raise RiotAuthError(
                    f"Clé Riot refusée (HTTP {status}) : vérifie RIOT_API_KEY dans .env "
                    "ou régénère-la sur developer.riotgames.com."
                )
            if status >= 500:
                log.warning("Erreur serveur Riot (HTTP %d), nouvel essai...", status)
                self._sleep(min(2 ** attempt, 30))
                continue
            resp.raise_for_status()
        raise RuntimeError(f"Échec après plusieurs tentatives : {path}")

    # --- league-v4 (routage plateforme) ---
    def ladder(self, tier: str) -> dict | None:
        return self._get(self.platform_url,
                         f"/lol/league/v4/{tier}leagues/by-queue/RANKED_SOLO_5x5")

    # --- match-v5 (routage régional) ---
    def match_ids(self, puuid: str, start_time: int, count: int = 100) -> list[str]:
        params = {"queue": RANKED_SOLO_QUEUE_ID, "startTime": start_time, "count": count}
        return self._get(self.region_url, f"/lol/match/v5/matches/by-puuid/{puuid}/ids",
                         params) or []

    def match(self, match_id: str) -> dict | None:
        return self._get(self.region_url, f"/lol/match/v5/matches/{match_id}")

    def timeline(self, match_id: str) -> dict | None:
        return self._get(self.region_url, f"/lol/match/v5/matches/{match_id}/timeline")
