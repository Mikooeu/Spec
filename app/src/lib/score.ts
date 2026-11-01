// Calcul du score : portage exact de scoring/score.py (même formule, mêmes réglages).
//
// Score(c) = WR(c,R) + Σe pe(R)·Δlane(c,e) + α·Σe (1 − pe(R))·Δvs(c,e) + β·Σa Δavec(c,a)
// Chaque winrate est lissé : (victoires + k·référence) / (parties + k).

export const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
export const ROLE_LABELS = ["Top", "Jungle", "Mid", "ADC", "Support"];
export const ROLE_SHORT = ["TOP", "JGL", "MID", "ADC", "SUP"];
export const DISCOVERY_MIN_GAMES = 200;
export const LOW_DATA_GAMES = 200;

export type Pair = [games: number, wins: number];

export interface Params {
  alpha: number;
  beta: number;
  k_base: number;
  k_delta: number;
}

export interface Champion {
  id: number;
  key: string; // nom de fichier de l'icône Data Dragon
  name: string;
}

export interface Stats {
  meta: Record<string, string>;
  params: Params;
  ddragon: string;
  champions: Map<number, Champion>;
  base: Map<string, Pair>;
  lane: Map<string, Pair>;
  vs: Map<string, Pair>;
  ally: Map<string, Pair>;
  roleGames: Map<number, number[]>; // champion -> parties par rôle
}

interface RawStats {
  meta: Record<string, string>;
  params: Params;
  ddragon: string;
  champions: [number, string, string][];
  base: [number, number, number, number][];
  lane: [number, number, number, number, number][];
  vs: [number, number, number, number, number][];
  ally: [number, number, number, number, number][];
}

const k2 = (c: number, r: number) => `${c}|${r}`;
const k3 = (c: number, r: number, o: number) => `${c}|${r}|${o}`;

export function parseStats(raw: RawStats): Stats {
  const stats: Stats = {
    meta: raw.meta,
    params: raw.params,
    ddragon: raw.ddragon,
    champions: new Map(raw.champions.map(([id, key, name]) => [id, { id, key, name }])),
    base: new Map(),
    lane: new Map(),
    vs: new Map(),
    ally: new Map(),
    roleGames: new Map(),
  };
  for (const [c, r, g, w] of raw.base) {
    stats.base.set(k2(c, r), [g, w]);
    const dist = stats.roleGames.get(c) ?? [0, 0, 0, 0, 0];
    dist[r] = g;
    stats.roleGames.set(c, dist);
  }
  for (const [c, r, o, g, w] of raw.lane) stats.lane.set(k3(c, r, o), [g, w]);
  for (const [c, r, o, g, w] of raw.vs) stats.vs.set(k3(c, r, o), [g, w]);
  for (const [c, r, o, g, w] of raw.ally) stats.ally.set(k3(c, r, o), [g, w]);
  return stats;
}

export function smoothed(games: number, wins: number, reference: number, k: number): number {
  return (wins + k * reference) / (games + k);
}

export function gamesIn(stats: Stats, champ: number, role: number): number {
  return stats.base.get(k2(champ, role))?.[0] ?? 0;
}

export function roleProbability(stats: Stats, champ: number, role: number): number {
  const dist = stats.roleGames.get(champ);
  if (!dist) return 0;
  const total = dist.reduce((a, b) => a + b, 0);
  return total ? dist[role] / total : 0;
}

/** Rôles possibles d'un champion, du plus au moins probable. */
export function roleDistribution(stats: Stats, champ: number): { role: number; p: number }[] {
  const dist = stats.roleGames.get(champ);
  if (!dist) return [];
  const total = dist.reduce((a, b) => a + b, 0);
  if (!total) return [];
  return dist.map((g, role) => ({ role, p: g / total })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p);
}

/** Rôle le plus probable d'un champion et sa probabilité. */
export function likelyRole(stats: Stats, champ: number): { role: number; p: number } | null {
  const dist = stats.roleGames.get(champ);
  if (!dist) return null;
  const total = dist.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const role = dist.indexOf(Math.max(...dist));
  return { role, p: dist[role] / total };
}

