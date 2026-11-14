// Historique de parties (client LoL et serveur Spec), détail d'une partie, profil d'un autre joueur,
// et suivi des LP gagnés ou perdus pendant que Spec est ouvert.
// Les autres joueurs n'apparaissent que dans une partie terminée ou un profil cherché, jamais en draft.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { ClientState } from "./lcu";
import { API_URL } from "./api";
import { t } from "./i18n";

export type QueueKind = "solo" | "flex" | "5c5" | "other";
export const QUEUE_LABELS: Record<QueueKind, string> = { solo: "Solo/Duo", flex: t("Flex"), "5c5": "5c5", other: t("Autre") };

export interface Game {
  id: number;
  queue: QueueKind;
  queueName: string;
  queueType: string | null; // type de file du client (« RANKED_SOLO_5x5 »…), pour retrouver les LP
  champ: number;
  role: number | null;      // index dans ROLES, null si inconnu
  win: boolean;
  remake: boolean;
  kills: number; deaths: number; assists: number;
  cs: number;
  duration: number;         // secondes
  created: number;          // epoch ms
  /** Côté (0 bleu, 1 rouge), fin par abandon et pentakills : null quand la source ne les donne pas. */
  side: 0 | 1 | null; ff: boolean | null; pentas: number | null;
  lp: number | null;        // LP gagnés (+) ou perdus (−), null si la partie n'a pas été suivie
  items: number[];          // objets 0 à 6 (6 = balise), puis celui de la quête de rôle s'il est connu
  spells: number[];         // D, F
  keystone: number;         // rune clé (0 si inconnue)
  subStyle: number;         // arbre secondaire (0 si inconnu)
  gold: number;
  damage: number;           // dégâts aux champions
}

/** Une ligne du détail d'une partie (les 10 joueurs). */
export interface PlayerLine {
  puuid: string | null;
  name: string;             // « Pseudo#TAG »
  icon: number | null;      // icône d'invocateur
  champ: number;
  role: number | null;
  spells: number[]; keystone: number; subStyle: number;
  /** Page de runes jouée (détail d'une partie du client) ; null si le client ne l'a pas renvoyée. */
  runes: PlayedRunes | null;
  items: number[];
  kills: number; deaths: number; assists: number;
  cs: number; gold: number; damage: number;
  vision: number | null;    // score de vision (absent des vieilles parties)
}
export interface PlayedRunes { primary: number[]; sub: number[]; shards: number[] }

export interface GameDetail { duration: number; teams: { teamId: number; win: boolean; players: PlayerLine[] }[] }

interface Ranked { tier: string; division: string; leaguePoints: number }
interface RankedStats { queueMap?: Record<string, Ranked> }
interface QueueInfo { id: number; type?: string; isRanked?: boolean; mapId?: number; description?: string; shortName?: string }

const QUEUE_TYPE: Record<QueueKind, string | null> = { solo: "RANKED_SOLO_5x5", flex: "RANKED_FLEX_SR", "5c5": null, other: null };
const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"];
const DIVISIONS = ["IV", "III", "II", "I"];
const LP_KEY = "spec.lp.games";
const BEFORE_KEY = "spec.lp.before";
const SERIES_KEY = "spec.lp.series";

/** Point de la courbe des LP (Solo/Duo ou Flex) : LP « absolus » (promotions comprises) à un instant donné. */
export type LpQueue = "solo" | "flex" | "5c5";
export interface LpPoint { at: number; lp: number; game?: number }

