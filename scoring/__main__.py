"""Commandes :
  python -m scoring build
  python -m scoring recommend --role mid --pool "Ahri, Orianna, Viktor" \
      --allies "Darius, Vi, Jinx" --enemies "Sylas, Lee Sin, Syndra, Nautilus"
"""

import argparse
import logging
import sys
from pathlib import Path

import os

from dotenv import load_dotenv

from .champions import Champions
from .score import LOW_DATA_GAMES, Params, Stats, lane_opponent_known, parse_role, recommend

ROLE_LABELS = {"TOP": "Top", "JUNGLE": "Jungle", "MIDDLE": "Mid", "BOTTOM": "ADC", "UTILITY": "Support"}


def pct(x: float) -> str:
    return f"{x * 100:.1f} %".replace(".", ",")


def pts(x: float) -> str:
    return f"{x * 100:+.1f} pt".replace(".", ",")


def names(champions: Champions, text: str | None) -> list[int]:
    if not text:
        return []
    return [champions.resolve(n) for n in text.split(",") if n.strip()]


def print_result(i: str, r, champions: Champions) -> None:
    flag = "  ⚠ peu de données" if r.games < LOW_DATA_GAMES else ""
    print(f" {i:>2}  {champions.name(r.champ):<14} {pct(r.score):>8}   "
          f"(base {pct(r.base)} · vis-à-vis {pts(r.lane)} · counters {pts(r.counters)} · "
          f"synergies {pts(r.synergies)} · composition {pts(r.composition)}) · {int(r.games)} parties{flag}")
    print(f"      à l'aveugle : {pts(r.exposure)} face à ses 3 pires vis-à-vis")
    likely = [d for d in r.lane_detail if d[1] >= 0.15]
    for e, p, d, g in likely[:2]:
        print(f"      face à {champions.name(e)} (vis-à-vis probable à {round(p * 100)} %) : {pts(d)} sur {int(g)} parties")



def run_calibration(db_path: Path, data_dir: Path, force: bool) -> None:
    from dataclasses import replace
    from .calibrate import COMP_LABELS, MIN_TEST_MATCHES, calibrate, calibrate_composition, calibrate_team
    results, info = calibrate(db_path, data_dir / "stats_train.duckdb")
    n = info["test_matches"]
    print(f"\nCalibrage · patch {info['patch']} · {info['train_matches']} parties pour apprendre, "
          f"{n} mises de côté pour tester\n")
    if not results:
        sys.exit("Aucune partie mise de côté : laisse tourner le collecteur plus longtemps.")

    neutral = results[0]
    base_best = min((r for r in results if r.label.startswith("Winrate")), key=lambda r: r.log_loss)
    full_best = min((r for r in results if r.label.startswith("Score")), key=lambda r: r.log_loss)
    print(f"{'Méthode':<42} {'log loss':>9} {'Brier':>7} {'précision':>10}")
    for r in (neutral, base_best, full_best):
        print(f"{r.label:<42} {r.log_loss:>9.4f} {r.brier:>7.4f} {pct(r.accuracy):>10}")

    gain = (base_best.log_loss - full_best.log_loss) / base_best.log_loss * 100
    print(f"\nLe score complet améliore la prédiction de {gain:.2f} % par rapport au winrate de base seul."
          .replace(".", ",", 1) if gain > 0 else
          "\nLe score complet ne fait pas mieux que le winrate de base seul sur ces données.")

    if n < MIN_TEST_MATCHES and not force:
        print(f"\n⚠ Seulement {n} parties de test (minimum conseillé : {MIN_TEST_MATCHES}). "
              "Réglages non enregistrés : relance plus tard, ou ajoute --force.")
        return
    chosen = full_best if gain > 0 else base_best
    # probabilité de victoire d'équipe : gardée seulement si elle prédit mieux que 50 %
    team_neutral, team_best = calibrate_team(info["stats"], info["test"], chosen.params)
    team_gain = (team_neutral.log_loss - team_best.log_loss) / team_neutral.log_loss * 100
    print(f"\n{'Victoire d’équipe':<42} {'log loss':>9} {'Brier':>7} {'précision':>10}")
    for r in (team_neutral, team_best):
        print(f"{r.label:<42} {r.log_loss:>9.4f} {r.brier:>7.4f} {pct(r.accuracy):>10}")
    params = team_best.params if team_gain > 0 else replace(chosen.params, team=0.0)
    print(f"La probabilité d'équipe améliore la prédiction de {team_gain:.2f} % par rapport à 50 %.".replace(".", ",", 1)
          if team_gain > 0 else "La probabilité d'équipe ne fait pas mieux que 50 % : la barre restera à 50 / 50.")
    # composition : gardée seulement si elle prédit mieux, testée sur des moitiés de parties qu'elle n'a pas vues
    without, with_comp, params = calibrate_composition(info["stats"], info["test"], params)
    if without:
        comp_gain = (without - with_comp) / without * 100
        print(f"\n{'Composition':<42} {'log loss':>9}")
        print(f"{'Équipe sans composition':<42} {without:>9.4f}")
        print(f"{'Équipe avec composition':<42} {with_comp:>9.4f}")
        if any(params.comp_weights()):
            kept = ", ".join(f"{l} {w}" for l, w in zip(COMP_LABELS, params.comp_weights()) if w)
            print(f"La composition améliore la prédiction de {comp_gain:.2f} % : poids gardés ({kept}).".replace(".", ",", 1))
        else:
            print("La composition ne prédit pas mieux : elle reste hors du score (les alertes restent affichées).")
    else:
        print("\nComposition non testée : traits des champions introuvables, ou probabilité d'équipe non validée.")
    params.save(data_dir / "params.json", {"test_matches": n, "patch": info["patch"]})
    p = params
    print(f"\nRéglages enregistrés dans data/params.json : α={p.alpha}, β={p.beta}, k={int(p.k_base)}, équipe={p.team}.")
    print("Ils seront utilisés automatiquement par `recommend`.")


