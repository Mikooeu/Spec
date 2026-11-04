// Note sur 20 de chaque joueur d'une partie, calculée par rapport aux 9 autres.
//
// Pour chaque joueur : participation aux kills, part des dégâts et de l'or de son équipe, CS par minute
// et score de vision par minute comparés aux joueurs du même rôle, et morts (en négatif). Chaque mesure est centrée et réduite
// sur les 10 joueurs, puis pondérée ; un support compte surtout sur la participation et les morts.
// 10 = joueur moyen de la partie, petit bonus pour la victoire. MVP : meilleure note des gagnants,
// ACE : meilleure note des perdants.
import type { GameDetail, PlayerLine } from "./history";

export interface Rating { note: number; rank: number; badge: "MVP" | "ACE" | null }

const SUPPORT = 4;
const WEIGHTS = { kp: 0.22, dmg: 0.22, gold: 0.13, cs: 0.13, deaths: 0.18, vision: 0.12 };
const SUPPORT_WEIGHTS = { kp: 0.38, dmg: 0.08, gold: 0.04, cs: 0, deaths: 0.25, vision: 0.25 };

function standardize(xs: number[]): number[] {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return xs.map((x) => (sd > 1e-9 ? (x - mean) / sd : 0));
}

/** Notes de tous les joueurs (même ordre que detail.teams[].players aplati). Vide pour un remake. */
export function rateGame(detail: GameDetail): Map<PlayerLine, Rating> {
  const out = new Map<PlayerLine, Rating>();
  const minutes = detail.duration / 60;
  const players = detail.teams.flatMap((t) => t.players.map((p) => ({ p, team: t })));
  if (minutes < 5 || players.length < 2) return out;
  const total = (team: GameDetail["teams"][number], f: (p: PlayerLine) => number) =>
    Math.max(1, team.players.reduce((a, p) => a + f(p), 0));
  const roleCs = new Map<number, number[]>();
  for (const { p } of players) if (p.role != null) roleCs.set(p.role, [...(roleCs.get(p.role) ?? []), p.cs]);
  const allCs = players.reduce((a, { p }) => a + p.cs, 0) / players.length;

  const kp = standardize(players.map(({ p, team }) => (p.kills + p.assists) / total(team, (x) => x.kills)));
  const dmg = standardize(players.map(({ p, team }) => p.damage / total(team, (x) => x.damage)));
  const gold = standardize(players.map(({ p, team }) => p.gold / total(team, (x) => x.gold)));
  const cs = standardize(players.map(({ p }) => {
    const same = p.role != null ? roleCs.get(p.role) ?? [] : [];
    const ref = same.length ? same.reduce((a, b) => a + b, 0) / same.length : allCs;
    return ref > 0 ? p.cs / ref : 1;
  }));
  const deaths = standardize(players.map(({ p }) => p.deaths / minutes));
  // vision : rapportée à la moyenne du même rôle (un support pose toujours plus de balises qu'un mid)
  const hasVision = players.every(({ p }) => p.vision != null);
  const roleVision = new Map<number, number[]>();
  if (hasVision) for (const { p } of players) if (p.role != null) roleVision.set(p.role, [...(roleVision.get(p.role) ?? []), p.vision!]);
  const allVision = hasVision ? players.reduce((a, { p }) => a + p.vision!, 0) / players.length : 0;
  const vision = hasVision ? standardize(players.map(({ p }) => {
    const same = p.role != null ? roleVision.get(p.role) ?? [] : [];
    const ref = same.length ? same.reduce((a, b) => a + b, 0) / same.length : allVision;
    return ref > 0 ? p.vision! / ref : 1;
  })) : players.map(() => 0);

  const notes = players.map(({ p, team }, i) => {
    const w = p.role === SUPPORT ? SUPPORT_WEIGHTS : WEIGHTS;
    // sans score de vision (vieille partie), on répartit son poids sur le reste
    const scale = hasVision ? 1 : 1 / (1 - w.vision);
    const raw = scale * (w.kp * kp[i] + w.dmg * dmg[i] + w.gold * gold[i] + w.cs * cs[i] - w.deaths * deaths[i])
      + w.vision * vision[i];
    const note = Math.min(20, Math.max(0, 10 + 4 * raw + (team.win ? 0.8 : -0.8)));
    return { p, win: team.win, note: Math.round(note * 10) / 10 };
  });
  const ranked = [...notes].sort((a, b) => b.note - a.note);
  const mvp = ranked.find((x) => x.win)?.p, ace = ranked.find((x) => !x.win)?.p;
  ranked.forEach((x, i) => out.set(x.p, { note: x.note, rank: i + 1, badge: x.p === mvp ? "MVP" : x.p === ace ? "ACE" : null }));
  return out;
}

/** Couleur d'une note : verte à partir de 13, rouge sous 8. */
export const noteTone = (n: number) => (n >= 13 ? "good" : n < 8 ? "bad" : "neutral");
export const noteText = (n: number) => n.toFixed(1).replace(".", ",");
