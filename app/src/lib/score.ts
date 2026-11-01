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
  runes: Map<string, RunePage[]>;   // `${champ}|${rôle}` -> pages, la meilleure d'abord
  runeVs: Map<string, number>;      // `${champ}|${rôle}|${vis-à-vis}` -> rune clé conseillée
}

/** Page de runes : rune clé, arbre principal et ses 3 runes, arbre secondaire et ses 2 runes, 3 fragments. */
export interface RunePage {
  keystone: number; games: number; wins: number;
  primaryStyle: number; primary: number[];
  subStyle: number; sub: number[];
  shards: number[];
}
type RawPage = [number, number, number, number, number[], number, number[], number[]];

interface RawStats {
  meta: Record<string, string>;
  params: Params;
  ddragon: string;
  champions: [number, string, string][];
  base: [number, number, number, number][];
  lane: [number, number, number, number, number][];
  vs: [number, number, number, number, number][];
  ally: [number, number, number, number, number][];
  runes?: [number, number, RawPage[]][];
  runeVs?: [number, number, number, number, number, number][];
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
    runes: new Map(),
    runeVs: new Map(),
  };
  for (const [c, r, pages] of raw.runes ?? []) {
    stats.runes.set(k2(c, r), pages.map(([keystone, games, wins, primaryStyle, primary, subStyle, sub, shards]) =>
      ({ keystone, games, wins, primaryStyle, primary, subStyle, sub, shards })));
  }
  for (const [c, r, o, k] of raw.runeVs ?? []) stats.runeVs.set(k3(c, r, o), k);
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
  bans: number[] = [], top = 3, discoveries = 3,
): { pool: Result[]; discoveries: Result[] } {
  const taken = new Set([...allies, ...enemies, ...bans]);
  const poolResults = pool
    .filter((c) => !taken.has(c))
    .map((c) => scoreChampion(stats, c, role, allies, enemies))
    .sort((a, b) => b.score - a.score);

  const poolSet = new Set(pool);
  const others: Result[] = [];
  for (const [key, [g]] of stats.base) {
    const [cs, rs] = key.split("|");
    const c = Number(cs);
    if (Number(rs) !== role || g < DISCOVERY_MIN_GAMES || poolSet.has(c) || taken.has(c)) continue;
    others.push(scoreChampion(stats, c, role, allies, enemies));
  }
  others.sort((a, b) => b.score - a.score);
  return { pool: poolResults.slice(0, top), discoveries: others.slice(0, discoveries) };
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

/** Page conseillée : la meilleure du champion, ou celle qui marche mieux face au vis-à-vis probable. */
export function runePageFor(stats: Stats, champ: number, role: number, laner?: number | null):
  { page: RunePage; vs: number | null } | null {
  const pages = stats.runes.get(k2(champ, role));
  if (!pages?.length) return null;
  if (laner != null) {
    const key = stats.runeVs.get(k3(champ, role, laner));
    const page = key != null ? pages.find((p) => p.keystone === key) : undefined;
    if (page) return { page, vs: laner };
  }
  return { page: pages[0], vs: null };
}

export interface BanSuggestion { champ: number; winrate: number; games: number; against: boolean }

const BAN_MIN_LANE_GAMES = 30;

/**
 * 3 bans conseillés. Avec un champion présélectionné : les vis-à-vis contre lesquels il gagne le moins
 * (winrate du champion contre eux). Sinon : les meilleurs winrates du rôle.
 */
export function banSuggestions(stats: Stats, role: number, myChamp: number | null, taken: number[],
                               n = 3, params: Params = stats.params): BanSuggestion[] {
  const skip = new Set(taken);
  if (myChamp != null) skip.add(myChamp);
  const out: BanSuggestion[] = [];
  if (myChamp != null) {
    const [g, w] = stats.base.get(k2(myChamp, role)) ?? [0, 0];
    const base = smoothed(g, w, 0.5, params.k_base);
    for (const [key, [lg, lw]] of stats.lane) {
      const [cs, rs, os] = key.split("|");
      if (Number(cs) !== myChamp || Number(rs) !== role || lg < BAN_MIN_LANE_GAMES || skip.has(Number(os))) continue;
      out.push({ champ: Number(os), winrate: smoothed(lg, lw, base, params.k_delta), games: lg, against: true });
    }
    if (out.length) return out.sort((a, b) => a.winrate - b.winrate).slice(0, n);
  }
  for (const [key, [g, w]] of stats.base) {
    const [cs, rs] = key.split("|");
    const c = Number(cs);
    if (Number(rs) !== role || g < DISCOVERY_MIN_GAMES || skip.has(c)) continue;
    out.push({ champ: c, winrate: smoothed(g, w, 0.5, params.k_base), games: g, against: false });
  }
  return out.sort((a, b) => b.winrate - a.winrate).slice(0, n);
}

/** Phrase courte qui explique pourquoi un champion est (ou n'est pas) un bon choix dans cette draft. */
const NOTABLE = 0.003; // écart mentionné à partir de 0,3 point (les écarts calibrés restent petits)

export function explain(stats: Stats, res: Result, role: number, allies: number[],
                        params: Params = stats.params): string {
  const name = (c: number) => stats.champions.get(c)?.name ?? "ce champion";
  const pt = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1).replace(".", ",")} pt`;
  const good: string[] = [], bad: string[] = [];
  const laner = res.details[0];
  // même valeur que l'étiquette « Face à … » (effet de la ligne, pondéré par la probabilité du vis-à-vis)
  if (laner && laner.p >= 0.3 && Math.abs(res.lane) >= NOTABLE) {
    (res.lane > 0 ? good : bad).push(
      `${res.lane > 0 ? "gagne" : "perd"} face à ${name(laner.enemy)} (${pt(res.lane)})`);
  }
  if (Math.abs(res.counters) >= NOTABLE) {
    (res.counters > 0 ? good : bad).push(res.counters > 0
      ? `tient bien face au reste de leur équipe (${pt(res.counters)})`
      : `est gêné par le reste de leur équipe (${pt(res.counters)})`);
  }
  let best: { ally: number; d: number } | null = null;
  for (const a of allies) {
    const [ag, aw] = stats.ally.get(k3(res.champ, role, a)) ?? [0, 0];
    const d = smoothed(ag, aw, res.base, params.k_delta) - res.base;
    if (!best || Math.abs(d) > Math.abs(best.d)) best = { ally: a, d };
  }
  if (best && Math.abs(best.d) >= NOTABLE) {
    (best.d > 0 ? good : bad).push(best.d > 0 ? `s'accorde bien avec ${name(best.ally)}`
                                              : `s'accorde mal avec ${name(best.ally)}`);
  }
  const join = (xs: string[]) => xs.length > 1 ? `${xs.slice(0, -1).join(", ")} et ${xs[xs.length - 1]}` : xs[0];
  const verdict = res.score >= 0.51 ? "Bon choix" : res.score <= 0.49 ? "Choix risqué" : "Choix correct";
  const champ = name(res.champ);
  const base = `${(res.base * 100).toFixed(1).replace(".", ",")} %`;
  if (!good.length && !bad.length) {
    return `${verdict} : pas d'avantage ni de handicap marqué pour ${champ} ici, son score vient surtout de sa force ce patch (${base} de base).`;
  }
  if (good.length && bad.length) return `${verdict} : ${champ} ${join(good)}, mais ${join(bad)}.`;
  return `${verdict} : ${champ} ${join(good.length ? good : bad)}.`;
}