def main() -> None:
    load_dotenv()
    data_dir = Path(os.getenv("DB_PATH", "data/draft.duckdb")).parent
    db_path = Path(os.getenv("DB_PATH", "data/draft.duckdb"))
    champs_path = data_dir / "champions.json"

    parser = argparse.ArgumentParser(prog="scoring")
    sub = parser.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build", help="agréger les parties en stats")
    b.add_argument("--patch", help="forcer un patch, ex. 15.21")
    e = sub.add_parser("export", help="exporter les stats en JSON pour l'appli Spec")
    e.add_argument("--out", help="fichier JSON (par défaut app/public/stats.json en EUW, data/export/stats-<région>.json sinon)")
    e.add_argument("--upload", action="store_true", help="envoyer aussi les stats au serveur Cloudflare de Spec")
    c = sub.add_parser("calibrate", help="vérifier et régler le score sur 10 %% de parties mises de côté")
    c.add_argument("--force", action="store_true", help="écrire les réglages même avec peu de parties")
    r = sub.add_parser("recommend", help="classer les champions pour une draft")
    r.add_argument("--role", required=True)
    r.add_argument("--pool", required=True, help="champions du pool, séparés par des virgules")
    r.add_argument("--allies", default="")
    r.add_argument("--enemies", default="")
    r.add_argument("--bans", default="")
    for cmd in (b, e, r):
        cmd.add_argument("--region", default="euw", choices=["euw", "kr", "na", "world"],
                         help="région des stats (world = EUW, KR et NA réunies)")
    args = parser.parse_args()
    region = getattr(args, "region", "euw")
    stats_path = data_dir / ("stats.duckdb" if region == "euw" else f"stats-{region}.duckdb")

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    if args.command == "build":
        from .build import build_stats
        from .items import Items
        champions = Champions.load(champs_path, refresh=True)
        items = Items.load(data_dir / "items.json", champions.version)
        from collector.config import db_path_for
        if region == "world":
            sources = [db_path_for(r) for r in ("euw", "kr", "na") if db_path_for(r).exists()]
        else:
            sources = [db_path_for(region)]
        if not sources or not sources[0].exists():
            sys.exit(f"Aucune base de parties pour {region} : lance d'abord le collecteur de cette région.")
        meta = build_stats(sources, stats_path, args.patch, items=items, champion_keys=champions.keys)
        prev = f" + patch {meta['previous_patch']} à 50 %" if meta["previous_patch"] else ""
        print(f"Stats {region.upper()} prêtes : patch {meta['patch']}{prev}, {int(meta['matches'])} parties.")
        return

    if args.command == "export":
        from .export import export_json
        out = Path(args.out or ("app/public/stats.json" if region == "euw" else f"data/export/stats-{region}.json"))
        if not stats_path.exists():
            sys.exit(f"Pas de stats {region.upper()} : lance d'abord `python -m scoring build --region {region}`.")
        meta = export_json(stats_path, Champions.load(champs_path), Params.load(data_dir / "params.json"), out)
        print(f"Stats {region.upper()} exportées dans {out} (patch {meta.get('patch')}, {meta.get('matches')} parties).")
        if args.upload:
            from .upload import upload_stats
            load_dotenv()
            size = upload_stats(out, os.getenv("SPEC_API_URL", ""), os.getenv("SPEC_ADMIN_TOKEN", ""), region=region)
            print(f"Stats {region.upper()} envoyées au serveur Spec ({size // 1024} Ko).")
        return

    if args.command == "calibrate":
        run_calibration(db_path, data_dir, args.force)
        return

    champions = Champions.load(champs_path)
    try:
        role = parse_role(args.role)
        pool = names(champions, args.pool)
        allies, enemies, bans = (names(champions, x) for x in (args.allies, args.enemies, args.bans))
    except ValueError as exc:
        sys.exit(str(exc))
    stats = Stats.load(stats_path)

    params = Params.load(data_dir / "params.json")
    blind = len(enemies) < 5 and not lane_opponent_known(stats, role, enemies)
    best, discovery = recommend(stats, role, pool, allies, enemies, bans, params=params, blind=blind)
    patch = stats.meta.get("patch", "?")
    print(f"\nTu joues {ROLE_LABELS[role]} · patch {patch} · {stats.meta.get('matches', '?')} parties Master+")
    print("Ton vis-à-vis n'a pas encore choisi : les champions faciles à contrer descendent.\n" if blind
          else "Ton vis-à-vis est connu : le classement suit les matchups.\n")
    if best:
        print("Recommandés dans ton pool :")
        for i, res in enumerate(best, 1):
            print_result(str(i), res, champions)
    else:
        print("Aucun champion de ton pool n'est disponible pour ce rôle (autofill ?).")
    if discovery:
        print("\nDécouverte :")
        print_result("—", discovery, champions)
    print()


if __name__ == "__main__":
    main()
