// Partie en cours, lue dans l'API locale du jeu (commande Rust live_game, voir src-tauri/src/lcu.rs).
// Spec n'en garde que ton champion, ton niveau, ton or, tes objets et les champions adverses : jamais un nom de joueur.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Stats } from "./score";

export interface LiveEnemy { champion: string | null; position: string }
export interface LiveGame {
  champion: string | null;   // clé Data Dragon (« Ahri »)
  position: string;          // TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY (vide hors classée)
  level: number;
  spent: number | null;      // points de sorts déjà dépensés (null si le jeu ne les donne pas)
  gold: number;
  time: number;              // secondes de jeu au moment de la lecture
  items: number[];
  enemies: LiveEnemy[];
  scores?: { kills: number; deaths: number; assists: number; cs: number; ward: number };
  teamKills?: number;
  oppItems?: number[];        // objets du vis-à-vis (même poste), pour l'écart d'or de l'overlay
  at: number;                // Date.now() au moment de la lecture (pour faire avancer le chrono entre deux lectures)
}

const POLL_MS = 3000;   // assez pour suivre niveau, or et achats sans charger le PC pendant la partie
export const POSITION_ROLE: Record<string, number> = { TOP: 0, JUNGLE: 1, MIDDLE: 2, BOTTOM: 3, UTILITY: 4 };

/** Ce qui change l'affichage (tout sauf le chrono, qui avance tout seul entre deux lectures). */
const shown = (g: Omit<LiveGame, "at">) => JSON.stringify([g.champion, g.position, g.level, g.spent, Math.floor(g.gold), g.items, g.enemies, g.scores, g.teamKills, g.oppItems]);

/** Lit la partie toutes les 3 s tant que `active` ; null pendant l'écran de chargement.
 *  Fenêtre réduite : aucune lecture. Rien de changé : aucun nouveau rendu. */
export function useLiveGame(active: boolean, background = false): LiveGame | null {
  const [game, setGame] = useState<LiveGame | null>(null);
  useEffect(() => {
    if (!active) { setGame(null); return; }
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    let last = "", seen = false, fails = 0;
    const tick = async () => {
      // fenêtre principale : on lit même réduite (c'est elle qui ouvre et ferme les overlays)
      if (background || !document.hidden) {
        try {
          const g = await invoke<Omit<LiveGame, "at">>("live_game");
          seen = true; fails = 0;
          const key = shown(g);
          if (!stop && key !== last) { last = key; setGame({ ...g, at: Date.now() }); }
        } catch {
          // avant le début : partie pas encore chargée, on garde la dernière lecture.
          // après : le jeu s'est fermé (fin de partie) → plus rien à afficher
          if (seen && ++fails >= 3 && !stop) { seen = false; last = ""; setGame(null); }
        }
      }
      if (!stop) timer = setTimeout(tick, POLL_MS);
    };
    // fenêtre ré-affichée : lecture tout de suite plutôt qu'au prochain tour
    const onShow = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", onShow);
    tick();
    return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onShow); };
  }, [active, background]);
  return game;
}

/** Chrono de la partie, avancé chaque seconde entre deux lectures. */
export function useGameClock(game: LiveGame | null): number | null {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!game) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [game != null]); // eslint-disable-line react-hooks/exhaustive-deps
  return game ? game.time + (Date.now() - game.at) / 1000 : null;
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Identifiant d'un champion à partir de sa clé Data Dragon. */
export function champIdOf(stats: Stats, key: string | null): number | null {
  if (!key) return null;
  const k = key.toLowerCase();
  for (const c of stats.champions.values()) if (c.key.toLowerCase() === k) return c.id;
  return null;
}
