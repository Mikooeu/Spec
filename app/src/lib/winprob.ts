// Probabilité de victoire de la draft (barre du haut de l'écran pick/ban).
// Même calcul que scoring/score.py (team_win_probability) : chaque champion choisi reçoit son score
// (winrate, vis-à-vis, counters, synergies) ; la force d'une équipe est la somme des logits de ces scores ;
// l'écart des deux forces devient une probabilité avec l'échelle calibrée sur les parties mises de côté.
import { enemyRoles, scoreChampion, type Stats } from "./score";

const logit = (p: number) => { const q = Math.min(Math.max(p, 0.02), 0.98); return Math.log(q / (1 - q)); };

function strength(stats: Stats, team: { champ: number; role: number }[], enemies: number[]): number {
  const champs = team.map((x) => x.champ);
  return team.reduce((a, { champ, role }) =>
    a + logit(scoreChampion(stats, champ, role, champs.filter((c) => c !== champ), enemies).score), 0);
}

/**
 * Probabilité que ton équipe gagne, d'après les champions déjà choisis des deux côtés (rôles des alliés connus,
 * ceux des adversaires devinés). null tant que le serveur n'a pas validé le calcul, ou sans aucun pick.
 */
export function winProbability(stats: Stats, allies: { champ: number; role: number }[], enemies: number[]): number | null {
  const scale = stats.params.team ?? 0;
  if (!scale || (!allies.length && !enemies.length)) return null;
  const { best } = enemyRoles(stats, enemies);
  const them = enemies.map((champ, i) => ({ champ, role: best[i] ?? 2 }));
  const diff = strength(stats, allies, enemies) - strength(stats, them, allies.map((a) => a.champ));
  return 1 / (1 + Math.exp(-scale * diff));
}
