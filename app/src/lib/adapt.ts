// Objets et runes que les joueurs Master+ adaptent à la draft adverse (voir scoring/situational.py).
import { analyzeTeam, situationsOf, traitsOf, type Situation } from "./composition";
import type { SituPick, Stats } from "./score";

export interface Adaptation { situation: Situation; games: number; items: SituPick[]; runes: SituPick[] }

/** Adaptations de ce champion face à cette équipe adverse (au moins 3 adversaires connus), les plus nettes d'abord. */
export function adaptationsFor(stats: Stats, champ: number, role: number, enemies: number[]): Adaptation[] {
  const sits = situationsOf(analyzeTeam(stats, enemies));
  if (!sits.length) return [];
  const entries = stats.situ.get(`${champ}|${role}`) ?? [];
  const gap = (p: SituPick) => p[1] - p[2];
  return entries
    .filter((e) => sits.includes(e.situation) && (e.items.length || e.runes.length))
    .sort((a, b) => Math.max(0, ...b.items.map(gap), ...b.runes.map(gap)) - Math.max(0, ...a.items.map(gap), ...a.runes.map(gap)));
}

/** Situations de l'équipe adverse (mêmes seuils que les adaptations). */
export function enemySituations(stats: Stats, enemies: number[]): Situation[] {
  return situationsOf(analyzeTeam(stats, enemies));
}

/** Champions adverses qui font entrer l'équipe dans cette situation (tanks, soigneurs, gros dégâts du type). */
export function situationChamps(stats: Stats, situation: Situation, enemies: number[]): number[] {
  return enemies.filter((c) => {
    const tr = traitsOf(stats, c);
    if (!tr) return false;
    if (situation === "tank") return tr.front === 2;
    if (situation === "heal") return tr.healer;
    if (situation === "ad") return tr.weight === 1 && tr.ad >= 0.6;
    return tr.weight === 1 && tr.ap >= 0.6;
  });
}
