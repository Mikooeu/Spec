// Calcul du score : portage exact de scoring/score.py (même formule, mêmes réglages).
//
// Score(c) = WR(c,R) + Σe pe(R)·Δlane(c,e) + α·Σe (1 − pe(R))·Δvs(c,e) + β·Σa Δavec(c,a)
// Chaque winrate est lissé : (victoires + k·référence) / (parties + k).
//
// Seul écart avec scoring/score.py : en botlane (ADC et support), l'autre joueur bot d'en face compte
// comme un vis-à-vis (poids 1 au lieu de α) et la synergie avec ton partenaire de lane compte double.
import { dec1, pct } from "./ui";
import { t } from "./i18n";

export const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
export const ROLE_LABELS = [t("Top"), t("Jungle"), t("Mid"), "ADC", t("Support")];
export const ROLE_SHORT = ["TOP", "JGL", "MID", "ADC", "SUP"];
export const DISCOVERY_MIN_GAMES = 200;
/** Découvertes : champions joués dans au moins 3 % des parties de ce rôle (pas de top proposé en mid). */
export const DISCOVERY_MIN_PICKRATE = 0.03;
/** Botlane : partenaire de lane (ADC ↔ support). */
const BOT_PARTNER: Record<number, number> = { 3: 4, 4: 3 };
const BOT_SYNERGY_BOOST = 1;   // synergie avec ton partenaire de lane : ×2
export const LOW_DATA_GAMES = 200;

export type Pair = [games: number, wins: number];

export interface Params {
  alpha: number;
  beta: number;
  k_base: number;
  k_delta: number;
  /** Échelle de la probabilité de victoire d'équipe (calibrée sur le serveur) ; 0 ou absent : pas encore validée. */
  team?: number;
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
  bans: Map<number, number>;        // champion -> parties où il est banni (parties détaillées)
  banMatches: number;               // parties détaillées (dénominateur du banrate), 0 si pas encore collecté
  matchesWeighted: number;          // parties pondérées (dénominateur du pickrate)
  champPages: Map<string, ChampPage>; // `${champ}|${rôle}` -> sorts, objets, ordre des sorts
  /** Dégâts infligés aux champions par type, en Master+ : champion -> [part AD, part AP, part brute, parties] (tous rôles). */
  damage: Map<number, [number, number, number, number]>;
}

type GW = [games: number, wins: number];
/** Page champion (voir scoring/builds.py). g : parties détaillées, tg : parties avec déroulé. */
export interface ChampPage {
  g: number; tg: number;
  spellsVs?: [number, number, number, number, number][]; // vis-à-vis, sort 1, sort 2, parties, victoires
  spells: [number, number, number, number][];          // sort 1, sort 2, parties, victoires
  boots: [number, number, number][];                   // objet, parties, victoires
  support?: [number, number, number][];                // supports : évolution finale de l’objet de quête, parties, victoires
  start: [string, number, number][];                   // « 1056,2003,2003 », parties, victoires
  skills: [string, string, number, number] | null;     // ordre, priorité, parties, victoires
  items: [number, [number, number, number][]][];       // par rang : parties à ce rang, [objet, parties, victoires]
  builds: [number[], number, number][];                // enchaînement, parties, victoires
}
export type { GW };

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
  bans?: [number, number][];
  champ?: [number, number, ChampPage][];
  damage?: [number, number, number, number, number, number][];
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
    bans: new Map(raw.bans ?? []),
    banMatches: Number(raw.meta.ban_matches ?? 0),
    matchesWeighted: 0,
    champPages: new Map((raw.champ ?? []).map(([c, r, e]) => [k2(c, r), e])),
    damage: new Map(),
  };
  // profil de dégâts par champion, tous rôles confondus (pondéré par les parties de chaque rôle)
  for (const [c, , ad, ap, tru, g] of raw.damage ?? []) {
    const cur = stats.damage.get(c) ?? [0, 0, 0, 0];
    const n = cur[3] + g;
    stats.damage.set(c, n ? [(cur[0] * cur[3] + ad * g) / n, (cur[1] * cur[3] + ap * g) / n, (cur[2] * cur[3] + tru * g) / n, n] : cur);
  }
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
  // 10 joueurs par partie : la somme des parties de chaque champion / 10 = parties (pondérées)
  stats.matchesWeighted = raw.base.reduce((a, [, , g]) => a + g, 0) / 10;
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

