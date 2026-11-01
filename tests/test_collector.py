import httpx
import pytest

from collector.collect import Collector, parse_match
from collector.db import Store
from collector.ratelimit import RateLimiter
from collector.riot import RiotAuthError, RiotClient


# ---------- limiteur de débit ----------

class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s


def test_ratelimiter_respects_both_windows():
    clock = FakeClock()
    rl = RateLimiter(limits=((19, 1.0), (95, 120.0)), clock=clock, sleep=clock.sleep)
    for _ in range(95):
        rl.acquire()
    # 95 requêtes doivent avoir pris au moins 4 s (fenêtre de 1 s à 19 requêtes)
    assert clock.t >= 4.0
    rl.acquire()  # la 96e doit attendre la fin de la fenêtre de 2 min
    assert clock.t >= 120.0


def test_ratelimiter_pause_after_429():
    clock = FakeClock()
    rl = RateLimiter(clock=clock, sleep=clock.sleep)
    rl.pause(10)
    rl.acquire()
    assert clock.t >= 10.0


# ---------- lecture d'une partie ----------

def make_match(match_id="EUW1_1", queue=420, duration=1800, version="15.21.712.1234"):
    parts = []
    for i, pos in enumerate(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] * 2):
        parts.append({"teamId": 100 if i < 5 else 200, "championId": 100 + i,
                      "teamPosition": pos, "win": i < 5, "puuid": f"secret-{i}",
                      "riotIdGameName": f"Joueur{i}"})
    return {"metadata": {"matchId": match_id},
            "info": {"queueId": queue, "gameVersion": version, "gameDuration": duration,
                     "gameCreation": 1_700_000_000_000, "participants": parts}}


def test_parse_match_keeps_only_needed_fields():
    match, rows = parse_match(make_match(), "euw1")
    assert match["patch"] == "15.21"
    assert match["is_remake"] is False
    assert len(rows) == 10
    assert rows[0] == ("EUW1_1", 100, 100, "TOP", True)
    # aucun pseudo ni identifiant de joueur n'est conservé
    assert all("secret" not in str(r) and "Joueur" not in str(r) for r in rows)


def test_parse_match_flags_remake_and_skips_other_queues():
    match, _ = parse_match(make_match(duration=200), "euw1")
    assert match["is_remake"] is True
    assert parse_match(make_match(queue=440), "euw1") is None


# ---------- base de données ----------

def test_store_is_idempotent():
    store = Store(":memory:")
    match, rows = parse_match(make_match(), "euw1")
    store.enqueue(["EUW1_1"])
    store.save_match(match, rows)
    store.save_match(match, rows)  # rejouer ne duplique rien
    assert store.summary()["matches"] == 1
    with store._connect() as con:
        assert con.execute("SELECT count(*) FROM participants").fetchone()[0] == 10
    assert store.queue_size() == 0
    # une partie déjà stockée n'est pas remise en file
    assert store.enqueue(["EUW1_1"]) == 0


def test_queue_downloads_most_recent_matches_first():
    store = Store(":memory:")
    store.enqueue(["EUW1_7000000001", "EUW1_7600000000", "EUW1_7300000000"])
    assert store.next_in_queue(3) == ["EUW1_7600000000", "EUW1_7300000000", "EUW1_7000000001"]


# ---------- boucle complète avec une fausse API Riot ----------

def fake_riot(request: httpx.Request) -> httpx.Response:
    assert request.headers["X-Riot-Token"] == "RGAPI-test"
    path = request.url.path
    if path.endswith("challengerleagues/by-queue/RANKED_SOLO_5x5"):
        return httpx.Response(200, json={"entries": [{"puuid": "p1", "leaguePoints": 900},
                                                     {"summonerId": "old"}]})
    if "leagues/by-queue" in path:
        return httpx.Response(200, json={"entries": [{"puuid": "p2", "leaguePoints": 100}]})
    if path.endswith("/ids"):
        assert request.url.params["queue"] == "420"
        return httpx.Response(200, json=["EUW1_1", "EUW1_2", "EUW1_404"])
    if path.endswith("EUW1_404"):
        return httpx.Response(404)
    match_id = path.rsplit("/", 1)[-1]
    return httpx.Response(200, json=make_match(match_id))


def test_full_cycle_with_fake_api():
    client = RiotClient("RGAPI-test", "euw1", "europe",
                        transport=httpx.MockTransport(fake_riot), sleep=lambda s: None)
    store = Store(":memory:")
    col = Collector(client, store, "euw1", days_back=14, ladder_refresh_hours=6)
    col.step()
    s = store.summary()
    assert s["players"] == 2            # p1 + p2 (présent en GM et en Master, fusionné), "old" ignoré
    assert s["matches"] == 2            # EUW1_1 et EUW1_2 ; la 404 est retirée
    assert s["queue"] == 0
    assert s["players_checked"] == s["players"]


def test_auth_error_is_explicit():
    client = RiotClient("RGAPI-bad", "euw1", "europe",
                        transport=httpx.MockTransport(lambda r: httpx.Response(403)),
                        sleep=lambda s: None)
    with pytest.raises(RiotAuthError):
        client.ladder("master")


def _with_runes(match, keystone=8112, swap=False):
    for p in match["info"]["participants"]:
        p["perks"] = {
            "statPerks": {"offense": 5008, "flex": 5008, "defense": 5011},
            "styles": [
                {"description": "primaryStyle", "style": 8100,
                 "selections": [{"perk": keystone}, {"perk": 8139}, {"perk": 8138}, {"perk": 8135}]},
                {"description": "subStyle", "style": 8200,
                 "selections": [{"perk": 8233}, {"perk": 8210}] if swap else [{"perk": 8210}, {"perk": 8233}]},
            ]}
    return match


def test_parse_match_keeps_rune_pages_without_identity():
    match, _ = parse_match(_with_runes(make_match()), "euw1")
    assert len(match["runes"]) == 10
    assert match["runes"][0] == ("EUW1_1", 100, 100, "TOP", 8112, 8100, 8139, 8138, 8135,
                                 8200, 8210, 8233, 5008, 5008, 5011)
    # l'ordre des runes secondaires ne crée pas deux pages différentes
    swapped, _ = parse_match(_with_runes(make_match(), swap=True), "euw1")
    assert swapped["runes"][0] == match["runes"][0]
    assert all("secret" not in str(r) for r in match["runes"])
    # page absente ou incomplète : ignorée sans erreur
    assert parse_match(make_match(), "euw1")[0]["runes"] == []


def test_save_match_stores_runes(tmp_path):
    store = Store(tmp_path / "db.duckdb")
    match, rows = parse_match(_with_runes(make_match()), "euw1")
    store.save_match(match, rows)
    store.save_match(match, rows)
    with store._connect() as con:
        assert con.execute("SELECT count(*) FROM runes").fetchone()[0] == 10