export interface LaneDetail {
  enemy: number;
  p: number;
  delta: number;
  games: number;
  wins: number;
  counterDelta: number; // effet total de cet ennemi (vis-à-vis + counter)
}

export interface Result {
  champ: number;
  score: number;
  base: number;
  lane: number;
  counters: number;
  synergies: number;
  games: number;
  details: LaneDetail[]; // triés du vis-à-vis le plus probable au moins probable
}

export function scoreChampion(
  stats: Stats, champ: number, role: number, allies: number[], enemies: number[],
  params: Params = stats.params,
): Result {
  const [g, w] = stats.base.get(k2(champ, role)) ?? [0, 0];
  const base = smoothed(g, w, 0.5, params.k_base);

  // probabilité que chaque ennemi soit le vis-à-vis, renormalisée pour ne pas dépasser 1
  let probs = enemies.map((e) => roleProbability(stats, e, role));
  const total = probs.reduce((a, b) => a + b, 0);
  if (total > 1) probs = probs.map((p) => p / total);

  let lane = 0, counters = 0, synergies = 0;
  const details: LaneDetail[] = [];
  enemies.forEach((e, i) => {
    const [lg, lw] = stats.lane.get(k3(champ, role, e)) ?? [0, 0];
    const dLane = smoothed(lg, lw, base, params.k_delta) - base;
    const [vg, vw] = stats.vs.get(k3(champ, role, e)) ?? [0, 0];
    const dVs = smoothed(vg, vw, base, params.k_delta) - base;
    const laneContribution = probs[i] * dLane;
    const counterContribution = params.alpha * (1 - probs[i]) * dVs;
    lane += laneContribution;
    counters += counterContribution;
    details.push({ enemy: e, p: probs[i], delta: dLane, games: lg, wins: lw,
                   counterDelta: laneContribution + counterContribution });
  });
  for (const a of allies) {
    const [ag, aw] = stats.ally.get(k3(champ, role, a)) ?? [0, 0];
    synergies += params.beta * (smoothed(ag, aw, base, params.k_delta) - base);
  }
  details.sort((x, y) => y.p - x.p);
  return { champ, score: base + lane + counters + synergies, base, lane, counters, synergies,
           games: g, details };
}

export function recommend(
  stats: Stats, role: number, pool: number[], allies: number[], enemies: number[],
  bans: number[] = [], top = 3,
): { pool: Result[]; discovery: Result | null } {
  const taken = new Set([...allies, ...enemies, ...bans]);
  const poolResults = pool
    .filter((c) => !taken.has(c))
    .map((c) => scoreChampion(stats, c, role, allies, enemies))
    .sort((a, b) => b.score - a.score);

  const poolSet = new Set(pool);
  let discovery: Result | null = null;
  for (const [key, [g]] of stats.base) {
    const [cs, rs] = key.split("|");
    const c = Number(cs);
    if (Number(rs) !== role || g < DISCOVERY_MIN_GAMES || poolSet.has(c) || taken.has(c)) continue;
    const r = scoreChampion(stats, c, role, allies, enemies);
    if (!discovery || r.score > discovery.score) discovery = r;
  }
  // sans aucun champion du pool disponible (autofill), on propose le top du rôle
  return { pool: poolResults.slice(0, top), discovery };
}

/** Meilleurs champions d'un rôle, tous confondus (utile en autofill). */
export function topForRole(stats: Stats, role: number, allies: number[], enemies: number[],
                           exclude: number[], n: number): Result[] {
  const taken = new Set([...allies, ...enemies, ...exclude]);
  const out: Result[] = [];
  for (const [key, [g]] of stats.base) {
    const [cs, rs] = key.split("|");
    const c = Number(cs);
    if (Number(rs) !== role || g < DISCOVERY_MIN_GAMES || taken.has(c)) continue;
    out.push(scoreChampion(stats, c, role, allies, enemies));
  }
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}
