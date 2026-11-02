"""Point d'entrée : `python -m collector run` ou `python -m collector stats`."""

import argparse
import logging

from .config import load_config
from .db import Store


def main() -> None:
    parser = argparse.ArgumentParser(prog="collector", description="Collecteur Master+ Spec")
    parser.add_argument("command", choices=["run", "stats"], help="run : collecter, stats : résumé")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        datefmt="%H:%M:%S")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # pas d'URL ni de bruit dans les logs

    cfg = load_config()
    store = Store(cfg.db_path, read_only=(args.command == "stats"))
    try:
        if args.command == "stats":
            s = store.summary()
            print(f"Joueurs Master+ : {s['players']} (dont {s['players_checked']} déjà parcourus)")
            print(f"Parties stockées : {s['matches']} (dont {s['remakes']} remakes ignorés au calcul)")
            print(f"File d'attente : {s['queue']}")
            print(f"Avec bans, sorts et objets : {s['detailed']} (dont {s['timelines']} avec déroulé)")
            for patch, n in s["by_patch"]:
                print(f"  patch {patch} : {n} parties")
            return

        from .collect import Collector
        from .riot import RiotClient
        client = RiotClient(cfg.api_key, cfg.platform, cfg.region, region_limit_2min=cfg.region_limit_2min)
        collector = Collector(client, store, cfg.platform, cfg.days_back, cfg.ladder_refresh_hours)
        logging.info("Collecteur lancé sur %s (Ctrl+C pour arrêter, tu peux relancer quand tu veux)",
                     cfg.platform)
        try:
            collector.run_forever()
        except KeyboardInterrupt:
            logging.info("Arrêt demandé. Tout ce qui a été collecté est enregistré.")
        finally:
            client.close()
    finally:
        store.close()


if __name__ == "__main__":
    main()