/**
 * Rôles de l'équipe adverse, pensés comme une vraie équipe : un seul joueur par rôle.
 * On essaie toutes les répartitions possibles (5! = 120 au plus), chacune pondérée par la probabilité
 * que chaque champion joue le rôle qu'elle lui donne. On en tire :
 *  - best : la répartition la plus probable (rôle affiché à côté de chaque adversaire) ;
 *  - marginal[i][r] : probabilité que l'adversaire i joue le rôle r (utilisée pour les vis-à-vis).
 */
const ROLE_FLOOR = 0.005; // un rôle jamais vu reste possible (picks hors méta, doublons en partie perso)
const roleCaches = new WeakMap<Stats, Map<string, { best: number[]; marginal: number[][] }>>();

/** Équipe adverse affichée comme la tienne : une ligne par rôle (Top en haut, Support en bas), chaque adversaire
 *  sur le rôle qu'il a le plus de chances de jouer. Renvoie l'index d'origine de chaque ligne (le mode démo modifie
 *  l'emplacement cliqué : pour une ligne vide, le premier emplacement libre). */
export function enemyDisplay(stats: Stats, slots: (number | null)[]): { index: number; role: number | null }[] {
  const picked = slots.map((c, index) => ({ c, index })).filter((x): x is { c: number; index: number } => x.c != null);
  const { best } = enemyRoles(stats, picked.map((x) => x.c));
  const byRole = new Map<number, number>();
  const extra: number[] = [];
  picked.forEach((x, j) => { const r = best[j]; if (r != null && !byRole.has(r)) byRole.set(r, x.index); else extra.push(x.index); });
  const free = slots.map((c, index) => (c == null ? index : -1)).filter((i) => i >= 0);
  const rows: { index: number; role: number | null }[] = [];
  for (let r = 0; r < 5; r++) {
    const i = byRole.get(r) ?? extra.shift() ?? free.shift();
    if (i != null) rows.push({ index: i, role: byRole.has(r) ? r : slots[i] == null ? r : null });
  }
  return rows;
}

export function enemyRoles(stats: Stats, enemies: number[]): { best: number[]; marginal: number[][] } {
  const key = enemies.join(",");
  let roleCache = roleCaches.get(stats);
  if (!roleCache) { roleCache = new Map(); roleCaches.set(stats, roleCache); }
  const hit = roleCache.get(key);
  if (hit) return hit;
  const probs = enemies.map((e) => {
    const dist = stats.roleGames.get(e);
    const total = dist ? dist.reduce((a, b) => a + b, 0) : 0;
    return [0, 1, 2, 3, 4].map((r) => (total ? dist![r] / total : 0.2) + ROLE_FLOOR);
  });
  const n = Math.min(enemies.length, 5);
  const marginal = enemies.map(() => [0, 0, 0, 0, 0]);
  let best: number[] = [], bestW = -1, totalW = 0;
  const used = [false, false, false, false, false];
  const pick: number[] = [];
  const walk = (i: number, w: number) => {
    if (i === n) {
      totalW += w;
      pick.forEach((r, j) => { marginal[j][r] += w; });
      if (w > bestW) { bestW = w; best = [...pick]; }
      return;
    }
    for (let r = 0; r < 5; r++) {
      if (used[r]) continue;
      used[r] = true; pick.push(r);
      walk(i + 1, w * probs[i][r]);
      used[r] = false; pick.pop();
    }
  };
  walk(0, 1);
  for (const row of marginal) for (let r = 0; r < 5; r++) row[r] = totalW ? row[r] / totalW : 0;
  const out = { best, marginal };
  if (roleCache.size >= 500) roleCache.clear();
  roleCache.set(key, out);
  return out;
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

  // probabilité que chaque ennemi soit le vis-à-vis, en répartissant les rôles comme une vraie équipe
  const { marginal } = enemyRoles(stats, enemies);
  const probs = enemies.map((_, i) => marginal[i]?.[role] ?? 0);
  // en botlane, l'autre joueur bot d'en face compte comme un vis-à-vis
  const partner = BOT_PARTNER[role];
  const duo = enemies.map((_, i) => (partner != null ? marginal[i]?.[partner] ?? 0 : 0));

  let lane = 0, counters = 0, synergies = 0;
  const details: LaneDetail[] = [];
  enemies.forEach((e, i) => {
    const [lg, lw] = stats.lane.get(k3(champ, role, e)) ?? [0, 0];
    const dLane = smoothed(lg, lw, base, params.k_delta) - base;
    const [vg, vw] = stats.vs.get(k3(champ, role, e)) ?? [0, 0];
    const dVs = smoothed(vg, vw, base, params.k_delta) - base;
    const laneContribution = probs[i] * dLane + duo[i] * dVs;
    const counterContribution = params.alpha * Math.max(0, 1 - probs[i] - duo[i]) * dVs;
    lane += laneContribution;
    counters += counterContribution;
    details.push({ enemy: e, p: probs[i], delta: dLane, games: lg, wins: lw,
                   counterDelta: laneContribution + counterContribution });
  });
  for (const a of allies) {
    const [ag, aw] = stats.ally.get(k3(champ, role, a)) ?? [0, 0];
    const boost = partner != null ? 1 + BOT_SYNERGY_BOOST * roleProbability(stats, a, partner) : 1;
    synergies += boost * params.beta * (smoothed(ag, aw, base, params.k_delta) - base);
  }
  details.sort((x, y) => y.p - x.p);
  return { champ, score: base + lane + counters + synergies, base, lane, counters, synergies,
           games: g, details };
}