// Une courbe par compte et par file : `spec.lp.series.<puuid>` (Solo/Duo), `spec.lp.series.flex.<puuid>` (Flex).
// Le compte affiché est le dernier vu dans le client.
const ACCOUNT_KEY = "spec.lp.account";
const seriesKey = (puuid: string, q: LpQueue = "solo") => (q === "solo" ? `${SERIES_KEY}.${puuid}` : `${SERIES_KEY}.${q}.${puuid}`);
/** Type de la file classée 5c5 (le week-end) dans le client : lu dans la liste des files, pas connu d'avance. */
export async function rankedType5c5(): Promise<string | null> {
  const list = await queues();
  for (const [id, q] of list) if (kindOf(id, q) === "5c5" && q.type) return q.type;
  return null;
}
export function readLpSeries(q: LpQueue = "solo"): LpPoint[] {
  const puuid = localStorage.getItem(ACCOUNT_KEY);
  if (!puuid) return [];
  try { const v = JSON.parse(localStorage.getItem(seriesKey(puuid, q)) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
/** Ajoute un point si les LP ont changé depuis le dernier (ou pour lier une partie à un point déjà noté). */
function pushLpPoint(p: LpPoint, q: LpQueue = "solo") {
  const list = readLpSeries(q);
  const last = list[list.length - 1];
  if (last && last.lp === p.lp && (!p.game || last.game === p.game)) return;
  if (p.game && list.some((x) => x.game === p.game)) return;
  list.push(p);
  const puuid = localStorage.getItem(ACCOUNT_KEY);
  if (!puuid) return;
  try { localStorage.setItem(seriesKey(puuid, q), JSON.stringify(list.slice(-600))); } catch { /* stockage plein */ }
}
/** Retient le compte connecté. L'ancienne courbe commune (avant la 0.3.15) n'est gardée
 *  que si elle finit sur les LP actuels de ce compte : sinon elle mélange plusieurs comptes. */
async function noteAccount(currentLp: number | null): Promise<boolean> {
  const me = await get<{ puuid?: string }>("/lol-summoner/v1/current-summoner").catch(() => null);
  if (!me?.puuid) return false;
  localStorage.setItem(ACCOUNT_KEY, me.puuid);
  const legacy = localStorage.getItem(SERIES_KEY);
  if (legacy != null) {
    try {
      const v = JSON.parse(legacy);
      const last = Array.isArray(v) ? v[v.length - 1] : null;
      if (last && last.lp === currentLp && localStorage.getItem(seriesKey(me.puuid)) == null) {
        const lps = v.map((p: LpPoint) => p.lp);
        // une seule session de suivi cohérente : pas de saut de plus de 150 LP entre deux points
        if (lps.every((lp: number, i: number) => i === 0 || Math.abs(lp - lps[i - 1]) <= 150)) localStorage.setItem(seriesKey(me.puuid), legacy);
      }
    } catch { /* ancienne courbe illisible */ }
    localStorage.removeItem(SERIES_KEY);
  }
  return true;
}
/** Note les LP Solo/Duo et Flex actuels (au chargement du profil, en début de draft). */
export async function noteSoloLp(r: RankedStats | null) {
  const lp = absoluteLp(r?.queueMap?.RANKED_SOLO_5x5);
  if (!(await noteAccount(lp ?? null))) return;
  if (lp != null) pushLpPoint({ at: Date.now(), lp });
  const flex = absoluteLp(r?.queueMap?.RANKED_FLEX_SR);
  if (flex != null) pushLpPoint({ at: Date.now(), lp: flex }, "flex");
  const type5 = await rankedType5c5().catch(() => null);
  const five = type5 ? absoluteLp(r?.queueMap?.[type5]) : null;
  if (five != null) pushLpPoint({ at: Date.now(), lp: five }, "5c5");
}
/** « Émeraude II · 47 LP » à partir de LP absolus. */
export function lpLabel(total: number, short = false): string {
  const apex = TIERS.length * 400;
  if (total >= apex) return short ? t("Maître+ {v}", { v: total - apex }) : t("Maître+ · {v} LP", { v: total - apex });
  const tier = Math.max(0, Math.floor(total / 400)), d = Math.min(3, Math.floor((total % 400) / 100));
  const name = `${TIER_FR[TIERS[tier]]} ${DIVISIONS[d]}`;
  return short ? name : `${name} · ${total % 100} LP`;
}

const get = <T,>(path: string) => invoke<T>("lcu_get", { path });

/** Rang Solo/Duo : « Émeraude II · 47 LP », ou null si non classé. */
const TIER_FR: Record<string, string> = {
  IRON: t("Fer"), BRONZE: t("Bronze"), SILVER: t("Argent"), GOLD: t("Or"), PLATINUM: t("Platine"), EMERALD: t("Émeraude"),
  DIAMOND: t("Diamant"), MASTER: t("Maître"), GRANDMASTER: t("Grand Maître"), CHALLENGER: t("Challenger"),
};
/** Palier en minuscules (« diamond ») pour l'emblème Riot, ou null sans classement. */
export function rankTier(r: Ranked | undefined): string | null {
  return !r || !r.tier || r.tier === "NONE" ? null : r.tier.toLowerCase();
}

export function rankText(r: Ranked | undefined): string | null {
  if (!r || !r.tier || r.tier === "NONE" || r.tier === "") return null;
  const apex = !TIERS.includes(r.tier);
  return `${TIER_FR[r.tier] ?? r.tier}${apex || !r.division || r.division === "NA" ? "" : ` ${r.division}`} · ${r.leaguePoints} LP`;
}

export async function readRanked(): Promise<RankedStats | null> {
  try { return await get<RankedStats>("/lol-ranked/v1/current-ranked-stats"); } catch { return null; }
}

/** LP « absolus » pour comparer avant / après une partie, promotions comprises. */
function absoluteLp(r: Ranked | undefined): number | null {
  if (!r || !r.tier || r.tier === "NONE") return null;
  const t = TIERS.indexOf(r.tier);
  if (t < 0) return TIERS.length * 400 + r.leaguePoints;          // Maître et au-dessus
  return t * 400 + Math.max(0, DIVISIONS.indexOf(r.division)) * 100 + r.leaguePoints;
}

let queuesCache: Promise<Map<number, QueueInfo>> | null = null;
function queues(): Promise<Map<number, QueueInfo>> {
  if (!queuesCache) {
    queuesCache = get<QueueInfo[]>("/lol-game-queues/v1/queues")
      .then((list) => new Map(list.map((q) => [q.id, q])))
      .catch(() => { queuesCache = null; return new Map(); });
  }
  return queuesCache;
}

function kindOf(queueId: number, info: QueueInfo | undefined): QueueKind {
  if (queueId === 420 || info?.type === "RANKED_SOLO_5x5") return "solo";
  if (queueId === 440 || info?.type === "RANKED_FLEX_SR") return "flex";
  if (info?.isRanked && (info.mapId ?? 11) === 11) return "5c5";   // classé 5 contre 5 en équipe complète
  return "other";
}

const POSITIONS: Record<string, number> = { TOP: 0, JUNGLE: 1, MIDDLE: 2, MID: 2, BOTTOM: 3, UTILITY: 4, SUPPORT: 4 };

const SMITE = 11;

/**
 * Poste joué. L'historique résumé du client ne donne pas de poste fiable (son champ « lane » vaut
 * souvent JUNGLE pour tout le monde), donc : le poste officiel s'il est présent, sinon Châtiment = jungle,
 * sinon le poste le plus joué de ce champion en Master+ (hors jungle, puisqu'il n'avait pas Châtiment).
 */
export function roleOf(p: { teamPosition?: string; individualPosition?: string; spell1Id?: number; spell2Id?: number; championId: number },
                guess?: Guess): number | null {
  const pos = p.teamPosition || p.individualPosition;
  if (pos && pos in POSITIONS) return POSITIONS[pos];
  const smite = p.spell1Id === SMITE || p.spell2Id === SMITE;
  if (smite) return 1;
  return guess ? guess(p.championId, true) : null;
}

function readLp(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(LP_KEY) ?? "{}"); } catch { return {}; }
}

/** LP gagnés ou perdus sur une partie suivie par Spec (null sinon). */
export const gameLp = (gameId: number): number | null => readLp()[String(gameId)] ?? null;

/** Rôle le plus probable d'un champion ; `dist` (parties par rôle) permet de répartir une équipe entière. */
export type Guess = ((champ: number, notJungle: boolean) => number | null) & { dist?: (champ: number) => number[] | null };

/**
 * Rôles d'une équipe quand le client ne les donne pas : un joueur par rôle, la répartition la plus probable
 * d'après les parties Master+ de chaque champion. Les postes connus (et le Châtiment pour le jungler) sont gardés.
 */
function assignTeamRoles(champs: number[], fixed: (number | null)[], dist: (champ: number) => number[] | null): number[] {
  const out = fixed.map((r) => r ?? -1);
  const free = [0, 1, 2, 3, 4].filter((r) => !out.includes(r));
  const open = out.map((r, i) => (r < 0 ? i : -1)).filter((i) => i >= 0);
  if (!open.length || open.length > free.length) return out.map((r) => (r < 0 ? 9 : r));
  const prob = (c: number, r: number) => {
    const d = dist(c); const tot = d ? d.reduce((a, b) => a + b, 0) : 0;
    return (tot ? d![r] / tot : 0.2) + 0.02;
  };
  let best: number[] = [], bestW = -1;
  const used = new Set<number>(), pick: number[] = [];
  const walk = (i: number, w: number) => {
    if (i === open.length) { if (w > bestW) { bestW = w; best = [...pick]; } return; }
    for (const r of free) {
      if (used.has(r)) continue;
      used.add(r); pick.push(r);
      walk(i + 1, w * prob(champs[open[i]], r));
      used.delete(r); pick.pop();
    }
  };
  walk(0, 1);
  open.forEach((i, k) => { out[i] = best[k]; });
  return out;
}
type RawStats = {
  win: boolean; kills: number; deaths: number; assists: number; totalMinionsKilled?: number;
  neutralMinionsKilled?: number; gameEndedInEarlySurrender?: boolean;
  item0?: number; item1?: number; item2?: number; item3?: number; item4?: number; item5?: number; item6?: number;
  roleBoundItem?: number; perk0?: number; perk1?: number; perk2?: number; perk3?: number; perk4?: number; perk5?: number;
  statPerk0?: number; statPerk1?: number; statPerk2?: number; perkPrimaryStyle?: number; perkSubStyle?: number; goldEarned?: number; totalDamageDealtToChampions?: number;
  visionScore?: number; pentaKills?: number; gameEndedInSurrender?: boolean;
};
export type RawParticipant = {
  participantId?: number; teamId?: number; championId: number; teamPosition?: string; individualPosition?: string;
  spell1Id?: number; spell2Id?: number; timeline?: { lane?: string; role?: string }; stats: RawStats;
};
export type RawGame = {
  gameId: number; queueId: number; gameCreation: number; gameDuration: number; mapId?: number;
  participants: RawParticipant[];
  participantIdentities?: { participantId: number; player?: { gameName?: string; tagLine?: string; puuid?: string; summonerName?: string; profileIcon?: number } }[];
  teams?: { teamId: number; win?: string | boolean; towerKills?: number; dragonKills?: number; baronKills?: number; riftHeraldKills?: number; hordeKills?: number }[];
};
export type RawHistory = { games?: { games?: RawGame[] } };

const n = (x: number | undefined) => (Number.isFinite(x) ? Math.max(0, Math.round(x as number)) : 0);
const seconds = (d: number) => (d > 10_000 ? Math.round(d / 1000) : d);
/** Runes jouées : 3 de l'arbre principal, 2 du secondaire, 3 fragments (null si le client ne les donne pas). */
function runesOf(s: RawStats): PlayedRunes | null {
  const primary = [s.perk1, s.perk2, s.perk3].map(n), sub = [s.perk4, s.perk5].map(n);
  const shards = [s.statPerk0, s.statPerk1, s.statPerk2].map(n);
  return n(s.perk0) && primary.every(Boolean) && sub.every(Boolean) ? { primary, sub, shards: shards.filter(Boolean) } : null;
}
const itemsOf = (s: RawStats) => [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6, s.roleBoundItem].map(n);

/** Parties d'un historique du client (celui du joueur connecté ou d'un joueur cherché). */
export async function parseHistory(raw: RawHistory, guess?: Guess): Promise<Game[]> {
  const [info, lp] = [await queues(), readLp()];
  const out: Game[] = [];
  for (const g of raw.games?.games ?? []) {
    const p = g.participants?.[0];   // un historique ne contient que le joueur concerné
    if (!p || (g.mapId != null && g.mapId !== 11)) continue;
    const q = info.get(g.queueId);
    const s = p.stats;
    const duration = seconds(g.gameDuration);
    out.push({
      id: g.gameId, queue: kindOf(g.queueId, q), queueName: q?.shortName || q?.description || t("Partie"),
      queueType: q?.type ?? QUEUE_TYPE[kindOf(g.queueId, q)],
      champ: p.championId, role: roleOf(p, guess), win: !!s.win,
      remake: duration < 300 || !!s.gameEndedInEarlySurrender,
      kills: s.kills, deaths: s.deaths, assists: s.assists,
      cs: (s.totalMinionsKilled ?? 0) + (s.neutralMinionsKilled ?? 0),
      duration, created: g.gameCreation, lp: lp[String(g.gameId)] ?? null,
      items: itemsOf(s), spells: [n(p.spell1Id), n(p.spell2Id)], keystone: n(s.perk0), subStyle: n(s.perkSubStyle),
      gold: n(s.goldEarned), damage: n(s.totalDamageDealtToChampions),
      side: p.teamId === 200 ? 1 : p.teamId === 100 ? 0 : null,
      ff: s.gameEndedInSurrender == null ? null : !!s.gameEndedInSurrender && !s.gameEndedInEarlySurrender,
      pentas: Number.isFinite(s.pentaKills) ? n(s.pentaKills) : null,
    });
  }
  return out.sort((a, b) => b.created - a.created);
}

/** Dernières parties sur la Faille du joueur connecté (client LoL), de la plus récente à la plus ancienne. */
export async function loadHistory(count = 50, guess?: Guess): Promise<Game[]> {
  return parseHistory(await invoke<RawHistory>("lcu_match_history", { count }), guess);
}

type ServerMatch = [string, number, number, number, number | null, number, number,
  [number, number, number, number, number, number, number, number[], number[], number, number, number?, number?, number?] | null];

/**
 * Parties classées solo de la saison gardées par le serveur Spec (stats perso activées) : l'historique
 * reste complet même quand celui du client ne montre que quelques parties. `before` : page suivante.
 */
export async function loadServerHistory(client: string, before?: number, limit = 20, withKey?: string): Promise<Game[]> {
  if (!API_URL) return [];
  const q = new URLSearchParams({ limit: String(limit) });
  if (before) q.set("before", String(before));
  if (withKey) q.set("with", withKey);
  const r = await fetch(`${API_URL}/v1/players/${encodeURIComponent(client)}/matches?${q}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { matches } = (await r.json()) as { matches: ServerMatch[] };
  const lp = readLp();
  return matches.map(([matchId, created, champ, role, , win, remake, d]) => {
    const id = Number(matchId.split("_")[1] ?? 0);
    const [duration, kills, deaths, assists, cs, gold, damage, items, spells, keystone, subStyle, side, ff, pentas] =
      d ?? [0, 0, 0, 0, 0, 0, 0, [], [], 0, 0];
    return {
      id, queue: "solo" as const, queueName: "Solo/Duo", queueType: "RANKED_SOLO_5x5",
      champ, role: role >= 0 ? role : null, win: !!win, remake: !!remake,
      kills, deaths, assists, cs, duration, created, lp: lp[String(id)] ?? null,
      items, spells, keystone, subStyle, gold, damage,
      side: side === 0 || side === 1 ? side : null, ff: ff == null ? null : ff === 1, pentas: pentas ?? null,
    };
  });
}

/** Réunit les deux sources (une partie présente dans les deux n'apparaît qu'une fois), de la plus récente à la plus ancienne. */
export function mergeHistory(client: Game[], server: Game[]): Game[] {
  const byId = new Map<number, Game>();
  for (const g of server) byId.set(g.id, g);
  for (const g of client) {
    const s = byId.get(g.id);
    // le client connaît la file exacte ; le serveur connaît le poste officiel et l'objet de quête
    byId.set(g.id, s ? { ...g, role: s.role ?? g.role, items: g.items.some((i, k) => k === 7 && i > 0) ? g.items : s.items,
                         side: g.side ?? s.side, ff: g.ff ?? s.ff, pentas: g.pentas ?? s.pentas } : g);
  }
  return [...byId.values()].sort((a, b) => b.created - a.created);
}

/** Rôles devinés pour toute l'équipe (un par rôle) quand le client n'en donne pas assez ou en double. */
function withTeamRoles(players: (PlayerLine & { known?: number | null })[], guess?: Guess): PlayerLine[] {
  const strip = (x: PlayerLine & { known?: number | null }): PlayerLine => { const { known: _k, ...rest } = x; return rest; };
  const fixed = players.map((x) => x.known ?? null);
  const dupes = fixed.some((r, i) => r != null && fixed.indexOf(r) !== i);
  if (!guess?.dist || players.length !== 5 || dupes || fixed.every((r) => r != null)) return players.map(strip);
  const roles = assignTeamRoles(players.map((x) => x.champ), fixed, guess.dist);
  return players.map((x, i) => ({ ...strip(x), role: roles[i] < 5 ? roles[i] : x.role }));
}

const detailCache = new Map<number, Promise<GameDetail>>();

/** Détail d'une partie terminée : les 10 joueurs, comme dans le client (gardé en mémoire : une partie ne change plus). */
export function loadGameDetail(gameId: number, guess?: Guess): Promise<GameDetail> {
  if (!detailCache.has(gameId)) {
    if (detailCache.size > 200) detailCache.clear();
    detailCache.set(gameId, fetchGameDetail(gameId, guess).catch((e) => { detailCache.delete(gameId); throw e; }));
  }
  return detailCache.get(gameId)!;
}

async function fetchGameDetail(gameId: number, guess?: Guess): Promise<GameDetail> {
  const g = await invoke<RawGame>("lcu_game", { gameId });
  const ids = new Map((g.participantIdentities ?? []).map((x) => [x.participantId, x.player]));
  const teams = new Map<number, PlayerLine[]>();
  for (const p of g.participants ?? []) {
    const who = ids.get(p.participantId ?? -1);
    const name = who?.gameName ? `${who.gameName}#${who.tagLine ?? ""}` : who?.summonerName ?? t("Joueur");
    const s = p.stats;
    const pos = p.teamPosition || p.individualPosition;
    const known = pos && pos in POSITIONS ? POSITIONS[pos] : p.spell1Id === SMITE || p.spell2Id === SMITE ? 1 : null;
    const line: PlayerLine & { known?: number | null } = {
      puuid: who?.puuid || null, name, icon: who?.profileIcon ?? null, champ: p.championId, role: roleOf(p, guess), known,
      spells: [n(p.spell1Id), n(p.spell2Id)], keystone: n(s.perk0), subStyle: n(s.perkSubStyle), items: itemsOf(s),
      runes: runesOf(s),
      kills: s.kills, deaths: s.deaths, assists: s.assists,
      cs: (s.totalMinionsKilled ?? 0) + (s.neutralMinionsKilled ?? 0), gold: n(s.goldEarned), damage: n(s.totalDamageDealtToChampions),
      vision: Number.isFinite(s.visionScore) ? n(s.visionScore) : null,
    };
    const team = p.teamId ?? 100;
    teams.set(team, [...(teams.get(team) ?? []), line]);
  }
  const wins = new Map((g.teams ?? []).map((t) => [t.teamId, t.win === true || t.win === "Win"]));
  const order = [0, 1, 2, 3, 4];
  return {
    duration: seconds(g.gameDuration),
    teams: [...teams.entries()].sort((a, b) => a[0] - b[0]).map(([teamId, players]) => ({
      teamId, win: wins.get(teamId) ?? players.length > 0,
      players: withTeamRoles(players, guess).sort((a, b) => order.indexOf(a.role ?? 9) - order.indexOf(b.role ?? 9)),
    })),
  };
}

export interface OtherPlayer {
  puuid: string; name: string; icon: number | null; level: number | null;
  rank: string | null; tier: string | null; games: Game[];
}

/** Riot ID « Pseudo#TAG » → identifiant du joueur dans le client, ou un message d'erreur. */
export async function findPlayer(riotId: string): Promise<{ puuid: string } | { error: string }> {
  const m = /^\s*([^#]{3,16})#([A-Za-z0-9]{2,5})\s*$/u.exec(riotId);
  if (!m) return { error: t("Écris le Riot ID complet, par exemple Pseudo#EUW.") };
  try {
    const s = await invoke<{ puuid?: string }>("lcu_find_player", { gameName: m[1].trim(), tagLine: m[2] });
    return s.puuid ? { puuid: s.puuid } : { error: t("Joueur introuvable sur ce serveur.") };
  } catch (e) {
    if (e === "not_running") return { error: t("Lance le client LoL pour chercher un joueur.") };
    return { error: t("Joueur introuvable sur ce serveur.") };
  }
}

/** Profil d'un autre joueur via le client : rang Solo/Duo et ses 20 dernières parties. */
export async function loadPlayer(puuid: string, guess?: Guess): Promise<OtherPlayer> {
  const raw = await invoke<{
    summoner: { gameName?: string; tagLine?: string; displayName?: string; profileIconId?: number; summonerLevel?: number };
    ranked: RankedStats | null; history: RawHistory | null;
  }>("lcu_player", { puuid, count: 20 });
  const s = raw.summoner ?? {};
  return {
    puuid, name: s.gameName ? `${s.gameName}#${s.tagLine ?? ""}` : s.displayName ?? t("Joueur"),
    icon: s.profileIconId ?? null, level: s.summonerLevel ?? null,
    rank: rankText(raw.ranked?.queueMap?.RANKED_SOLO_5x5), tier: rankTier(raw.ranked?.queueMap?.RANKED_SOLO_5x5),
    games: raw.history ? await parseHistory(raw.history, guess) : [],
  };
}

/** Elo d'un joueur dans une file (carte au survol de l'historique). Gardé 5 min pour ne pas relancer le client à chaque survol. */
export type QueueRank = { rank: string | null; tier: string | null };
const rankCache = new Map<string, { at: number; job: Promise<RankedStats | null> }>();
export function loadRank(puuid: string, queue: "solo" | "flex"): Promise<QueueRank> {
  const hit = rankCache.get(puuid);
  let job = hit && Date.now() - hit.at < 5 * 60_000 ? hit.job : null;
  if (!job) {
    job = invoke<{ ranked: RankedStats | null }>("lcu_player", { puuid, count: 1 }).then((r) => r.ranked ?? null);
    job.catch(() => rankCache.delete(puuid));
    rankCache.set(puuid, { at: Date.now(), job });
  }
  return job.then((r) => {
    const q = r?.queueMap?.[queue === "flex" ? "RANKED_FLEX_SR" : "RANKED_SOLO_5x5"];
    return { rank: rankText(q), tier: rankTier(q) };
  });
}

/**
 * Suivi des LP : on note le rang au début de chaque partie, puis on le relit après la partie
 * (le client met quelques secondes à le mettre à jour) et on associe l'écart à la dernière partie classée.
 */
export function useLpTracking(client: ClientState): number {
  const phase = client.status === "idle" ? client.phase : client.status === "champselect" ? "ChampSelect" : "";
  const last = useRef(phase);
  const [version, setVersion] = useState(0);   // change quand un nouvel écart de LP est enregistré

  useEffect(() => {
    const prev = last.current;
    last.current = phase;
    if (phase === prev) return;
    if (phase === "ChampSelect" || phase === "InProgress") {
      readRanked().then((r) => {
        if (r?.queueMap) localStorage.setItem(BEFORE_KEY, JSON.stringify({ at: Date.now(), queueMap: r.queueMap }));
        noteSoloLp(r);
      });
    }
    if (phase === "EndOfGame" || phase === "PreEndOfGame") {
      let tries = 0;
      const check = async () => {
        tries += 1;
        const saved = (() => { try { return JSON.parse(localStorage.getItem(BEFORE_KEY) ?? "null"); } catch { return null; } })();
        if (!saved?.queueMap) return;
        const [now, games] = await Promise.all([readRanked(), loadHistory(1).catch(() => [] as Game[])]);
        const game = games[0];
        const type = game && game.queue !== "other" ? game.queueType : null;
        if (game && type && now?.queueMap && game.created >= saved.at - 6 * 3600_000) {
          const before = absoluteLp(saved.queueMap[type]), after = absoluteLp(now.queueMap[type]);
          if (before != null && after != null && (after !== before || tries >= 6)) {
            const map = readLp();
            map[String(game.id)] = after - before;
            localStorage.setItem(LP_KEY, JSON.stringify(map));
            if (type === "RANKED_SOLO_5x5") pushLpPoint({ at: game.created + game.duration * 1000, lp: after, game: game.id });
            if (type === "RANKED_FLEX_SR") pushLpPoint({ at: game.created + game.duration * 1000, lp: after, game: game.id }, "flex");
            if (game.queue === "5c5") pushLpPoint({ at: game.created + game.duration * 1000, lp: after, game: game.id }, "5c5");
            localStorage.removeItem(BEFORE_KEY);
            setVersion((v) => v + 1);
            return;
          }
        }
        if (tries < 6) window.setTimeout(check, 10_000);   // jusqu'à une minute d'attente
      };
      window.setTimeout(check, 5_000);
    }
  }, [phase]);
  return version;
}

/** Duo vu par le serveur Spec : clé opaque du partenaire, bilan, combos de champions, parties ensemble. */
export interface Duo {
  key: string; games: number; wins: number;
  combos: [number, number, number, number][];      // ton champion, le sien, parties, victoires
  matches: [string, number, number][];             // partie, son champion, ton champion
}

export async function loadDuos(client: string): Promise<Duo[]> {
  if (!API_URL) return [];
  const r = await fetch(`${API_URL}/v1/players/${encodeURIComponent(client)}/duos`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return ((await r.json()) as { duos: Duo[] }).duos;
}

/** Nom, icône et identifiant client du partenaire, lus dans le détail d'une partie jouée ensemble. */
export async function duoPartner(d: Duo, me: string | null): Promise<{ name: string; icon: number | null; puuid: string | null } | null> {
  for (const [matchId, partnerChamp] of d.matches.slice(0, 3)) {
    try {
      const detail = await loadGameDetail(Number(matchId.split("_")[1] ?? 0));
      const team = detail.teams.find((t) => t.players.some((p) => p.puuid === me)) ?? null;
      const p = (team?.players ?? detail.teams.flatMap((t) => t.players)).find((x) => x.champ === partnerChamp && x.puuid !== me);
      if (p) return { name: p.name, icon: p.icon, puuid: p.puuid };
    } catch { /* client fermé ou partie introuvable : on essaie la suivante */ }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Écart en lane (page Stats) : CS et or face au vis-à-vis à 15 et 25 min, lus dans la timeline du client.

/** [CS à 15, or à 15, CS à 25, or à 25] (null quand la partie a fini avant) ; null si pas de vis-à-vis. */
export type LaneDiff = [number, number, number | null, number | null];
type Frame = { participantFrames?: Record<string, { participantId?: number; totalGold?: number; minionsKilled?: number; jungleMinionsKilled?: number }> };

const LANE_KEY = "spec.laneDiff";
function readLane(): Record<string, LaneDiff | 0> {
  try { return JSON.parse(localStorage.getItem(LANE_KEY) ?? "{}"); } catch { return {}; }
}

/** Écart d'une partie, gardé sur le PC (une partie terminée ne change plus ; 0 = pas de vis-à-vis). */
export async function laneDiff(gameId: number, me: string, guess?: Guess): Promise<LaneDiff | null> {
  // clé partie + joueur : la même partie peut apparaître dans ton profil et dans celui d'un autre joueur
  const key = `${gameId}:${me.slice(0, 8)}`;
  const saved = readLane()[key];
  if (saved !== undefined) return saved || null;
  const [g, tl] = await Promise.all([invoke<RawGame>("lcu_game", { gameId }), invoke<{ frames?: Frame[] }>("lcu_timeline", { gameId })]);
  const ids = new Map((g.participantIdentities ?? []).map((x) => [x.player?.puuid, x.participantId]));
  const mine = g.participants.find((p) => p.participantId === ids.get(me));
  const role = mine ? roleOf(mine, guess) : null;
  const opp = mine && role != null
    ? g.participants.find((p) => p.teamId !== mine.teamId && roleOf(p, guess) === role) : undefined;
  let out: LaneDiff | null = null;
  const frames = tl.frames ?? [];
  if (mine && opp && frames.length > 15) {
    const at = (min: number, id: number | undefined) => {
      const f = frames[min]?.participantFrames?.[String(id)];
      return f ? { cs: (f.minionsKilled ?? 0) + (f.jungleMinionsKilled ?? 0), gold: f.totalGold ?? 0 } : null;
    };
    const diff = (min: number) => {
      const a = at(min, mine.participantId), b = at(min, opp.participantId);
      return a && b ? [a.cs - b.cs, a.gold - b.gold] : null;
    };
    const d15 = diff(15), d25 = frames.length > 25 ? diff(25) : null;
    if (d15) out = [d15[0], d15[1], d25?.[0] ?? null, d25?.[1] ?? null];
  }
  const all = readLane();
  const keys = Object.keys(all);
  if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete all[k];
  all[key] = out ?? 0;
  try { localStorage.setItem(LANE_KEY, JSON.stringify(all)); } catch { /* stockage plein : pas grave */ }
  return out;
}
