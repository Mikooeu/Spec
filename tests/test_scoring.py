import json
import random

import pytest

from collector.db import Store
from scoring.build import build_stats
from scoring.champions import Champions, normalize
from scoring.score import Stats, parse_role, recommend, score_champion

CHAMPS = {1: "Ahri", 2: "Syndra", 3: "Orianna", 4: "Lee Sin", 5: "Kai'Sa", 6: "Nautilus",
          7: "Darius", 8: "Vi", 9: "Jinx", 10: "Thresh", 11: "Taliyah", 12: "Garen",
          62: "Wukong"}
ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]


@pytest.fixture
def champions(tmp_path):
    payload = {"version": "15.21.1", "champions": [
        {"id": i, "key": "MonkeyKing" if n == "Wukong" else n.replace(" ", "").replace("'", ""),
         "name": n} for i, n in CHAMPS.items()]}
    path = tmp_path / "champions.json"
    path.write_text(json.dumps(payload))
    return Champions.load(path)


def test_champion_names_are_tolerant(champions):
    assert champions.resolve("lee sin") == 4
    assert champions.resolve("LeeSin") == 4
    assert champions.resolve("kaisa") == 5
    assert champions.resolve("Wukong") == champions.resolve("MonkeyKing") == 62
    with pytest.raises(ValueError, match="Syndra"):
        champions.resolve("Syndr")
    assert normalize("Kai'Sa") == "kaisa"


def test_parse_role():
    assert parse_role("mid") == "MIDDLE"
    assert parse_role("ADC") == "BOTTOM"
    assert parse_role("sup") == "UTILITY"
    with pytest.raises(ValueError):
        parse_role("roamer")


def synthetic_db(path, n_matches=3000, seed=7):
    """Parties fictives : au mid, Ahri bat Syndra 70 % du temps ; Orianna est neutre."""
    rng = random.Random(seed)
    store = Store(path)
    teams = {"TOP": [7, 12], "JUNGLE": [4, 8], "BOTTOM": [9, 5], "UTILITY": [6, 10]}
    matches, rows = [], []
    for i in range(n_matches):
        mid_blue, mid_red = rng.choice([(1, 2), (2, 1), (3, 2), (2, 3), (1, 3), (3, 1), (11, 2), (2, 11)])
        if {mid_blue, mid_red} == {1, 2}:
            ahri_wins = rng.random() < 0.70
            blue_wins = ahri_wins if mid_blue == 1 else not ahri_wins
        else:
            blue_wins = rng.random() < 0.5
        mid = f"EUW1_{i}"
        matches.append((mid, "euw1", "15.21.700.1", "15.21", 0, 1800, False))
        for team, mid_champ, won in ((100, mid_blue, blue_wins), (200, mid_red, not blue_wins)):
            rows.append((mid, team, mid_champ, "MIDDLE", won))
            for role, pair in teams.items():
                rows.append((mid, team, pair[0] if team == 100 else pair[1], role, won))
    with store._connect() as con:   # insertion groupée : bien plus rapide pour les tests
        con.executemany("INSERT INTO matches VALUES (?, ?, ?, ?, ?, ?, ?)", matches)
        con.executemany("INSERT INTO participants VALUES (?, ?, ?, ?, ?)", rows)
    return store


def test_build_and_recommend(tmp_path, champions):
    db = tmp_path / "draft.duckdb"
    synthetic_db(db)
    meta = build_stats(db, tmp_path / "stats.duckdb")
    assert meta["patch"] == "15.21" and int(meta["matches"]) == 3000
    stats = Stats.load(tmp_path / "stats.duckdb")

    # Syndra en face : Ahri doit passer devant Orianna, avec un écart de vis-à-vis positif
    best, discovery = recommend(stats, "MIDDLE", pool=[1, 3], allies=[7, 8], enemies=[2, 4, 6])
    assert [r.champ for r in best] == [1, 3]
    assert best[0].lane > 0.05
    assert abs(best[1].lane) < 0.05
    # la découverte n'est ni dans le pool ni déjà prise
    assert discovery is not None and discovery.champ not in (1, 3, 2)

    # un champion déjà pris disparaît de la liste
    best, _ = recommend(stats, "MIDDLE", pool=[1, 3], allies=[7], enemies=[1])
    assert [r.champ for r in best] == [3]


def test_smoothing_keeps_unknown_matchups_neutral(tmp_path):
    stats = Stats()
    stats.base[(1, "MIDDLE")] = (1000, 520)
    stats.roles[2] = {"MIDDLE": 100}
    stats.lane[(1, "MIDDLE", 2)] = (3, 3)   # 3 victoires sur 3 parties : ne doit presque rien peser
    r = score_champion(stats, 1, "MIDDLE", allies=[], enemies=[2])
    assert 0 < r.lane < 0.03


def test_collector_can_run_while_reading(tmp_path):
    db = tmp_path / "draft.duckdb"
    writer = synthetic_db(db, n_matches=10)
    reader = Store(db, read_only=True)
    assert reader.summary()["matches"] == 10
    writer.enqueue(["EUW1_new"])           # l'écriture fonctionne toujours après une lecture
    assert reader.summary()["queue"] == 1


def test_calibration_detects_the_lane_effect(tmp_path):
    from scoring.calibrate import calibrate
    db = tmp_path / "draft.duckdb"
    synthetic_db(db, n_matches=4000)
    results, info = calibrate(db, tmp_path / "stats_train.duckdb")
    assert 300 < info["test_matches"] < 500          # environ 10 % mis de côté
    assert info["train_matches"] + info["test_matches"] == 4000
    base_best = min((r for r in results if r.label.startswith("Winrate")), key=lambda r: r.log_loss)
    full_best = min((r for r in results if r.label.startswith("Score")), key=lambda r: r.log_loss)
    # le vis-à-vis Ahri/Syndra existe dans les données : le score complet doit mieux prédire
    assert full_best.log_loss < base_best.log_loss


def test_params_roundtrip(tmp_path):
    from scoring.score import Params
    path = tmp_path / "params.json"
    assert Params.load(path) == Params()            # valeurs par défaut sans fichier
    Params(alpha=0.25, beta=0.75, k_base=100, k_delta=100).save(path, {"test_matches": 9})
    assert Params.load(path) == Params(alpha=0.25, beta=0.75, k_base=100, k_delta=100)


def test_upload_sends_token_and_rejects_bad_config(tmp_path):
    import httpx
    import pytest
    from scoring.upload import upload_stats

    f = tmp_path / "stats.json"
    f.write_text('{"meta":{}}')
    seen = {}

    def handler(request: httpx.Request):
        seen["auth"] = request.headers["Authorization"]
        seen["url"] = str(request.url)
        seen["method"] = request.method
        return httpx.Response(200, json={"ok": True})

    token = "t" * 40
    size = upload_stats(f, "https://spec.example.workers.dev/", token, transport=httpx.MockTransport(handler))
    assert size == f.stat().st_size
    assert seen == {"auth": f"Bearer {token}", "url": "https://spec.example.workers.dev/admin/stats", "method": "PUT"}
    with pytest.raises(SystemExit):
        upload_stats(f, "http://insecure.example", token)
    with pytest.raises(SystemExit):
        upload_stats(f, "https://spec.example.workers.dev", "short")
