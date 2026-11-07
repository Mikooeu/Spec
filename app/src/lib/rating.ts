// Note sur 20 de chaque joueur d'une partie, calculée par rapport aux 9 autres.
//
// Pour chaque joueur : participation aux kills, part des dégâts et de l'or de son équipe, CS par minute
// et score de vision par minute comparés aux joueurs du même rôle, et morts (en négatif). Chaque mesure est centrée et réduite
// sur les 10 joueurs, puis pondérée selon le rôle (barème validé par Théo en 0.4.0, choisi à la main).
// 10 = joueur moyen de la partie, petit bonus pour la victoire. MVP : meilleure note des gagnants,
// ACE : meilleure note des perdants.
import type { GameDetail, PlayerLine } from "./history";
import { dec1 } from "./ui";

export type Criterion = "kp" | "dmg" | "gold" | "cs" | "deaths" | "vision" | "result";
/** Part de la note apportée par un critère, en points (positive ou négative). */
export interface Contribution { key: Criterion; points: number }
export interface Rating { note: number; rank: number; badge: "MVP" | "ACE" | null; parts: Contribution[] }

type Weights = Record<Exclude<Criterion, "result">, number>;
// Barème par rôle (0 top, 1 jungle, 2 mid, 3 ADC, 4 support) ; chaque ligne fait 1.
const ROLE_WEIGHTS: Weights[] = [
  { kp: 0.16, dmg: 0.24, gold: 0.16, cs: 0.16, deaths: 0.20, vision: 0.08 },
  { kp: 0.30, dmg: 0.16, gold: 0.12, cs: 0.10, deaths: 0.16, vision: 0.16 },
  { kp: 0.22, dmg: 0.24, gold: 0.14, cs: 0.16, deaths: 0.16, vision: 0.08 },
  { kp: 0.14, dmg: 0.28, gold: 0.12, cs: 0.20, deaths: 0.22, vision: 0.04 },
  { kp: 0.44, dmg: 0.08, gold: 0.04, cs: 0, deaths: 0.14, vision: 0.30 },
];
// rôle inconnu : moyenne des quatre rôles hors support
const DEFAULT_WEIGHTS: Weights = { kp: 0.205, dmg: 0.23, gold: 0.135, cs: 0.155, deaths: 0.185, vision: 0.09 };
export const weightsFor = (role: number | null | undefined): Weights => (role != null && ROLE_WEIGHTS[role]) || DEFAULT_WEIGHTS;
const SCALE = 4;   // un écart-type pondéré = 4 points
const RESULT = 0.8;

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
    const w = weightsFor(p.role);
    // sans score de vision (vieille partie), on répartit son poids sur le reste
    const scale = hasVision ? 1 : 1 / (1 - w.vision);
    const raw: Contribution[] = [
      { key: "kp", points: SCALE * scale * w.kp * kp[i] },
      { key: "dmg", points: SCALE * scale * w.dmg * dmg[i] },
      { key: "gold", points: SCALE * scale * w.gold * gold[i] },
      { key: "cs", points: SCALE * scale * w.cs * cs[i] },
      { key: "deaths", points: -SCALE * scale * w.deaths * deaths[i] },
      ...(hasVision ? [{ key: "vision" as const, points: SCALE * w.vision * vision[i] }] : []),
    ];
    const parts = raw.filter((c) => w[c.key as keyof Weights] > 0);
    parts.push({ key: "result", points: team.win ? RESULT : -RESULT });
    const note = Math.min(20, Math.max(0, 10 + parts.reduce((a, c) => a + c.points, 0)));
    return { p, win: team.win, note: Math.round(note * 10) / 10, parts };
  });
  const ranked = [...notes].sort((a, b) => b.note - a.note);
  const mvp = ranked.find((x) => x.win)?.p, ace = ranked.find((x) => !x.win)?.p;
  ranked.forEach((x, i) => out.set(x.p, { note: x.note, rank: i + 1, badge: x.p === mvp ? "MVP" : x.p === ace ? "ACE" : null, parts: x.parts }));
  return out;
}

/** Couleur d'une note : verte à partir de 13, rouge sous 8. */
export const noteTone = (n: number) => (n >= 13 ? "good" : n < 8 ? "bad" : "neutral");
export const noteText = (n: number) => dec1(n);

/** Critères triés du plus positif au plus négatif, résultat de la partie à la fin. */
export function sortedParts(r: Rating): Contribution[] {
  const crit = r.parts.filter((c) => c.key !== "result").sort((a, b) => b.points - a.points);
  return [...crit, ...r.parts.filter((c) => c.key === "result")];
}
/** Les 2 critères qui ont le plus fait monter la note, et celui qui a le plus coûté (s'il est négatif). */
export function summaryParts(r: Rating): { up: Contribution[]; down: Contribution | null } {
  const crit = r.parts.filter((c) => c.key !== "result").sort((a, b) => b.points - a.points);
  const up = crit.filter((c) => c.points >= 0.05).slice(0, 2);
  const worst = crit[crit.length - 1];
  return { up, down: worst && worst.points <= -0.05 ? worst : null };
}
