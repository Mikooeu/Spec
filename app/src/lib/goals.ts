// Objectifs de la semaine : 1 à 3 cibles choisies par le joueur, suivies sur ses parties classées
// de la semaine en cours (lundi → dimanche). Tout reste sur le PC (localStorage).
import type { Game } from "./history";
import { t } from "./i18n";
import { usePersistent } from "./ui";

export type GoalKind = "cs" | "deaths" | "kda" | "dmg" | "champWr" | "games";
export interface Goal { kind: GoalKind; target: number; champ?: number }

export const MAX_GOALS = 3;

interface Def {
  /** « au moins » (true) ou « au plus » (false) */
  atLeast: boolean;
  step: number; min: number; max: number; initial: number;
  label: () => string;
  format: (v: number) => string;
}

const dec = (v: number) => v.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const GOAL_DEFS: Record<GoalKind, Def> = {
  cs: { atLeast: true, step: 0.5, min: 3, max: 12, initial: 7, label: () => t("CS par minute"), format: dec },
  deaths: { atLeast: false, step: 1, min: 1, max: 10, initial: 5, label: () => t("Morts par partie"), format: dec },
  kda: { atLeast: true, step: 0.5, min: 1, max: 10, initial: 3, label: () => t("KDA"), format: dec },
  dmg: { atLeast: true, step: 50, min: 300, max: 1500, initial: 700, label: () => t("Dégâts par minute"), format: (v) => String(Math.round(v)) },
  champWr: { atLeast: true, step: 5, min: 40, max: 80, initial: 55, label: () => t("Winrate sur un champion"), format: (v) => `${Math.round(v)} %` },
  games: { atLeast: true, step: 1, min: 3, max: 40, initial: 15, label: () => t("Parties classées"), format: (v) => String(Math.round(v)) },
};
export const GOAL_ORDER: GoalKind[] = ["cs", "deaths", "kda", "dmg", "champWr", "games"];

export function useGoals(): [Goal[], (g: Goal[]) => void] {
  return usePersistent<Goal[]>("spec.weekGoals", []);
}

/** Lundi 0 h de la semaine en cours (heure locale). */
export function weekStart(now = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Parties classées (Solo/Duo et Flex) de la semaine en cours, hors remakes. */
export function weekRanked(games: Game[], until = Infinity): Game[] {
  const start = weekStart();
  return games.filter((g) => !g.remake && (g.queue === "solo" || g.queue === "flex") && g.created >= start && g.created <= until);
}

/** Valeur actuelle d'un objectif sur ces parties (null : pas encore de partie qui compte). */
export function goalValue(goal: Goal, games: Game[]): number | null {
  const list = goal.kind === "champWr" ? games.filter((g) => g.champ === goal.champ) : games;
  if (goal.kind === "games") return games.length;
  if (list.length === 0) return null;
  const minutes = list.reduce((a, g) => a + g.duration / 60, 0);
  switch (goal.kind) {
    case "cs": return list.reduce((a, g) => a + g.cs, 0) / minutes;
    case "deaths": return list.reduce((a, g) => a + g.deaths, 0) / list.length;
    case "kda": return list.reduce((a, g) => a + g.kills + g.assists, 0) / Math.max(1, list.reduce((a, g) => a + g.deaths, 0));
    case "dmg": return list.reduce((a, g) => a + g.damage, 0) / minutes;
    case "champWr": return (list.filter((g) => g.win).length / list.length) * 100;
  }
}

export function goalReached(goal: Goal, value: number | null): boolean {
  if (value == null) return false;
  return GOAL_DEFS[goal.kind].atLeast ? value >= goal.target : value <= goal.target;
}

/** Avancement de 0 à 1 pour la barre. */
export function goalProgress(goal: Goal, value: number | null): number {
  if (value == null) return 0;
  if (GOAL_DEFS[goal.kind].atLeast) return Math.max(0, Math.min(1, value / goal.target));
  return value <= goal.target ? 1 : Math.max(0, Math.min(1, goal.target / value));
}

/** Libellé de la cible : « objectif 7,0 » ou « 5 max ». */
export function goalTargetLabel(goal: Goal): string {
  const def = GOAL_DEFS[goal.kind];
  return def.atLeast ? t("objectif {v}", { v: def.format(goal.target) }) : t("{v} max", { v: def.format(goal.target) });
}