export function recommend(
  stats: Stats, role: number, pool: number[], allies: number[], enemies: number[],
  bans: number[] = [], top = 3, discoveries = 6,
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
    if (Number(rs) !== role || g < DISCOVERY_MIN_GAMES || !playedInRole(stats, g) || poolSet.has(c) || taken.has(c)) continue;
    others.push(scoreChampion(stats, c, role, allies, enemies));
  }
  others.sort((a, b) => b.score - a.score);
  return { pool: poolResults.slice(0, top), discoveries: others.slice(0, discoveries) };
}

/** Pick rate dans ce rôle d'au moins 3 % (sans données de parties, on ne filtre pas). */
function playedInRole(stats: Stats, games: number): boolean {
  return !stats.matchesWeighted || games / stats.matchesWeighted >= DISCOVERY_MIN_PICKRATE;
}

/** Meilleurs champions d'un rôle, tous confondus (utile en autofill). */
export function topForRole(stats: Stats, role: number, allies: number[], enemies: number[],
                           exclude: number[], n: number): Result[] {
  const taken = new Set([...allies, ...enemies, ...exclude]);
  const out: Result[] = [];
  for (const [key, [g]] of stats.base) {
    const [cs, rs] = key.split("|");
    const c = Number(cs);
    if (Number(rs) !== role || g < DISCOVERY_MIN_GAMES || !playedInRole(stats, g) || taken.has(c)) continue;
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

export const FLASH = 4;

/** Sorts conseillés : ceux du matchup s'ils font nettement mieux (≥ 30 parties), sinon les plus joués. */
export function spellsFor(stats: Stats, champ: number, role: number, laner?: number | null):
  { spells: [number, number]; vs: number | null } | null {
  const page = stats.champPages.get(k2(champ, role));
  if (!page?.spells.length) return null;
  if (laner != null) {
    const hit = page.spellsVs?.find(([o]) => o === laner);
    if (hit) return { spells: [hit[1], hit[2]], vs: laner };
  }
  return { spells: [page.spells[0][0], page.spells[0][1]], vs: null };
}

/** Ordre D puis F : Flash sur la touche choisie (F par défaut), l'autre sort sur l'autre touche. */
export function orderSpells([a, b]: [number, number], flashKey: "D" | "F"): [number, number] {
  if (a !== FLASH && b !== FLASH) return [a, b];
  const other = a === FLASH ? b : a;
  return flashKey === "D" ? [FLASH, other] : [other, FLASH];
}

export interface BanSuggestion { champ: number; winrate: number; games: number; against: boolean }

const BAN_MIN_LANE_GAMES = 30;

/**
 * 3 bans conseillés. Avec un champion présélectionné : ses vis-à-vis perdants (moins de 50 % pour lui,
 * lissé vers son winrate de base, donc un petit échantillon ne compte pas), du pire au moins pire.
 * S'il en manque, on complète avec les meilleurs winrates du rôle.
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
      const winrate = smoothed(lg, lw, base, params.k_delta);
      if (winrate < 0.5) out.push({ champ: Number(os), winrate, games: lg, against: true });
    }
    out.sort((a, b) => a.winrate - b.winrate);
    out.splice(n);
    if (out.length === n) return out;
  }
  const strongest: BanSuggestion[] = [];
  const chosen = new Set(out.map((b) => b.champ));
  for (const [key, [g, w]] of stats.base) {
    const [cs, rs] = key.split("|");
    const c = Number(cs);
    if (Number(rs) !== role || g < DISCOVERY_MIN_GAMES || skip.has(c) || chosen.has(c)) continue;
    strongest.push({ champ: c, winrate: smoothed(g, w, 0.5, params.k_base), games: g, against: false });
  }
  strongest.sort((a, b) => b.winrate - a.winrate);
  return [...out, ...strongest.slice(0, n - out.length)];
}

/** Phrase courte qui explique pourquoi un champion est (ou n'est pas) un bon choix dans cette draft. */
const NOTABLE = 0.003; // écart mentionné à partir de 0,3 point (les écarts calibrés restent petits)

export function explain(stats: Stats, res: Result, role: number, allies: number[],
                        params: Params = stats.params): string {
  const name = (c: number) => stats.champions.get(c)?.name ?? t("ce champion");
  const pt = (x: number) => `${x >= 0 ? "+" : "−"}${dec1(Math.abs(x * 100))} pt`;
  const good: string[] = [], bad: string[] = [];
  const laner = res.details[0];
  // même valeur que l'étiquette « Face à … » (effet de la ligne, pondéré par la probabilité du vis-à-vis)
  if (laner && laner.p >= 0.3 && Math.abs(res.lane) >= NOTABLE) {
    (res.lane > 0 ? good : bad).push(
      t("{v} face à {name} ({pt})", { v: res.lane > 0 ? t("gagne") : t("perd"), name: name(laner.enemy), pt: pt(res.lane) }));
  }
  if (Math.abs(res.counters) >= NOTABLE) {
    (res.counters > 0 ? good : bad).push(res.counters > 0
      ? t("tient bien face au reste de leur équipe ({pt})", { pt: pt(res.counters) })
      : t("est gêné par le reste de leur équipe ({pt})", { pt: pt(res.counters) }));
  }
  let best: { ally: number; d: number } | null = null;
  for (const a of allies) {
    const [ag, aw] = stats.ally.get(k3(res.champ, role, a)) ?? [0, 0];
    const d = smoothed(ag, aw, res.base, params.k_delta) - res.base;
    if (!best || Math.abs(d) > Math.abs(best.d)) best = { ally: a, d };
  }
  if (best && Math.abs(best.d) >= NOTABLE) {
    (best.d > 0 ? good : bad).push(best.d > 0 ? t("s'accorde bien avec {name}", { name: name(best.ally) })
                                              : t("s'accorde mal avec {name}", { name: name(best.ally) }));
  }
  const join = (xs: string[]) => xs.length > 1 ? t("{a} et {b}", { a: xs.slice(0, -1).join(", "), b: xs[xs.length - 1] }) : xs[0];
  const verdict = res.score >= 0.51 ? t("Bon choix") : res.score <= 0.49 ? t("Choix risqué") : t("Choix correct");
  const champ = name(res.champ);
  const base = pct(res.base);
  if (!good.length && !bad.length) {
    return t("{verdict} : pas d'avantage ni de handicap marqué pour {champ} ici, son score vient surtout de sa force ce patch ({base} de base).", { verdict: verdict, champ: champ, base: base });
  }
  if (good.length && bad.length) return t("{verdict} : {champ} {join}, mais {join2}.", { verdict: verdict, champ: champ, join: join(good), join2: join(bad) });
  return t("{verdict} : {champ} {join}.", { verdict, champ, join: join(good.length ? good : bad) });
}

/**
 * Tier list : champions d'un rôle joués dans plus de `minPick` des parties, classés par score.
 * Score = winrate rapproché de 50 % d'autant plus que le champion a peu de parties (un 56 % sur 300 parties
 * pèse moins qu'un 52 % sur 5 000), plus un petit bonus de pick rate et de ban rate (champion fort et stable
 * dans la méta Master+). La lettre de tier vient de ce score.
 */
export interface TierRow {
  champ: number; role: number; winrate: number; pickrate: number; banrate: number | null; games: number; score: number; tier: string;
  offRole: boolean;   // moins de 30 % des parties du champion dans ce rôle
  niche: boolean;     // pick rate sous 3 % : pas au-dessus du tier A
}
// Plancher de la tier list : sous 50 parties (pondérées) dans le rôle, le winrate ne veut encore rien dire.
// Pas de seuil de pick rate : le score plafonne déjà les picks rares (niche, hors rôle).
export const TIER_MIN_GAMES = 50;
const TIER_K = 1000;          // parties « fictives » à 50 % ajoutées pour lisser le winrate
// Pick rate : centré sur 5 % (un pick courant), +0,15 point par point de pick rate au-dessus, autant en moins en dessous.
// Un pick de niche à gros winrate (souvent joué par des spécialistes) ne passe plus devant les champions du méta.
const PICK_BONUS = 0.15;
const PICK_CENTER = 0.05;
// Pick hors rôle : moins de 30 % des parties du champion dans ce rôle (Karthus ADC) → pas au-dessus du tier B.
export const OFF_ROLE_SHARE = 0.3;
const OFF_ROLE_MAX = 0.5069;
// Pick de niche : moins de 3 % de pick rate → pas au-dessus du tier A (un gros winrate sur peu de joueurs spécialistes).
export const NICHE_PICKRATE = 0.03;
const NICHE_MAX = 0.5149;
const BAN_BONUS = 0.02;       // +0,2 point pour 10 % de ban rate
const BONUS_CAP = 0.15;       // au-delà de 15 % de pick (ou de ban) rate, plus de bonus : le winrate reste décisif

export function tierScore(stats: Stats, champ: number, role: number): number {
  const [g, w] = stats.base.get(k2(champ, role)) ?? [0, 0];
  const pickrate = stats.matchesWeighted ? g / stats.matchesWeighted : 0;
  const banrate = stats.banMatches > 0 ? (stats.bans.get(champ) ?? 0) / stats.banMatches : 0;
  const score = smoothed(g, w, 0.5, TIER_K) + PICK_BONUS * (Math.min(pickrate, BONUS_CAP) - PICK_CENTER)
    + BAN_BONUS * Math.min(banrate, BONUS_CAP);
  if (roleShare(stats, champ, role) < OFF_ROLE_SHARE) return Math.min(score, OFF_ROLE_MAX);
  return pickrate < NICHE_PICKRATE ? Math.min(score, NICHE_MAX) : score;
}

/** Part des parties du champion jouées dans ce rôle (1 = toujours dans ce rôle). */
export function roleShare(stats: Stats, champ: number, role: number): number {
  let all = 0;
  for (let r = 0; r < 5; r++) all += stats.base.get(k2(champ, r))?.[0] ?? 0;
  return all ? (stats.base.get(k2(champ, role))?.[0] ?? 0) / all : 0;
}

export function tierLetter(score: number): string {
  return score >= 0.515 ? "S" : score >= 0.507 ? "A" : score >= 0.5 ? "B" : score >= 0.493 ? "C" : "D";
}

export function tierList(stats: Stats, role: number, minGames = TIER_MIN_GAMES): TierRow[] {
  const out: TierRow[] = [];
  if (!stats.matchesWeighted) return out;
  for (const [key, [g, w]] of stats.base) {
    const [cs, rs] = key.split("|");
    if (Number(rs) !== role || !g) continue;
    if (g < minGames) continue;
    const pickrate = g / stats.matchesWeighted;
    const c = Number(cs);
    const score = tierScore(stats, c, role);
    out.push({ champ: c, role, winrate: w / g, pickrate, games: g, score, tier: tierLetter(score),
               offRole: roleShare(stats, c, role) < OFF_ROLE_SHARE, niche: pickrate < NICHE_PICKRATE,
               banrate: stats.banMatches > 0 ? (stats.bans.get(c) ?? 0) / stats.banMatches : null });
  }
  return out;
}
