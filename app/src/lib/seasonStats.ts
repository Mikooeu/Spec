// Page Stats du profil : totaux de la saison (serveur Spec, Solo/Duo) ou des dernières parties du client LoL.
import { API_URL } from "./api";
import type { Game } from "./history";

export type GW = [number, number];   // parties, victoires

export interface ChampLine {
  champ: number; role: number;          // rôle -1 : inconnu
  games: number; wins: number;
  kills: number; deaths: number; assists: number;
  cs: number; gold: number; seconds: number; pentas: number;
}

export interface SeasonStats {
  /** "season" : toute la saison Solo/Duo gardée par le serveur ; "recent" : parties chargées dans l'historique. */
  source: "season" | "recent";
  games: number;
  champions: ChampLine[];
  sides: [GW, GW];                      // bleu, rouge (parties dont le côté est connu)
  surrender: { known: number; games: number; wins: number };
  duration: [GW, GW];                   // moins de 30 min, 30 min et plus
  days: GW[];                           // lundi … dimanche, à l'heure du PC
}

const SHORT = 30 * 60;

/** Totaux de la saison Solo/Duo du joueur inscrit (aucun appel Riot côté serveur). */
export async function loadSeasonStats(client: string): Promise<SeasonStats> {
  const tz = -new Date().getTimezoneOffset();
  const r = await fetch(`${API_URL}/v1/players/${encodeURIComponent(client)}/stats?tz=${tz}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const raw = (await r.json()) as {
    champions: number[][]; sides: GW[]; surrender: SeasonStats["surrender"]; duration: GW[]; days: GW[];
  };
  const champions = raw.champions.map(([champ, role, games, wins, kills, deaths, assists, cs, gold, seconds, pentas]) =>
    ({ champ, role, games, wins, kills, deaths, assists, cs, gold, seconds, pentas }));
  return {
    source: "season", games: champions.reduce((a, c) => a + c.games, 0), champions,
    sides: [raw.sides[0] ?? [0, 0], raw.sides[1] ?? [0, 0]], surrender: raw.surrender,
    duration: [raw.duration[0] ?? [0, 0], raw.duration[1] ?? [0, 0]], days: raw.days,
  };
}

/** Mêmes totaux calculés sur des parties déjà chargées (Flex, 5c5, toutes files, ou stats perso désactivées). */
export function statsOf(games: Game[]): SeasonStats {
  const played = games.filter((g) => !g.remake);
  const by = new Map<string, ChampLine>();
  const sides: [GW, GW] = [[0, 0], [0, 0]];
  const duration: [GW, GW] = [[0, 0], [0, 0]];
  const days: GW[] = Array.from({ length: 7 }, () => [0, 0] as GW);
  const surrender = { known: 0, games: 0, wins: 0 };
  const add = (gw: GW, win: boolean) => { gw[0] += 1; gw[1] += win ? 1 : 0; };
  for (const g of played) {
    const role = g.role ?? -1;
    const key = `${g.champ}:${role}`;
    const c = by.get(key) ?? { champ: g.champ, role, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, cs: 0, gold: 0, seconds: 0, pentas: 0 };
    c.games += 1; c.wins += g.win ? 1 : 0;
    c.kills += g.kills; c.deaths += g.deaths; c.assists += g.assists;
    c.cs += g.cs; c.gold += g.gold; c.seconds += g.duration; c.pentas += g.pentas ?? 0;
    by.set(key, c);
    if (g.side != null) add(sides[g.side], g.win);
    if (g.ff != null) { surrender.known += 1; if (g.ff) { surrender.games += 1; surrender.wins += g.win ? 1 : 0; } }
    add(duration[g.duration < SHORT ? 0 : 1], g.win);
    add(days[(new Date(g.created).getDay() + 6) % 7], g.win);
  }
  return { source: "recent", games: played.length, champions: [...by.values()], sides, surrender, duration, days };
}

export type SortKey = "score" | "games" | "wr" | "kda" | "cs" | "gold" | "pentas";

export const kdaOf = (c: Pick<ChampLine, "kills" | "deaths" | "assists">) =>
  c.deaths ? (c.kills + c.assists) / c.deaths : c.kills + c.assists;
export const perMinute = (x: number, seconds: number) => (seconds > 60 ? x / (seconds / 60) : 0);

/**
 * Score d'un champion sur 100 (50 = ton niveau habituel) : winrate lissé (peu de parties = rapproché de 50 %),
 * puis KDA, CS/min et or/min comparés à ta moyenne dans le même rôle. Le winrate compte le plus ; les trois autres
 * pèsent d'autant moins que le champion a peu de parties.
 */
export function champScore(c: ChampLine, all: ChampLine[]): number {
  const same = all.filter((x) => x.role === c.role);
  const sum = (f: (x: ChampLine) => number) => same.reduce((a, x) => a + f(x), 0);
  const secs = sum((x) => x.seconds);
  const refKda = kdaOf({ kills: sum((x) => x.kills), deaths: sum((x) => x.deaths), assists: sum((x) => x.assists) }) || 2.5;
  const refCs = perMinute(sum((x) => x.cs), secs), refGold = perMinute(sum((x) => x.gold), secs);
  const clip = (x: number, m: number) => Math.max(-m, Math.min(m, x));
  const wr = (c.wins + SCORE_K * 0.5) / (c.games + SCORE_K);
  const trust = c.games / (c.games + 5);
  const kda = clip(Math.log((kdaOf(c) || 0.1) / refKda) * 8, 8);
  const cs = c.role === 4 || !refCs ? 0 : clip(((perMinute(c.cs, c.seconds) - refCs) / refCs) * 25, 6);
  const gold = !refGold ? 0 : clip(((perMinute(c.gold, c.seconds) - refGold) / refGold) * 25, 6);
  return Math.round(Math.max(0, Math.min(100, 50 + (wr - 0.5) * 200 + trust * (kda + cs + gold))));
}
const SCORE_K = 10;   // lissage du winrate : 10 parties « à 50 % » ajoutées

/** Lignes du tableau : rôle choisi (null : tous, une ligne par champion et par rôle), minimum de parties, tri. */
export function champRows(s: SeasonStats, role: number | null, min: number, sort: SortKey, asc: boolean): ChampLine[] {
  const value = (c: ChampLine) =>
    sort === "score" ? champScore(c, s.champions) : sort === "games" ? c.games : sort === "wr" ? c.wins / c.games : sort === "kda" ? kdaOf(c)
      : sort === "cs" ? perMinute(c.cs, c.seconds) : sort === "gold" ? perMinute(c.gold, c.seconds) : c.pentas;
  return s.champions
    .filter((c) => c.games >= min && (role == null || c.role === role))
    .sort((a, b) => (asc ? 1 : -1) * (value(a) - value(b)) || b.games - a.games);
}
