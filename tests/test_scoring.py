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
    assert seen == {"auth": f"Bearer {token}", "url": "https://spec.example.workers.dev/admin/stats?region=euw", "method": "PUT"}
    upload_stats(f, "https://spec.example.workers.dev", token, transport=httpx.MockTransport(handler), region="kr")
    assert seen["url"].endswith("/admin/stats?region=kr")
    with pytest.raises(SystemExit):
        upload_stats(f, "https://spec.example.workers.dev", token, region="mars")
    with pytest.raises(SystemExit):
        upload_stats(f, "http://insecure.example", token)
    with pytest.raises(SystemExit):
        upload_stats(f, "https://spec.example.workers.dev", "short")


def test_runes_pick_the_better_keystone_and_matchup_override():
    from scoring.runes import compute_runes
    rng = random.Random(3)
    rows, laner = [], []
    # Ahri mid : Électrocution (8112) gagne 55 %, Premier coup (8369) 48 % ; mais face à Syndra,
    # Premier coup gagne 70 % et Électrocution 40 %.
    for i in range(4000):
        key = 8112 if i % 2 else 8369
        opp = 134 if i % 4 < 2 else 61
        p = (0.40 if key == 8112 else 0.70) if opp == 134 else (0.70 if key == 8112 else 0.26)
        win = int(rng.random() < p)
        pstyle = 8100 if key == 8112 else 8300
        minor = 8139 if rng.random() < 0.8 else 8143
        rows.append((103, "MIDDLE", key, pstyle, minor, 8138, 8135, 8200, 8210, 8233, 5008, 5008, 5011, win, 1.0))
        laner.append((103, "MIDDLE", opp, key, win, 1.0))
    out = compute_runes(rows, laner)
    [[champ, role, pages]] = out["pages"]
    assert (champ, role) == (103, "MIDDLE")
    assert [p[0] for p in pages] == [8112, 8369]          # meilleure rune clé d'abord
    assert pages[0][3] == 8100 and pages[0][5] == 8200
    assert pages[0][7] == [5008, 5008, 5011]
    assert out["vs"] and out["vs"][0][:4] == [103, "MIDDLE", 134, 8369]
    assert not any(v[2] == 61 for v in out["vs"])          # face à Orianna, la page par défaut reste


def test_runes_need_enough_games():
    from scoring.runes import compute_runes
    rows = [(1, "TOP", 8010, 8000, 1, 2, 3, 8400, 4, 5, 5008, 5008, 5011, 1, 1.0)] * 10
    assert compute_runes(rows, []) == {"pages": [], "vs": []}


def test_export_includes_runes(tmp_path, champions):
    from scoring.export import export_json
    from scoring.score import Params
    db = tmp_path / "draft.duckdb"
    store = synthetic_db(db, n_matches=400)
    with store._connect() as con:
        con.execute("""INSERT INTO runes
            SELECT match_id, team_id, champion_id, team_position, 8112, 8100, 8139, 8138, 8135,
                   8200, 8210, 8233, 5008, 5008, 5011 FROM participants""")
    build_stats(db, tmp_path / "stats.duckdb")
    out = tmp_path / "stats.json"
    export_json(tmp_path / "stats.duckdb", champions, Params(), out)
    import json as _json
    data = _json.loads(out.read_text())
    ahri = [r for r in data["runes"] if r[0] == 1 and r[1] == 2]
    assert ahri and ahri[0][2][0][0] == 8112
    assert "runeVs" in data


def test_export_includes_ban_counts(tmp_path, champions):
    from scoring.export import export_json
    from scoring.score import Params
    db = tmp_path / "draft.duckdb"
    store = synthetic_db(db, n_matches=400)
    with store._connect() as con:
        # la moitié des parties seulement a le détail (collectées après la 0.2)
        con.execute("INSERT INTO match_ext SELECT match_id, false FROM matches WHERE hash(match_id) % 2 = 0")
        con.execute("INSERT INTO bans SELECT match_id, 238 FROM match_ext")
    meta = build_stats(db, tmp_path / "stats.duckdb")
    out = tmp_path / "stats.json"
    export_json(tmp_path / "stats.duckdb", champions, Params(), out)
    import json as _json
    data = _json.loads(out.read_text())
    detailed = float(meta["ban_matches"])
    assert 100 < detailed < 300
    zed = dict((c, g) for c, g in data["bans"])[238]
    assert zed == detailed            # banni dans 100 % des parties détaillées


def test_champion_builds_from_details():
    from scoring.builds import compute_builds, legendary_order, skill_priority, starting_items
    from scoring.items import Items
    items = Items({"items": {
        "1001": {"gold": 300, "purchasable": True, "tags": ["Boots"], "into": ["3020"], "rift": True},
        "3020": {"gold": 1100, "purchasable": True, "tags": ["Boots"], "into": [], "rift": True},
        "3089": {"gold": 3600, "purchasable": True, "tags": [], "into": [], "rift": True},
        "6655": {"gold": 2900, "purchasable": True, "tags": [], "into": [], "rift": True},
        "3135": {"gold": 2800, "purchasable": True, "tags": [], "into": [], "rift": True},
        "1056": {"gold": 400, "purchasable": True, "tags": [], "into": [], "rift": True},
        "2003": {"gold": 50, "purchasable": True, "tags": ["Consumable"], "into": [], "rift": True},
        "1058": {"gold": 1200, "purchasable": True, "tags": [], "into": ["3089"], "rift": True},
    }})
    assert items.boots == {3020} and items.legendary == {3089, 6655, 3135}
    buys = "1056@14,2003@15,2003@15,1058@600,6655@700,3020@800,3089@1300,6655@1400,3135@1900"
    assert legendary_order(buys, items) == [6655, 3089, 3135]
    assert starting_items(buys) == "1056,2003,2003"
    assert skill_priority("QEWQQRQWQWRWWEE") == "R > Q > W > E"
    rows = [(103, "MIDDLE", 1, 1.0, 4, 14, "6655,3020,3089", "QEWQQRQWQWRWWEE", buys)] * 6 + \
           [(103, "MIDDLE", 0, 1.0, 4, 12, "6655,3020", None, None)] * 4
    [[champ, role, e]] = compute_builds(rows, items)
    assert (champ, role, e["g"], e["tg"]) == (103, "MIDDLE", 10.0, 6.0)
    assert e["spells"][0] == [4, 14, 6.0, 6.0]
    assert e["boots"] == [[3020, 10.0, 6.0]]
    assert e["start"] == [["1056,2003,2003", 6.0, 6.0]]
    assert e["skills"][:2] == ["QEWQQRQWQWRWWEE", "R > Q > W > E"]
    assert e["items"][0] == [6.0, [[6655, 6.0, 6.0]]]
    assert e["builds"] == []   # 3 objets finis seulement, il en faut 5 pour un build complet


def test_export_includes_champion_pages(tmp_path, champions):
    from scoring.export import export_json
    from scoring.score import Params
    db = tmp_path / "draft.duckdb"
    store = synthetic_db(db, n_matches=300)
    with store._connect() as con:
        con.execute("""INSERT INTO builds SELECT match_id, team_id, champion_id, team_position, win, 4, 14,
                       '3020', NULL, NULL FROM participants""")
    build_stats(db, tmp_path / "stats.duckdb")
    out = tmp_path / "stats.json"
    export_json(tmp_path / "stats.duckdb", champions, Params(), out)
    import json as _json
    data = _json.loads(out.read_text())
    ahri = [e for c, r, e in data["champ"] if c == 1 and r == 2]
    assert ahri and ahri[0]["spells"][0][:2] == [4, 14]


def test_world_adds_up_several_regions(tmp_path):
    euw, kr = tmp_path / "draft.duckdb", tmp_path / "draft-kr.duckdb"
    synthetic_db(euw, n_matches=300, seed=1)
    store = synthetic_db(kr, n_matches=200, seed=2)
    with store._connect() as con:   # numéros de parties coréens distincts
        con.execute("UPDATE participants SET match_id = replace(match_id, 'EUW1_', 'KR_')")
        con.execute("UPDATE matches SET match_id = replace(match_id, 'EUW1_', 'KR_'), platform = 'kr'")
    meta = build_stats([euw, kr], tmp_path / "stats-world.duckdb")
    assert int(meta["matches"]) == 500
    assert int(build_stats([kr], tmp_path / "stats-kr.duckdb")["matches"]) == 200


def test_spells_change_against_a_matchup_only_when_clearly_better():
    from scoring.builds import compute_builds
    from scoring.items import Items
    # Jinx : Flash + Soins d'habitude ; face à 22 (Ashe), Flash + Purge gagne nettement plus
    rows = ([(9, "BOTTOM", 1, 1.0, 4, 7, "", None, None, 30)] * 60 + [(9, "BOTTOM", 0, 1.0, 4, 7, "", None, None, 30)] * 60
            + [(9, "BOTTOM", 1, 1.0, 1, 4, "", None, None, 22)] * 30 + [(9, "BOTTOM", 0, 1.0, 1, 4, "", None, None, 22)] * 5
            + [(9, "BOTTOM", 1, 1.0, 4, 7, "", None, None, 22)] * 10 + [(9, "BOTTOM", 0, 1.0, 4, 7, "", None, None, 22)] * 20
            + [(9, "BOTTOM", 1, 1.0, 7, 12, "", None, None, 22)] * 25)   # sans Flash : jamais proposé
    [[_, _, e]] = compute_builds(iter(rows), Items(None))
    assert e["spells"][0][:2] == [4, 7]
    assert [v[:3] for v in e["spellsVs"]] == [[22, 1, 4]]
